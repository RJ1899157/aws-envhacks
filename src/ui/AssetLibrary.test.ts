import { beforeEach, describe, expect, it } from 'vitest';
import { CATALOG_ASSETS, getCatalogAsset } from '../core/catalog';
import { wallSegment } from '../core/parser';
import { snap } from '../core/units';
import { useSceneStore } from '../store/sceneStore';
import { useUiStore } from '../store/uiStore';
import { AssetLibrary } from './AssetLibrary';

describe('AssetLibrary and Placement Logic', () => {
  beforeEach(() => {
    useSceneStore.getState().resetRoom();
    useUiStore.getState().resetUi();
  });

  it('exports AssetLibrary component', () => {
    expect(AssetLibrary).toBeDefined();
  });

  it('contains real dimensions for all catalog assets', () => {
    CATALOG_ASSETS.forEach((asset) => {
      const [w, h, d] = asset.size;
      expect(w).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(0);
      expect(d).toBeGreaterThan(0);

      const label = `${w.toFixed(2)} x ${h.toFixed(2)} x ${d.toFixed(2)} m`;
      expect(label).toMatch(/^\d+\.\d{2} x \d+\.\d{2} x \d+\.\d{2} m$/);
    });
  });

  it('filters catalog items by category and search queries', () => {
    const furniture = CATALOG_ASSETS.filter((a) => a.category === 'Living');
    expect(furniture.length).toBeGreaterThan(0);

    const hvac = CATALOG_ASSETS.filter((a) => a.category === 'Appliances and Airflow');
    expect(hvac.some((a) => a.id === 'pedestal-fan')).toBe(true);

    const openings = CATALOG_ASSETS.filter((a) => a.category === 'Openings');
    expect(openings.map((a) => a.id)).toContain('window');

    const walls = CATALOG_ASSETS.filter((a) => a.category === 'Walls').map((a) => a.id);
    expect(walls).toEqual(['archway', 'wide-archway', 'pass-through', 'partition-wall', 'half-partition', 'open-wall']);
  });

  it('places a floor object with exact catalog size into sceneStore', () => {
    const bedDef = getCatalogAsset('single-bed')!;
    expect(bedDef).toBeDefined();

    const placedObj = {
      id: 'bed-1',
      assetId: bedDef.id,
      name: bedDef.label,
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      size: [...bedDef.size] as [number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      elevation: bedDef.elevation,
      role: bedDef.role,
      wallMounted: false,
      color: bedDef.color,
    };

    useSceneStore.getState().addObject(placedObj);

    const roomObjects = useSceneStore.getState().room.objects;
    expect(roomObjects).toHaveLength(1);
    expect(roomObjects[0]!.size).toEqual([1.0, 0.5, 2.0]);
    expect(roomObjects[0]!.position).toEqual([0, 0, 0]);
  });

  it('snaps wall-mounted window/door to wall surface and creates an Opening in the store', () => {
    const room = useSceneStore.getState().room;
    const windowDef = getCatalogAsset('window')!;
    expect(windowDef.wallMounted).toBe(true);

    // Wall 0 segment
    const seg = wallSegment(room, 0);
    const windowWidth = windowDef.size[0]; // 1.2m
    const maxOffset = seg.len - windowWidth; // 4.0 - 1.2 = 2.8m

    const rawOffset = 1.02;
    const snappedOffset = snap(rawOffset, 0.05); // 1.00m
    expect(snappedOffset).toBeLessThanOrEqual(maxOffset);

    // Creates an Opening, NOT a SceneObject
    const opening = {
      id: 'win-placed-1',
      wallIndex: 0,
      type: 'window' as const,
      offset: snappedOffset,
      width: windowWidth,
      height: windowDef.size[1],
      sill: windowDef.elevation,
      role: 'inlet' as const,
      openFraction: 0,
    };

    const initialOpeningsCount = room.openings.length;
    useSceneStore.getState().addOpening(opening);

    const updatedOpenings = useSceneStore.getState().room.openings;
    expect(updatedOpenings).toHaveLength(initialOpeningsCount + 1);
    expect(updatedOpenings[updatedOpenings.length - 1]).toEqual(opening);
    // Ensure room.objects was NOT mutated by window placement
    expect(useSceneStore.getState().room.objects).toHaveLength(0);
  });

  it('handles placement cancellation via UI store tool reset', () => {
    useUiStore.getState().setActiveAssetId('double-bed');
    useUiStore.getState().setToolMode('place');

    expect(useUiStore.getState().activeAssetId).toBe('double-bed');
    expect(useUiStore.getState().toolMode).toBe('place');

    // Esc cancels placement
    useUiStore.getState().setActiveAssetId(null);
    useUiStore.getState().setToolMode('select');

    expect(useUiStore.getState().activeAssetId).toBeNull();
    expect(useUiStore.getState().toolMode).toBe('select');
  });
});
