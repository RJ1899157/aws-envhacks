import { z } from 'zod';

/**
 * 2D vector on the XZ floor plane: [x, z] in meters
 */
export const Vec2Schema = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2Schema>;

/**
 * 3D vector: [x, y, z] in meters where Y is UP and XZ is the floor plane
 */
export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

/**
 * Positive 3D size bounding box: [width, height, depth] in meters
 */
export const PositiveVec3Schema = z.tuple([
  z.number().positive('Width must be greater than 0'),
  z.number().positive('Height must be greater than 0'),
  z.number().positive('Depth must be greater than 0'),
]);
export type PositiveVec3 = z.infer<typeof PositiveVec3Schema>;

/**
 * Airflow role classifications for CFD & IAQ simulation
 */
export const AirflowRoleSchema = z.enum(['solid', 'source', 'porous', 'none']);
export type AirflowRole = z.infer<typeof AirflowRoleSchema>;

/**
 * Role of a wall opening in ventilation
 */
export const OpeningRoleSchema = z.enum(['inlet', 'outlet', 'closed']);
export type OpeningRole = z.infer<typeof OpeningRoleSchema>;

/**
 * Architectural opening type
 */
export const OpeningTypeSchema = z.enum(['window', 'door']);
export type OpeningType = z.infer<typeof OpeningTypeSchema>;

/**
 * Architectural opening specific subtype presets
 */
export const OpeningSubTypeSchema = z.enum([
  'single-door',
  'double-door',
  'sliding-door',
  'archway',
  'wide-archway',
  'pass-through',
  'open-wall',
  'window',
  'wide-window',
  'french-window',
  'vent',
]);
export type OpeningSubType = z.infer<typeof OpeningSubTypeSchema>;

/**
 * How a window opens. Sliding sashes overlap, so at most half the frame opens; louvres / jaali have
 * a much smaller free area; casements (hinged, opening outwards) open the whole frame.
 */
export const WindowStyleSchema = z.enum(['sliding', 'casement', 'louvre']);
export type WindowStyle = z.infer<typeof WindowStyleSchema>;

/**
 * Wall opening schema (windows and doors)
 */
export const OpeningSchema = z.object({
  id: z.string().min(1),
  wallIndex: z.number().int().nonnegative('Wall index must be a non-negative integer'),
  type: OpeningTypeSchema,
  subType: OpeningSubTypeSchema.optional(),
  offset: z.number().nonnegative('Opening offset must be non-negative'),
  width: z.number().positive('Opening width must be positive'),
  height: z.number().positive('Opening height must be positive'),
  sill: z.number().nonnegative('Sill height must be non-negative'),
  role: OpeningRoleSchema.default('closed'),
  openFraction: z.number().min(0).max(1).default(0),
  // Windows only; absent = the home's default (params.windowDefaults), else a casement without mesh
  windowStyle: WindowStyleSchema.optional(),
  mesh: z.boolean().optional(), // insect mesh over the opening
  flipHinge: z.boolean().optional(),
  flipSwing: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  isLocked: z.boolean().optional(),
});
export type Opening = z.infer<typeof OpeningSchema>;

/**
 * Air-handling device kind of an object. Optional: when absent it is inferred from `assetId`
 * (see DEVICE_KIND_BY_ASSET in simulation/devices.ts).
 */
export const DeviceKindSchema = z.enum(['purifier', 'exhaustFan', 'rangeHood', 'ceilingFan', 'pedestalFan', 'ac', 'pm25Source']);
export type DeviceKind = z.infer<typeof DeviceKindSchema>;

/** Activity window of a PM2.5 source, in minutes from the simulation start. */
export const Pm25ScheduleWindowSchema = z.object({
  startMin: z.number().nonnegative(), // minutes from simulation start
  durationMin: z.number().positive(),
});
export type Pm25ScheduleWindow = z.infer<typeof Pm25ScheduleWindowSchema>;

/**
 * 3D placed object instance in the room
 */
export const ObjectSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  position: Vec3Schema, // [x, y, z] in meters
  rotation: Vec3Schema.default([0, 0, 0]), // [rx, ry, rz] Euler angles in radians
  size: PositiveVec3Schema, // [width, height, depth] in meters (all > 0)
  scale: Vec3Schema.optional(), // optional [sx, sy, sz] multiplier
  elevation: z.number().default(0), // elevation offset from floor in meters
  role: AirflowRoleSchema.default('solid'),
  wallMounted: z.boolean().default(false),
  color: z.string().optional(),
  defaultAirflow: z.number().optional(), // volumetric airflow of a device, m³/h
  device: DeviceKindSchema.optional(), // inferred from assetId when absent
  enabled: z.boolean().optional(), // device switched on; absent = on
  cadrM3h: z.number().nonnegative().optional(), // air purifier PM2.5 clean air delivery rate (m³/h)
  exhaustFlowM3h: z.number().nonnegative().optional(), // exhaust fan / range hood extraction rate (m³/h)
  flowDirection: z.enum(['out', 'in']).optional(), // exhaust fan: 'out' extracts (default), 'in' blows outdoor air in
  dischargeVelocityMs: z.number().nonnegative().optional(), // fan/AC jet velocity for the voxel solver (m/s)
  // Placed PM2.5 sources (device 'pm25Source'); absent fields come from the preset
  sourcePreset: z.string().optional(), // see PM25_SOURCE_PRESETS
  emissionRateUgMin: z.number().nonnegative().optional(), // µg/min while active
  emissionHeightM: z.number().nonnegative().optional(), // height above the floor where it emits (m)
  sourceSchedule: z.array(Pm25ScheduleWindowSchema).optional(), // absent or empty = always on
  isHidden: z.boolean().optional(),
  isLocked: z.boolean().optional(),
});
export type SceneObject = z.infer<typeof ObjectSchema>;

/**
 * Optional IAQ pollutant source parameters
 */
export const PollutantSourceSchema = z.object({
  type: z.string().default('VOC'),
  emissionRateMgH: z.number().nonnegative().default(10), // mg/hour
  position: Vec3Schema.optional(),
});
export type PollutantSource = z.infer<typeof PollutantSourceSchema>;

/**
 * A PM2.5 emission source (cooking, incense, smoking …). Absent `schedule` means always on.
 */
export const Pm25SourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  kind: z.string().optional(), // e.g. 'cooking-frying'; see PM25_EMISSION_RATES_UG_PER_MIN
  emissionRateUgMin: z.number().nonnegative(), // µg/min while active
  schedule: z.array(Pm25ScheduleWindowSchema).optional(),
  objectId: z.string().optional(), // object the source is attached to (for the voxel solver)
  position: Vec3Schema.optional(),
});
export type Pm25Source = z.infer<typeof Pm25SourceSchema>;

export const OutdoorPm25SourceSchema = z.enum(['manual', 'live']);
export type OutdoorPm25Source = z.infer<typeof OutdoorPm25SourceSchema>;

export const OutdoorPm25Schema = z.object({
  valueUgM3: z.number().nonnegative(), // µg/m³
  source: OutdoorPm25SourceSchema.default('manual'),
  observedAt: z.string().optional(), // ISO timestamp of a live reading
});
export type OutdoorPm25 = z.infer<typeof OutdoorPm25Schema>;

/** Terrain/shielding around the building; sets the wind speed reduction and Cp table. */
export const SiteExposureSchema = z.enum(['open', 'suburban', 'urbanDense']);
export type SiteExposure = z.infer<typeof SiteExposureSchema>;

export const GeoLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type GeoLocation = z.infer<typeof GeoLocationSchema>;

/**
 * Environmental and ventilation simulation parameters
 */
export const RoomParamsSchema = z.object({
  windSpeed: z.number().nonnegative('Wind speed cannot be negative').default(2.5), // m/s
  windDirDeg: z.number().min(0).max(360, 'Wind direction must be 0-360 degrees').default(0), // 0° = North
  pressurePa: z.number().positive('Atmospheric pressure must be positive').default(101325), // Pa
  indoorTempC: z.number().default(22.0), // °C
  outdoorTempC: z.number().default(25.0), // °C
  humidity: z.number().min(0).max(100, 'Humidity must be 0-100%').default(50.0), // %
  datetime: z.string().default('2026-10-05T12:00:00Z'),
  pollutantSource: PollutantSourceSchema.optional(),
  // Phase 2 (air simulation). Optional with no zod default so Phase 1 designs parse unchanged;
  // the simulation layer applies defaults.
  pm25Sources: z.array(Pm25SourceSchema).optional(),
  outdoorPm25: OutdoorPm25Schema.optional(),
  location: GeoLocationSchema.optional(),
  exposure: SiteExposureSchema.optional(), // runtime default 'urbanDense'
  // House-wide (written to every room). Absent = wind taken at the 10 m reference height
  floorLevel: z.number().int().min(0).max(150).optional(), // storey of the home, 0 = ground floor
  windowDefaults: z.object({ style: WindowStyleSchema, mesh: z.boolean() }).optional(),
});
export type RoomParams = z.infer<typeof RoomParamsSchema>;

/**
 * Per-wall override attributes for custom height, thickness, and material colour
 */
export const WallOverrideSchema = z.object({
  name: z.string().optional(),
  height: z.number().min(1.0).max(10.0).optional(),
  thickness: z.number().min(0.05).max(1.0).optional(),
  color: z.string().optional(),
  isHidden: z.boolean().optional(),
  isLocked: z.boolean().optional(),
});
export type WallOverride = z.infer<typeof WallOverrideSchema>;

/**
 * Air-simulation what-if scenarios: a named list of typed actions applied to the design (see
 * src/simulation/scenarios). Targets are referenced by room and object/opening ids; an action whose
 * target no longer exists is skipped.
 */
export const ScenarioActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setOpening'), roomId: z.string(), openingId: z.string(), openFraction: z.number().min(0).max(1) }),
  z.object({ type: z.literal('toggleDevice'), roomId: z.string(), objectId: z.string(), enabled: z.boolean() }),
  z.object({ type: z.literal('moveObject'), roomId: z.string(), objectId: z.string(), toRoomId: z.string().optional(), position: Vec3Schema }),
  z.object({
    type: z.literal('addDevice'),
    roomId: z.string(),
    objectId: z.string(),
    kind: DeviceKindSchema,
    assetId: z.string(),
    position: Vec3Schema,
    rotationY: z.number().optional(),
  }),
  z.object({ type: z.literal('removeObject'), roomId: z.string(), objectId: z.string() }),
  z.object({
    type: z.literal('setSource'),
    roomId: z.string(),
    sourceId: z.string(),
    enabled: z.boolean().optional(),
    rateUgMin: z.number().nonnegative().optional(),
    schedule: z.array(Pm25ScheduleWindowSchema).optional(),
  }),
  z.object({
    type: z.literal('setDeviceParam'),
    roomId: z.string(),
    objectId: z.string(),
    param: z.enum(['cadrM3h', 'exhaustFlowM3h', 'defaultAirflow', 'dischargeVelocityMs']),
    value: z.number().nonnegative(),
  }),
]);
export type ScenarioAction = z.infer<typeof ScenarioActionSchema>;

export const ScenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  actions: z.array(ScenarioActionSchema),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const RoomTypeSchema = z.enum(['basic', 'bedroom', 'living', 'kitchen', 'dining', 'bathroom']);
export type RoomType = z.infer<typeof RoomTypeSchema>;

/**
 * Complete Room specification for 3D modeling and IAQ simulation
 */
export const RoomSchema = z.object({
  version: z.literal(1).default(1),
  id: z.string().min(1).optional(),
  type: RoomTypeSchema.optional(),
  name: z.string().min(1).default('Default Room'),
  wallHeight: z
    .number()
    .min(2.0, 'Wall height must be at least 2.0m')
    .max(6.0, 'Wall height cannot exceed 6.0m')
    .default(2.7),
  wallThickness: z
    .number()
    .min(0.05, 'Wall thickness must be at least 0.05m')
    .max(0.5, 'Wall thickness cannot exceed 0.5m')
    .default(0.15),
  outline: z.array(Vec2Schema).min(3, 'Room outline must have at least 3 vertices'),
  openings: z.array(OpeningSchema).default([]),
  objects: z.array(ObjectSchema).default([]),
  params: RoomParamsSchema.default(() => RoomParamsSchema.parse({})),
  wallOverrides: z.record(z.coerce.number(), WallOverrideSchema).optional(),
  // Phase 2 (air simulation), optional so older designs parse unchanged:
  occupancyWeight: z.number().nonnegative().optional(), // share of time people spend here; default by room type (OCCUPANCY_WEIGHTS)
  scenarios: z.array(ScenarioSchema).optional(), // what-if scenarios of the whole house, kept on the active room
  floorMaterial: z.string().default('wood'),
  wallMaterial: z.string().default('paint'),
});
export type Room = z.infer<typeof RoomSchema>;
