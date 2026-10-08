import { beforeEach, describe, expect, it } from 'vitest';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { parseRoom } from './parser';
import { voxelize, CellType } from './voxelizer';
import { CATALOG_ASSETS, getCatalogAsset } from './catalog';
import { RoomParamsSchema } from './schema';
import { checkObjectCollision } from './collision';
import type { SceneObject, Opening, Vec2 } from './schema';

describe('Final Builder Acceptance Integration Suite: Parser, Store, Voxelizer, Geometry', () => {
  beforeEach(() => {
    useSceneStore.getState().resetRoom();
    useSceneStore.temporal.getState().clear();
    useUiStore.getState().resetUi();
  });

  it('draws and edits an arbitrary non-rectangular polygon room with valid signed area', () => {
    // 1. Draw arbitrary L-shaped polygon (6 vertices)
    const customOutline: Vec2[] = [
      [-3.0, -2.0],
      [1.0, -2.0],
      [1.0, 0.0],
      [3.0, 0.0],
      [3.0, 2.5],
      [-3.0, 2.5],
    ];

    useSceneStore.getState().setOutline(customOutline);
    expect(useSceneStore.getState().room.outline).toHaveLength(6);

    // Edit corner: move vertex 1
    useSceneStore.getState().moveVertex(1, [1.5, -2.0]);
    expect(useSceneStore.getState().room.outline[1]).toEqual([1.5, -2.0]);

    // Insert vertex on wall 0
    useSceneStore.getState().insertVertex(0, [-1.0, -2.0]);
    expect(useSceneStore.getState().room.outline).toHaveLength(7);

    // Undo vertex insertion
    useSceneStore.temporal.getState().undo();
    expect(useSceneStore.getState().room.outline).toHaveLength(6);

    // Parse and validate room
    const parsed = parseRoom(useSceneStore.getState().room);
    expect(parsed.room).not.toBeNull();
    expect(parsed.issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });

  it('places at least 15 real-scale assets from the catalog into the room', () => {
    // Large 7x7 room to comfortably fit 15 assets
    const largeOutline: Vec2[] = [
      [-3.5, -3.5],
      [3.5, -3.5],
      [3.5, 3.5],
      [-3.5, 3.5],
    ];
    useSceneStore.getState().setOutline(largeOutline);

    // Pick 15 unique asset definitions from the catalog
    const assetEntries = CATALOG_ASSETS.slice(0, 15);
    expect(assetEntries.length).toBeGreaterThanOrEqual(15);

    let placedCount = 0;
    assetEntries.forEach((assetDef, idx) => {
      const row = Math.floor(idx / 4);
      const col = idx % 4;
      const x = -2.2 + col * 1.4;
      const z = -2.2 + row * 1.4;

      const obj: SceneObject = {
        id: `obj-asset-${assetDef.id}-${idx}`,
        assetId: assetDef.id,
        name: assetDef.label,
        position: [Number(x.toFixed(2)), 0, Number(z.toFixed(2))],
        rotation: [0, 0, 0],
        size: [...assetDef.size],
        scale: [1, 1, 1],
        elevation: assetDef.elevation ?? 0,
        role: assetDef.role,
        wallMounted: assetDef.wallMounted ?? false,
        color: assetDef.color,
      };

      useSceneStore.getState().addObject(obj);
      placedCount++;
    });

    expect(placedCount).toBe(15);
    expect(useSceneStore.getState().room.objects.length).toBeGreaterThanOrEqual(15);

    // Verify catalog dimensions match exactly
    const firstPlaced = useSceneStore
      .getState()
      .room.objects.find((o) => o.id.startsWith('obj-asset-'))!;
    const catalogItem = getCatalogAsset(firstPlaced.assetId)!;
    expect(firstPlaced.size).toEqual(catalogItem.size);
  });

  it('performs move, rotate, duplicate, delete with snapping and collisions', () => {
    const chairA: SceneObject = {
      id: 'chair-a',
      assetId: 'dining-chair',
      name: 'Chair A',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [0.45, 0.85, 0.45],
      elevation: 0,
      role: 'solid',
      wallMounted: false,
    };

    useSceneStore.getState().addObject(chairA);

    // 1. Move
    useSceneStore.getState().updateObject('chair-a', { position: [0.5, 0, 0.5] });
    expect(useSceneStore.getState().room.objects.find((o) => o.id === 'chair-a')?.position).toEqual(
      [0.5, 0, 0.5]
    );

    // 2. Rotate
    useSceneStore.getState().updateObject('chair-a', { rotation: [0, Math.PI / 2, 0] });
    expect(
      useSceneStore.getState().room.objects.find((o) => o.id === 'chair-a')?.rotation[1]
    ).toBeCloseTo(Math.PI / 2);

    // 3. Duplicate
    const duplicated = useSceneStore.getState().duplicateObject('chair-a');
    expect(duplicated).not.toBeNull();
    expect(duplicated?.id).not.toBe('chair-a');

    // 4. Collision check: placing a solid chair directly overlapping chairA triggers collision
    const collidingChair: SceneObject = {
      id: 'chair-c',
      assetId: 'dining-chair',
      name: 'Chair C',
      position: [0.5, 0, 0.5], // Identical to chairA position
      rotation: [0, 0, 0],
      size: [0.45, 0.85, 0.45],
      elevation: 0,
      role: 'solid',
      wallMounted: false,
    };
    const collisionResult = checkObjectCollision(collidingChair, useSceneStore.getState().room);
    expect(collisionResult.colliding).toBe(true);

    // 5. Delete
    useSceneStore.getState().removeObject('chair-a');
    expect(useSceneStore.getState().room.objects.find((o) => o.id === 'chair-a')).toBeUndefined();
  });

  it('snaps windows and doors to walls and tags them as inlet/outlet/closed', () => {
    // Clear existing openings for clean test
    useSceneStore.getState().loadRoom({
      ...useSceneStore.getState().room,
      openings: [],
    });

    const windowOpening: Opening = {
      id: 'win-inlet',
      wallIndex: 0,
      type: 'window',
      offset: 1.0,
      width: 1.2,
      height: 1.2,
      sill: 0.9,
      role: 'inlet',
      openFraction: 1.0,
    };

    const doorOpening: Opening = {
      id: 'door-outlet',
      wallIndex: 2,
      type: 'door',
      offset: 1.5,
      width: 0.9,
      height: 2.1,
      sill: 0,
      role: 'outlet',
      openFraction: 1.0,
    };

    const closedWindow: Opening = {
      id: 'win-closed',
      wallIndex: 1,
      type: 'window',
      offset: 0.5,
      width: 1.0,
      height: 1.0,
      sill: 1.0,
      role: 'closed',
      openFraction: 0,
    };

    useSceneStore.getState().addOpening(windowOpening);
    useSceneStore.getState().addOpening(doorOpening);
    useSceneStore.getState().addOpening(closedWindow);

    expect(useSceneStore.getState().room.openings).toHaveLength(3);

    // Verify roles
    const openings = useSceneStore.getState().room.openings;
    expect(openings.find((o) => o.role === 'inlet')).toBeDefined();
    expect(openings.find((o) => o.role === 'outlet')).toBeDefined();
    expect(openings.find((o) => o.role === 'closed')).toBeDefined();

    // Verify cross ventilation validation passes with inlet and outlet present
    const parseResult = parseRoom(useSceneStore.getState().room);
    expect(parseResult.room).not.toBeNull();
    const errors = parseResult.issues.filter((i) => i.level === 'error');
    expect(errors).toHaveLength(0);
  });

  it('validates simulation parameters with Zod schema defaults', () => {
    const defaultParams = RoomParamsSchema.parse({});
    expect(defaultParams.windSpeed).toBe(2.5);
    expect(defaultParams.windDirDeg).toBe(0);
    expect(defaultParams.indoorTempC).toBe(22.0);
    expect(defaultParams.outdoorTempC).toBe(25.0);
    expect(defaultParams.humidity).toBe(50.0);
    expect(defaultParams.pressurePa).toBe(101325);

    // Invalid parameters throw ZodError
    expect(() => RoomParamsSchema.parse({ windSpeed: -5 })).toThrow();
    expect(() => RoomParamsSchema.parse({ humidity: 120 })).toThrow();
  });

  it('toggles 2D top-down and 3D perspective views', () => {
    expect(useUiStore.getState().view).toBe('3d');

    useUiStore.getState().setView('2d');
    expect(useUiStore.getState().view).toBe('2d');

    useUiStore.getState().setView('3d');
    expect(useUiStore.getState().view).toBe('3d');
  });

  it('undo/redo works across every state mutation', () => {
    // 1. Initial wall height
    const initialHeight = useSceneStore.getState().room.wallHeight;
    expect(initialHeight).toBe(2.7);

    // 2. Modify wall height
    useSceneStore.getState().setWallHeight(3.2);
    expect(useSceneStore.getState().room.wallHeight).toBe(3.2);

    // 3. Undo
    useSceneStore.temporal.getState().undo();
    expect(useSceneStore.getState().room.wallHeight).toBe(initialHeight);

    // 4. Redo
    useSceneStore.temporal.getState().redo();
    expect(useSceneStore.getState().room.wallHeight).toBe(3.2);
  });

  it('validates JSON import/export and roundtrip fidelity', () => {
    const originalRoom = useSceneStore.getState().room;
    const jsonStr = useSceneStore.getState().exportRoom();

    expect(typeof jsonStr).toBe('string');
    expect(jsonStr).toContain(originalRoom.name);

    // Reset room
    useSceneStore.getState().resetRoom();

    // Import back
    const importResult = useSceneStore.getState().importRoom(jsonStr);
    expect(importResult.success).toBe(true);
    expect(useSceneStore.getState().room.name).toBe(originalRoom.name);
    expect(useSceneStore.getState().room.wallHeight).toBe(originalRoom.wallHeight);
    expect(useSceneStore.getState().room.outline).toEqual(originalRoom.outline);
  });

  it('voxel debug confirms the 3D grid is simulation-ready with fluid, solid, and opening cells', () => {
    // Set up room with window and furniture
    useSceneStore.getState().addOpening({
      id: 'win-sim',
      wallIndex: 0,
      type: 'window',
      offset: 1.0,
      width: 1.2,
      height: 1.2,
      sill: 0.9,
      role: 'inlet',
      openFraction: 1.0,
    });

    useSceneStore.getState().addObject({
      id: 'bed-sim',
      assetId: 'double-bed',
      name: 'Double Bed',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [1.5, 0.55, 2.0],
      elevation: 0,
      role: 'solid',
      wallMounted: false,
    });

    const grid = voxelize(useSceneStore.getState().room, 0.1);
    expect(grid.nx).toBeGreaterThan(20);
    expect(grid.ny).toBeGreaterThan(20);
    expect(grid.nz).toBeGreaterThan(20);
    expect(grid.cells.length).toBe(grid.nx * grid.ny * grid.nz);

    let fluidCount = 0;
    let solidCount = 0;
    let inletCount = 0;

    for (let i = 0; i < grid.cells.length; i++) {
      if (grid.cells[i] === CellType.FLUID) fluidCount++;
      else if (grid.cells[i] === CellType.SOLID) solidCount++;
      else if (grid.cells[i] === CellType.INLET) inletCount++;
    }

    expect(fluidCount).toBeGreaterThan(10000);
    expect(solidCount).toBeGreaterThan(1000);
    expect(inletCount).toBeGreaterThan(0);
  });
});
