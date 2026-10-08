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

  it('fails if any catalog dimension is outside 0.05 - 4.0 m', () => {
    for (const item of CATALOG_ASSETS) {
      const [width, height, depth] = item.size;
      expect(
        width,
        `${item.id} width (${width}m) must be between 0.05m and 4.0m`
      ).toBeGreaterThanOrEqual(0.05);
      expect(
        width,
        `${item.id} width (${width}m) must be between 0.05m and 4.0m`
      ).toBeLessThanOrEqual(4.0);

      expect(
        height,
        `${item.id} height (${height}m) must be between 0.05m and 4.0m`
      ).toBeGreaterThanOrEqual(0.05);
      expect(
        height,
        `${item.id} height (${height}m) must be between 0.05m and 4.0m`
      ).toBeLessThanOrEqual(4.0);

      expect(
        depth,
        `${item.id} depth (${depth}m) must be between 0.05m and 4.0m`
      ).toBeGreaterThanOrEqual(0.05);
      expect(
        depth,
        `${item.id} depth (${depth}m) must be between 0.05m and 4.0m`
      ).toBeLessThanOrEqual(4.0);
    }
  });

  it('validates category-specific real-world sanity ranges', () => {
    for (const item of CATALOG_ASSETS) {
      const [w, h, d] = item.size;

      // Beds: length (depth Z) 0.9-2.2 m, width (X) 0.8-2.2 m, height (Y) 0.3-1.0 m
      if (item.id.includes('bed')) {
        expect(d, `${item.id} bed length must be 0.9-2.2m`).toBeGreaterThanOrEqual(0.9);
        expect(d, `${item.id} bed length must be 0.9-2.2m`).toBeLessThanOrEqual(2.2);
        expect(w, `${item.id} bed width must be 0.8-2.2m`).toBeGreaterThanOrEqual(0.8);
        expect(w, `${item.id} bed width must be 0.8-2.2m`).toBeLessThanOrEqual(2.2);
        expect(h, `${item.id} bed height must be 0.3-1.0m`).toBeGreaterThanOrEqual(0.3);
        expect(h, `${item.id} bed height must be 0.3-1.0m`).toBeLessThanOrEqual(1.0);
      }

      // Doors: width 0.8-1.0 m x height 1.9-2.2 m
      if (item.id === 'door') {
        expect(w, `Door width must be 0.8-1.0m`).toBeGreaterThanOrEqual(0.8);
        expect(w, `Door width must be 0.8-1.0m`).toBeLessThanOrEqual(1.0);
        expect(h, `Door height must be 1.9-2.2m`).toBeGreaterThanOrEqual(1.9);
        expect(h, `Door height must be 1.9-2.2m`).toBeLessThanOrEqual(2.2);
      }

      // Windows: width 0.4-2.4 m, height 0.4-2.0 m
      if (item.id === 'window') {
        expect(w, `Window width must be 0.4-2.4m`).toBeGreaterThanOrEqual(0.4);
        expect(w, `Window width must be 0.4-2.4m`).toBeLessThanOrEqual(2.4);
        expect(h, `Window height must be 0.4-2.0m`).toBeGreaterThanOrEqual(0.4);
        expect(h, `Window height must be 0.4-2.0m`).toBeLessThanOrEqual(2.0);
      }

      // Desks & Tables: height 0.4-1.1 m
      if (item.id.includes('desk') || item.id.includes('table')) {
        expect(h, `${item.id} table height must be 0.4-1.1m`).toBeGreaterThanOrEqual(0.4);
        expect(h, `${item.id} table height must be 0.4-1.1m`).toBeLessThanOrEqual(1.1);
      }

      // Wardrobe: height 1.8-2.4 m
      if (item.id === 'wardrobe') {
        expect(h, `Wardrobe height must be 1.8-2.4m`).toBeGreaterThanOrEqual(1.8);
        expect(h, `Wardrobe height must be 1.8-2.4m`).toBeLessThanOrEqual(2.4);
      }
    }
  });
});
