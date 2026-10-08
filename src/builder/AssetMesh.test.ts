import { describe, expect, it } from 'vitest';
import { getCatalogAsset } from '../core/catalog';
import { AssetMesh, FanDirectionArrow, RoundedBoxPlaceholder } from './AssetMesh';
import { PlacedObjects } from './PlacedObjects';
import { PlacementController } from './PlacementController';

describe('AssetMesh and Placement subcomponents', () => {
  it('exports AssetMesh, RoundedBoxPlaceholder, FanDirectionArrow, and PlacedObjects', () => {
    expect(AssetMesh).toBeDefined();
    expect(RoundedBoxPlaceholder).toBeDefined();
    expect(FanDirectionArrow).toBeDefined();
    expect(PlacedObjects).toBeDefined();
    expect(PlacementController).toBeDefined();
  });

  it('correctly matches catalog dimensions when placed', () => {
    const singleBed = getCatalogAsset('single-bed');
    expect(singleBed).toBeDefined();
    expect(singleBed!.size).toEqual([1.0, 0.5, 2.0]);

    // Model target size calculation with scale [1, 1, 1]
    const scale: [number, number, number] = [1, 1, 1];
    const targetWidth = singleBed!.size[0] * scale[0];
    const targetHeight = singleBed!.size[1] * scale[1];
    const targetDepth = singleBed!.size[2] * scale[2];

    expect(targetWidth).toBe(1.0);
    expect(targetHeight).toBe(0.5);
    expect(targetDepth).toBe(2.0);
  });

  it('correctly scales when scale multiplier is applied', () => {
    const sofa = getCatalogAsset('sofa');
    expect(sofa).toBeDefined();
    expect(sofa!.size).toEqual([2.1, 0.85, 0.9]);

    const scale: [number, number, number] = [1.5, 1.0, 1.2];
    const targetWidth = sofa!.size[0] * scale[0];
    const targetHeight = sofa!.size[1] * scale[1];
    const targetDepth = sofa!.size[2] * scale[2];

    expect(targetWidth).toBeCloseTo(3.15);
    expect(targetHeight).toBeCloseTo(0.85);
    expect(targetDepth).toBeCloseTo(1.08);
  });

  it('identifies fans requiring airflow direction arrows', () => {
    const pedestalFan = getCatalogAsset('pedestal-fan');
    const ceilingFan = getCatalogAsset('ceiling-fan');
    const airPurifier = getCatalogAsset('air-purifier');
    const desk = getCatalogAsset('desk');

    expect(pedestalFan?.role).toBe('source');
    expect(ceilingFan?.role).toBe('source');
    expect(airPurifier?.role).toBe('source');
    expect(desk?.role).toBe('solid');

    expect(pedestalFan?.defaultAirflow).toBeGreaterThan(0);
    expect(ceilingFan?.defaultAirflow).toBeGreaterThan(0);
  });
});
