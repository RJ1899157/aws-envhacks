import React, { useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { wallSegment } from '../../core/parser';
import type { House } from '../../simulation/house/house';

/** Height the arrows float at: just above the walls cut for the simulation view. */
const ARROW_Y = 1.12;

export interface OpeningFlow {
  /** Net flow from the path's `from` zone to its `to` zone (m³/s) */
  netM3s: number;
  /** One-way exchange (m³/s); well above |net| for two-way (stack) flow */
  exchangeM3s: number;
}

interface ArrowSpec {
  id: string;
  position: [number, number, number];
  /** Unit direction of the net flow in world XZ */
  dir: [number, number];
  m3h: number;
  twoWay: boolean;
  small: boolean;
  kind: 'in' | 'out' | 'between';
  /** Label prefix (mechanical fans) */
  prefix?: string;
}

const COLORS = { in: '#38bdf8', out: '#fb923c', between: '#e5e7eb' } as const;

/** Flat arrow along +x, tail at −L/2, in the XZ plane. */
function arrowGeometry(length: number, width: number, doubleHeaded: boolean): THREE.BufferGeometry {
  const head = Math.min(length * 0.45, width * 1.6);
  const shaft = width * 0.38;
  const s = new THREE.Shape();
  const x0 = -length / 2;
  const x1 = length / 2;
  if (doubleHeaded) {
    s.moveTo(x0, 0);
    s.lineTo(x0 + head, width / 2);
    s.lineTo(x0 + head, shaft / 2);
    s.lineTo(x1 - head, shaft / 2);
    s.lineTo(x1 - head, width / 2);
    s.lineTo(x1, 0);
    s.lineTo(x1 - head, -width / 2);
    s.lineTo(x1 - head, -shaft / 2);
    s.lineTo(x0 + head, -shaft / 2);
    s.lineTo(x0 + head, -width / 2);
  } else {
    s.moveTo(x0, shaft / 2);
    s.lineTo(x1 - head, shaft / 2);
    s.lineTo(x1 - head, width / 2);
    s.lineTo(x1, 0);
    s.lineTo(x1 - head, -width / 2);
    s.lineTo(x1 - head, -shaft / 2);
    s.lineTo(x0, -shaft / 2);
  }
  s.closePath();
  // Shape XY → world XZ (y up is the shape's −Z after rotating −90° about X)
  return new THREE.ShapeGeometry(s).rotateX(Math.PI / 2);
}

const Arrow: React.FC<{ a: ArrowSpec; showLabel: boolean }> = ({ a, showLabel }) => {
  // Length grows with the log of the flow: 50 m³/h ≈ 0.45 m, 1000 m³/h ≈ 0.85 m
  const length = a.small ? 0.22 : Math.min(1.0, 0.25 + 0.2 * Math.log10(1 + a.m3h));
  const width = a.small ? 0.1 : Math.max(0.2, length * 0.42);
  const geometry = useMemo(() => arrowGeometry(length, width, a.twoWay), [length, width, a.twoWay]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const angle = Math.atan2(-a.dir[1], a.dir[0]);
  const color = COLORS[a.kind];
  return (
    <group position={a.position}>
      <group rotation={[0, angle, 0]}>
        <mesh geometry={geometry} renderOrder={8} raycast={() => null}>
          <meshBasicMaterial color={color} transparent opacity={a.small ? 0.7 : 0.95} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      {showLabel && !a.small && (
        <Html center position={[0, 0.02, 0]} style={{ pointerEvents: 'none' }} zIndexRange={[6, 0]}>
          <div data-testid="sim-opening-arrow-label" className="mt-7 px-1.5 py-0.5 rounded bg-neutral-950/85 text-[10px] font-semibold whitespace-nowrap tabular-nums" style={{ color, border: `1px solid ${color}66` }}>
            {a.prefix ? `${a.prefix} · ` : ''}
            {a.twoWay ? '⇄ ' : ''}
            {Math.round(a.m3h)} m³/h{a.twoWay ? ' each way' : a.kind === 'in' ? ' in' : a.kind === 'out' ? ' out' : ''}
          </div>
        </Html>
      )}
    </group>
  );
};

/**
 * Arrows at every open opening (window, door, archway) in the direction of its net flow, sized by
 * the flow, with the rate in m³/h; two-way exchange (warm air out at the top, cool air in at the
 * bottom) shows a double-headed arrow. Door undercuts get small unlabelled arrows.
 */
export const OpeningArrows: React.FC<{ house: House; flows: ReadonlyMap<string, OpeningFlow>; labels?: boolean }> = ({ house, flows, labels = true }) => {
  const arrows = useMemo(() => {
    const out: ArrowSpec[] = [];
    for (const path of house.paths) {
      const g = path.geometry;
      const f = flows.get(path.id);
      if (!g || !f || path.kind === 'leak') continue;
      const small = path.kind === 'undercut';
      const net = f.netM3s * 3600;
      const exchange = f.exchangeM3s * 3600;
      if (Math.max(Math.abs(net), exchange) < (small ? 1 : 0.5)) continue;
      const owner = house.zones[g.room]!.room;
      const seg = wallSegment(owner, g.wallIndex);
      const u = g.offset + (Math.min(1, Math.max(0.05, g.openFraction)) * g.width) / 2;
      const halfT = owner.wallThickness / 2;
      const twoWay = !small && exchange > 5 && Math.abs(net) < 0.3 * exchange;
      const sign = net >= 0 ? 1 : -1;
      const kind = path.to >= 0 ? 'between' : sign > 0 ? 'out' : 'in';
      out.push({
        id: path.id,
        position: [seg.a[0] + seg.dir[0] * u + seg.normal[0] * halfT, small ? 0.35 : ARROW_Y, seg.a[1] + seg.dir[1] * u + seg.normal[1] * halfT],
        dir: [seg.normal[0] * sign, seg.normal[1] * sign],
        m3h: twoWay ? exchange : Math.abs(net),
        twoWay,
        small,
        kind,
      });
    }
    // Mechanical fans: exhaust blows room air out through its wall, a fan set to blow in brings
    // outdoor air through it; the arrow crosses the nearest wall in that direction
    for (const zone of house.zones) {
      for (const d of zone.devices) {
        if (!d.enabled || (d.role !== 'exhaust' && d.role !== 'supply') || d.flowM3s <= 0) continue;
        const obj = zone.room.objects.find((o) => o.id === d.objectId);
        if (!obj) continue;
        const p: [number, number] = [obj.position[0], obj.position[2]];
        let best: { seg: ReturnType<typeof wallSegment>; t: number; dist: number } | null = null;
        for (let w = 0; w < zone.room.outline.length; w++) {
          const seg = wallSegment(zone.room, w);
          const t = Math.max(0, Math.min(seg.len, (p[0] - seg.a[0]) * seg.dir[0] + (p[1] - seg.a[1]) * seg.dir[1]));
          const dist = Math.hypot(p[0] - seg.a[0] - seg.dir[0] * t, p[1] - seg.a[1] - seg.dir[1] * t);
          if (!best || dist < best.dist) best = { seg, t, dist };
        }
        if (!best) continue;
        const { seg, t } = best;
        const sign = d.role === 'exhaust' ? 1 : -1;
        const halfT = zone.room.wallThickness / 2;
        out.push({
          id: `device:${d.objectId}`,
          position: [seg.a[0] + seg.dir[0] * t + seg.normal[0] * halfT, ARROW_Y, seg.a[1] + seg.dir[1] * t + seg.normal[1] * halfT],
          dir: [seg.normal[0] * sign, seg.normal[1] * sign],
          m3h: d.flowM3s * 3600,
          twoWay: false,
          small: false,
          kind: d.role === 'exhaust' ? 'out' : 'in',
          prefix: d.kind === 'rangeHood' ? 'Hood' : 'Fan',
        });
      }
    }
    return out;
  }, [house, flows]);
  return (
    <group name="sim-opening-arrows">
      {arrows.map((a) => (
        <Arrow key={a.id} a={a} showLabel={labels} />
      ))}
    </group>
  );
};
