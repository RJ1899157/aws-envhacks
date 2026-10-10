import { isPassage } from '../../core/openingPresets';
import { signedArea, wallSegment } from '../../core/parser';
import type { Opening, Room, SiteExposure, Vec2 } from '../../core/schema';
import {
  AIR_GAS_CONSTANT,
  DEFAULT_INFILTRATION_ACH,
  DEFAULT_SITE_EXPOSURE,
  DOOR_UNDERCUT_HEIGHT_M,
  ENVELOPE_LEAK_AREA_PER_M2_FLOOR,
  KELVIN_OFFSET,
  NETWORK_OPENING_SEGMENTS,
} from '../constants';
import { devicesIn, type Device } from '../devices';
import { interiorOpeningIds, isOpeningOpen, openingArea, roomVolume, wallHeightAt } from '../geometry';
import { localWindSpeed, pressureCoefficient, windIncidenceDeg } from '../ventilation';

/**
 * A house = the rooms of a floor plan as zones, connected by flow paths:
 * - exterior windows/doors (to outdoors, with a wind pressure from Cp and the local wind)
 * - interior openings on shared walls (zone to zone), sized by their open fraction
 * - interior door undercuts (always open, DOOR_UNDERCUT_HEIGHT_M × door width)
 * - one small envelope leak per zone (keeps the network solvable)
 * The same description drives the network model and the voxel domain.
 */

export interface HouseEnv {
  windSpeed: number;
  windDirDeg: number;
  indoorTempC: number;
  outdoorTempC: number;
  exposure: SiteExposure;
  infiltrationAch: number;
  outdoorUgM3: number;
}

export interface HouseZone {
  index: number;
  roomId: string;
  name: string;
  room: Room;
  volumeM3: number;
  floorAreaM2: number;
  ceilingM: number;
  /** Floor-plan centroid [x, z] */
  centroid: Vec2;
  devices: Device[];
}

export type PathKind = 'window' | 'door' | 'opening' | 'undercut' | 'leak';

/** One horizontal slice of an exterior opening (for the stack effect). */
export interface PathSegment {
  /** Height of the slice centre above the floor (m) */
  z: number;
  areaM2: number;
}

export interface HousePath {
  id: string;
  kind: PathKind;
  /** Opening this path comes from (none for leaks) */
  openingId?: string;
  /** Zone the opening belongs to (flow is signed from `from` to `to`) */
  from: number;
  /** Other zone, or −1 for outdoors */
  to: number;
  /** Open area (m²) before the discharge coefficient */
  areaM2: number;
  segments: PathSegment[];
  /** Exterior paths: wind pressure coefficient and pressure (Pa, relative to ambient static) */
  cp: number;
  windPressurePa: number;
  /** Geometry for the voxel grid (absent for leaks) */
  geometry?: {
    room: number;
    wallIndex: number;
    offset: number;
    width: number;
    sill: number;
    height: number;
    openFraction: number;
    /** Outward normal of the owning room's wall [x, z] */
    normal: Vec2;
  };
}

export interface House {
  zones: HouseZone[];
  paths: HousePath[];
  env: HouseEnv;
  localWindSpeed: number;
  rhoIn: number;
  rhoOut: number;
  warnings: string[];
}

export const airDensity = (tempC: number, pressurePa = 101325) => pressurePa / (AIR_GAS_CONSTANT * (tempC + KELVIN_OFFSET));

function centroid(outline: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x0, z0] = outline[i]!;
    const [x1, z1] = outline[(i + 1) % outline.length]!;
    const cross = x0 * z1 - x1 * z0;
    a += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
  }
  return Math.abs(a) < 1e-12 ? outline[0]! : [cx / (3 * a), cz / (3 * a)];
}

/** Resolves the house environment from the primary room's params, with optional overrides. */
export function houseEnvFromRoom(room: Room, overrides: Partial<HouseEnv> = {}): HouseEnv {
  const p = room.params;
  const defined = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) as Partial<HouseEnv>;
  return {
    windSpeed: p.windSpeed,
    windDirDeg: p.windDirDeg,
    indoorTempC: p.indoorTempC,
    outdoorTempC: p.outdoorTempC,
    exposure: p.exposure ?? DEFAULT_SITE_EXPOSURE,
    infiltrationAch: DEFAULT_INFILTRATION_ACH,
    outdoorUgM3: p.outdoorPm25?.valueUgM3 ?? 35,
    ...defined,
  };
}

function segments(op: Opening, wallH: number, area: number): PathSegment[] {
  const top = Math.min(op.sill + op.height, wallH);
  const h = Math.max(0, top - op.sill);
  return Array.from({ length: NETWORK_OPENING_SEGMENTS }, (_, s) => ({
    z: op.sill + ((s + 0.5) / NETWORK_OPENING_SEGMENTS) * h,
    areaM2: area / NETWORK_OPENING_SEGMENTS,
  }));
}

/**
 * Builds the zone/path description. `rooms[0]` is the primary room whose params set the
 * environment (wind, temperatures, exposure, outdoor PM2.5).
 */
export function buildHouse(rooms: readonly Room[], envOverrides: Partial<HouseEnv> = {}): House {
  if (rooms.length === 0) throw new Error('A house needs at least one room');
  const warnings: string[] = [];
  const env = houseEnvFromRoom(rooms[0]!, envOverrides);
  const uLocal = localWindSpeed(env.windSpeed, env.exposure);
  const rhoOut = airDensity(env.outdoorTempC);
  const rhoIn = airDensity(env.indoorTempC);

  const zones: HouseZone[] = rooms.map((room, index) => ({
    index,
    roomId: room.id ?? `room-${index}`,
    name: room.name,
    room,
    volumeM3: roomVolume(room),
    floorAreaM2: Math.abs(signedArea(room.outline)),
    ceilingM: room.wallHeight,
    centroid: centroid(room.outline),
    devices: devicesIn(room.objects),
  }));

  const paths: HousePath[] = [];
  const seenInterior = new Set<string>();
  rooms.forEach((room, a) => {
    for (const op of room.openings) {
      if (op.wallIndex < 0 || op.wallIndex >= room.outline.length) continue;
      const wallH = wallHeightAt(room, op.wallIndex);
      const seg = wallSegment(room, op.wallIndex);
      const open = isOpeningOpen(op);
      const area = open ? openingArea(op, wallH) * op.openFraction : 0;
      const geometry = { room: a, wallIndex: op.wallIndex, offset: op.offset, width: op.width, sill: op.sill, height: Math.min(op.height, wallH - op.sill), openFraction: open ? op.openFraction : 0, normal: seg.normal };
      // Interior? Find the neighbour whose shared wall this opening sits on
      const b = rooms.findIndex((other, i) => i !== a && interiorOpeningIds(room, [other]).has(op.id));
      if (b >= 0) {
        const key = `${op.id}`;
        if (seenInterior.has(key)) continue;
        seenInterior.add(key);
        if (area > 0) {
          paths.push({ id: op.id, kind: 'opening', openingId: op.id, from: a, to: b, areaM2: area, segments: [{ z: op.sill + geometry.height / 2, areaM2: area }], cp: 0, windPressurePa: 0, geometry });
        }
        if (op.type === 'door' && !isPassage(op.subType)) {
          const u = op.width * DOOR_UNDERCUT_HEIGHT_M;
          paths.push({ id: `${op.id}:undercut`, kind: 'undercut', openingId: op.id, from: a, to: b, areaM2: u, segments: [{ z: DOOR_UNDERCUT_HEIGHT_M / 2, areaM2: u }], cp: 0, windPressurePa: 0, geometry: { ...geometry, sill: 0, height: DOOR_UNDERCUT_HEIGHT_M, openFraction: 1 } });
        }
        continue;
      }
      if (area <= 0) continue;
      const cp = pressureCoefficient(windIncidenceDeg(seg.normal, env.windDirDeg), env.exposure);
      paths.push({
        id: op.id,
        kind: op.type === 'door' ? 'door' : 'window',
        openingId: op.id,
        from: a,
        to: -1,
        areaM2: area,
        segments: segments(op, wallH, area),
        cp,
        windPressurePa: 0.5 * rhoOut * cp * uLocal * uLocal,
        geometry,
      });
    }
  });
  for (const z of zones) {
    const leak = ENVELOPE_LEAK_AREA_PER_M2_FLOOR * z.floorAreaM2;
    paths.push({ id: `${z.roomId}:leak`, kind: 'leak', from: z.index, to: -1, areaM2: leak, segments: [{ z: z.ceilingM / 2, areaM2: leak }], cp: 0, windPressurePa: 0 });
  }
  return { zones, paths, env, localWindSpeed: uLocal, rhoIn, rhoOut, warnings };
}
