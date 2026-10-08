import { describe, expect, it } from 'vitest';
import { CATALOG_ASSETS, getCatalogAsset } from './catalog';

describe('Asset Catalog', () => {
  it('contains all required core assets', () => {
    const requiredIds = [
      'single-bed',
      'double-bed',
      'wardrobe',
      'desk',
      'office-chair',
      'sofa',
      'coffee-table',
      'dining-table',
      'bookshelf',
      'tv-unit',
      'pedestal-fan',
      'ceiling-fan',
      'air-purifier',
      'window',
      'door',
      'plant',
    ];

    for (const id of requiredIds) {
      const asset = getCatalogAsset(id);
      expect(asset, `Missing asset in catalog: ${id}`).toBeDefined();
    }
  });

  it('ensures all catalog items have size, role, and elevation defined', () => {
    expect(CATALOG_ASSETS.length).toBeGreaterThanOrEqual(16);

    for (const item of CATALOG_ASSETS) {
      expect(item.size).toBeDefined();
      expect(item.size).toHaveLength(3);
      expect(item.role).toBeDefined();
      expect(['solid', 'source', 'porous', 'none']).toContain(item.role);
      expect(typeof item.elevation).toBe('number');
      expect(item.elevation).toBeGreaterThanOrEqual(0);
    }
  });

  it('ensures all catalog dimensions are strictly greater than 0', () => {
    for (const item of CATALOG_ASSETS) {
      const [width, height, depth] = item.size;
      expect(width, `${item.id} width must be > 0`).toBeGreaterThan(0);
      expect(height, `${item.id} height must be > 0`).toBeGreaterThan(0);
      expect(depth, `${item.id} depth must be > 0`).toBeGreaterThan(0);
    }
  });

  it('sets wall-mounted flag strictly on window and door', () => {
    const windowAsset = getCatalogAsset('window');
    const doorAsset = getCatalogAsset('door');

    expect(windowAsset?.wallMounted).toBe(true);
    expect(doorAsset?.wallMounted).toBe(true);

    // Other floor items should not be wall-mounted
    const deskAsset = getCatalogAsset('desk');
    expect(deskAsset?.wallMounted).toBeFalsy();
  });

  it('ensures ceiling fan has elevation of 2.4m', () => {
    const ceilingFan = getCatalogAsset('ceiling-fan');
    expect(ceilingFan?.elevation).toBe(2.4);
    expect(ceilingFan?.role).toBe('source');
  });

  it('ensures window and door have accurate dimensions and sills', () => {
    const windowAsset = getCatalogAsset('window');
    expect(windowAsset?.size[0]).toBe(1.2); // width
    expect(windowAsset?.size[1]).toBe(1.2); // height
    expect(windowAsset?.elevation).toBe(0.9); // sill

    const doorAsset = getCatalogAsset('door');
    expect(doorAsset?.size[0]).toBe(0.9); // width
    expect(doorAsset?.size[1]).toBe(2.1); // height
    expect(doorAsset?.elevation).toBe(0);
  });
});
