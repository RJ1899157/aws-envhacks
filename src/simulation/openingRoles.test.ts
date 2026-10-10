import { describe, expect, it } from 'vitest';
import { createSampleRoom } from '../core/sampleRoom';
import { createBedroomSample, createLivingRoomSample, createStudioSample } from '../core/samples';
import { CellType, voxelize } from '../core/voxelizer';
import { opening, rectRoom } from '../test/simulationFixtures';
import { computedOpeningRoles, computeVentilation, ventilationEnvFromRoom } from './ventilation';

const count = (cells: Uint8Array, type: number) => cells.filter((c) => c === type).length;

describe('sample templates under the wind convention', () => {
  it('every tagged inlet/outlet acts as tagged, for every exposure', () => {
    for (const room of [createStudioSample(), createBedroomSample(), createLivingRoomSample(), createSampleRoom()]) {
      for (const exposure of ['open', 'suburban', 'urbanDense'] as const) {
        const v = computeVentilation(room, { ...ventilationEnvFromRoom(room), exposure });
        for (const o of v.openings) {
          if (o.taggedRole === 'closed') continue;
          expect({ room: room.name, id: o.id, role: o.computedRole }).toEqual({ room: room.name, id: o.id, role: o.taggedRole });
        }
      }
    }
  });
});

describe('voxelizer with computed roles', () => {
  // Wind from the north: wall 0 (facing −Z) is windward, but it is tagged as the outlet
  const room = rectRoom(4, 3, 2.5, {
    openings: [opening('a', 0, { role: 'outlet' }), opening('b', 2, { role: 'inlet' })],
  });

  it('uses the computed direction instead of the tag', () => {
    const roles = computedOpeningRoles(computeVentilation(room, ventilationEnvFromRoom(room)));
    expect(roles).toEqual({ a: 'inlet', b: 'outlet' });
    const byTag = voxelize(room, 0.1);
    const byFlow = voxelize(room, 0.1, [], roles);
    expect(count(byFlow.cells, CellType.INLET)).toBe(count(byTag.cells, CellType.OUTLET));
    // The windward opening (z ≈ 0) is an inlet in the physics grid, an outlet in the tag grid
    const cellAt = (g: ReturnType<typeof voxelize>) => g.cells[g.idx(Math.floor((1 - g.origin[0]) / g.dx), 15, Math.floor((-0.05 - g.origin[2]) / g.dx))];
    expect(cellAt(byFlow)).toBe(CellType.INLET);
    expect(cellAt(byTag)).toBe(CellType.OUTLET);
  });

  it('marks two-way openings as OPENING cells and closed ones solid', () => {
    const single = rectRoom(4, 3, 2.5, { openings: [opening('a', 0), opening('c', 2, { openFraction: 0 })] });
    const grid = voxelize(single, 0.1, [], computedOpeningRoles(computeVentilation(single, ventilationEnvFromRoom(single))));
    expect(count(grid.cells, CellType.OPENING)).toBeGreaterThan(0);
    expect(count(grid.cells, CellType.INLET) + count(grid.cells, CellType.OUTLET)).toBe(0);
  });
});
