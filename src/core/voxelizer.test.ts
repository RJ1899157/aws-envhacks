import { describe, expect, it } from 'vitest';
import {
  voxelize,
  voxelizeAsync,
  CellType,
  getCell,
  getCellByIndex,
  computeVoxelStats,
} from './voxelizer';
import type { Room, SceneObject } from './schema';

describe('Voxelizer: 3D Grid Generation & IAQ/CFD Discretization', () => {
  const emptyRoom4x3x27: Room = {
    version: 1,
    name: 'Test 4x3x2.7 Room',
    wallHeight: 2.7,
    wallThickness: 0.15,
    outline: [
      [-2.0, -1.5],
      [2.0, -1.5],
      [2.0, 1.5],
      [-2.0, 1.5],
    ],
    openings: [],
    objects: [],
    floorMaterial: "wood", wallMaterial: "paint", params: {
      windSpeed: 2.5,
      windDirDeg: 0,
      pressurePa: 101325,
      indoorTempC: 22,
      outdoorTempC: 25,
      humidity: 50,
      datetime: '2026-10-05T12:00:00Z',
    },
  };

  it('a 4x3x2.7 room gives the expected fluid cell count within 2%', () => {
    const dx = 0.1;
    const grid = voxelize(emptyRoom4x3x27, dx);

    // Expected volume: 4.0 * 3.0 * 2.7 = 32.4 m^3
    // At dx = 0.1, each cell is 0.001 m^3 -> expected 32,400 fluid cells
    const expectedFluidCount = 32400;

    let fluidCount = 0;
    let solidCount = 0;
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] === CellType.FLUID) fluidCount++;
      if (grid.cells[i] === CellType.SOLID) solidCount++;
    }

    // Must be within 2% of 32,400
    const lowerBound = expectedFluidCount * 0.98;
    const upperBound = expectedFluidCount * 1.02;

    expect(fluidCount).toBeGreaterThanOrEqual(lowerBound);
    expect(fluidCount).toBeLessThanOrEqual(upperBound);

    // The surrounding margin/walls should be solid
    expect(solidCount).toBeGreaterThan(0);
  });

  it('a window creates INLET cells', () => {
    const roomWithWindow: Room = {
      ...emptyRoom4x3x27,
      openings: [
        {
          id: 'win-inlet',
          wallIndex: 0, // Wall 0 along bottom: [-2, -1.5] to [2, -1.5]
          type: 'window',
          offset: 1.0,
          width: 1.2,
          height: 1.2,
          sill: 0.9,
          role: 'inlet',
          openFraction: 1.0,
        },
      ],
    };

    const grid = voxelize(roomWithWindow, 0.1);

    let inletCount = 0;
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] === CellType.INLET) {
        inletCount++;
      }
    }

    expect(inletCount).toBeGreaterThan(0);

    // Check that a cell directly in the window volume has CellType.INLET
    // Window on wall 0 (z = -1.5, outward normal is -Z):
    // Window x span: -2 + 1.0 = -1.0 to -2 + 2.2 = 0.2 -> center x = -0.4
    // Window y span: 0.9 to 2.1 -> center y = 1.5
    // Window z in wall thickness: z in [-1.65, -1.5] -> center z = -1.55
    const sampleCellType = getCell(grid, -0.4, 1.5, -1.55);
    expect(sampleCellType).toBe(CellType.INLET);
  });

  it('an outlet door creates OUTLET cells', () => {
    const roomWithOutlet: Room = {
      ...emptyRoom4x3x27,
      openings: [
        {
          id: 'door-outlet',
          wallIndex: 2, // Wall 2 along top: [2, 1.5] to [-2, 1.5]
          type: 'door',
          offset: 1.0,
          width: 0.9,
          height: 2.1,
          sill: 0,
          role: 'outlet',
          openFraction: 1.0,
        },
      ],
    };

    const grid = voxelize(roomWithOutlet, 0.1);

    let outletCount = 0;
    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] === CellType.OUTLET) {
        outletCount++;
      }
    }

    expect(outletCount).toBeGreaterThan(0);
  });

  it('a rotated wardrobe occupies the right cells', () => {
    // Wardrobe: width 1.0m, height 2.0m, depth 0.6m
    // Placed at [0, 0, 0]
    // Rotated 90 degrees around Y (Math.PI / 2)
    // After 90 deg rotation, its width (1.0m) spans along Z (half-extent = 0.5)
    // and its depth (0.6m) spans along X (half-extent = 0.3).
    const rotatedWardrobe: SceneObject = {
      id: 'wardrobe-1',
      assetId: 'wardrobe',
      name: 'Rotated Wardrobe',
      position: [0, 0, 0],
      rotation: [0, Math.PI / 2, 0],
      size: [1.0, 2.0, 0.6],
      elevation: 0,
      role: 'solid',
      wallMounted: false,
    };

    const roomWithWardrobe: Room = {
      ...emptyRoom4x3x27,
      objects: [rotatedWardrobe],
    };

    const grid = voxelize(roomWithWardrobe, 0.1);

    // 1. Point [0.2, 1.0, 0.4]:
    // In local unrotated frame:
    // localX = 0.2*cos(90) + 0.4*sin(90) = 0.4 (<= halfW = 0.5)
    // localZ = -0.2*sin(90) + 0.4*cos(90) = -0.2 (abs <= halfD = 0.3)
    // localY = 1.0 (<= height 2.0)
    // So [0.2, 1.0, 0.4] is INSIDE the rotated wardrobe!
    const insideCell = getCell(grid, 0.2, 1.0, 0.4);
    expect(insideCell).toBe(CellType.SOLID);

    // 2. Point [0.45, 1.0, 0]:
    // In local unrotated frame:
    // localX = 0.45*0 + 0 = 0
    // localZ = -0.45*1 + 0 = -0.45 (abs 0.45 > halfD 0.3!)
    // So [0.45, 1.0, 0] is OUTSIDE the rotated wardrobe!
    // Since it's inside the room, it must be FLUID!
    const outsideCell = getCell(grid, 0.45, 1.0, 0);
    expect(outsideCell).toBe(CellType.FLUID);

    // 3. Compare with unrotated wardrobe at same position:
    // For unrotated wardrobe, [0.45, 1.0, 0] would be INSIDE (0.45 <= 1.0/2 = 0.5)
    const unrotatedWardrobe: SceneObject = {
      ...rotatedWardrobe,
      id: 'wardrobe-unrotated',
      rotation: [0, 0, 0],
    };
    const gridUnrotated = voxelize({ ...emptyRoom4x3x27, objects: [unrotatedWardrobe] }, 0.1);
    expect(getCell(gridUnrotated, 0.45, 1.0, 0)).toBe(CellType.SOLID);
    expect(getCell(gridUnrotated, 0.2, 1.0, 0.4)).toBe(CellType.FLUID); // outside depth 0.6 (half-depth 0.3)
  });

  it('correctly marks SOURCE and POROUS objects', () => {
    const sourceFan: SceneObject = {
      id: 'fan-1',
      assetId: 'fan',
      name: 'Exhaust Fan',
      position: [1.0, 0, 0.5],
      rotation: [0, 0, 0],
      size: [0.5, 0.5, 0.5],
      elevation: 0.5,
      role: 'source',
      wallMounted: false,
    };

    const porousCurtain: SceneObject = {
      id: 'curtain-1',
      assetId: 'curtain',
      name: 'Curtain Screen',
      position: [-1.0, 0, -0.5],
      rotation: [0, 0, 0],
      size: [1.2, 1.8, 0.1],
      elevation: 0,
      role: 'porous',
      wallMounted: false,
    };

    const roomWithOptions: Room = {
      ...emptyRoom4x3x27,
      objects: [sourceFan, porousCurtain],
    };

    const grid = voxelize(roomWithOptions, 0.1);

    expect(getCell(grid, 1.0, 0.75, 0.5)).toBe(CellType.SOURCE);
    expect(getCell(grid, -1.0, 1.0, -0.5)).toBe(CellType.POROUS);
  });

  it('getCell returns SOLID for points outside room boundary or above/below wall height', () => {
    const grid = voxelize(emptyRoom4x3x27, 0.1);

    // Below floor (y < 0)
    expect(getCell(grid, 0, -0.5, 0)).toBe(CellType.SOLID);
    // Above ceiling (y > wallHeight)
    expect(getCell(grid, 0, 3.5, 0)).toBe(CellType.SOLID);
    // Far outside room polygon
    expect(getCell(grid, 10.0, 1.5, 10.0)).toBe(CellType.SOLID);

    // getCellByIndex with out-of-bound indices
    expect(getCellByIndex(grid, -1, 0, 0)).toBe(CellType.SOLID);
    expect(getCellByIndex(grid, 0, -1, 0)).toBe(CellType.SOLID);
    expect(getCellByIndex(grid, 0, 0, -1)).toBe(CellType.SOLID);
    expect(getCellByIndex(grid, grid.nx + 5, 0, 0)).toBe(CellType.SOLID);
  });

  it('computes voxel stats correctly', () => {
    const grid = voxelize(emptyRoom4x3x27, 0.1);
    const stats = computeVoxelStats(grid, 12.34);

    expect(stats.cellCount).toBe(grid.cells.length);
    expect(stats.memoryBytes).toBe(grid.cells.byteLength);
    expect(stats.computeTimeMs).toBe(12.34);
    expect(stats.fluidCount).toBeGreaterThan(30000);
    expect(stats.solidCount).toBeGreaterThan(0);
  });

  it('runs voxelizeAsync and returns grid with compute duration', async () => {
    const res = await voxelizeAsync(emptyRoom4x3x27, 0.1);
    expect(res.grid).toBeDefined();
    expect(res.grid.cells.length).toBeGreaterThan(0);
    expect(res.timeMs).toBeGreaterThanOrEqual(0);
  });
});
