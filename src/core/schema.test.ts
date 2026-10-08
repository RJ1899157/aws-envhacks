import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ROTATION_SNAP_DEGREES,
  DEFAULT_ROTATION_SNAP_RADIANS,
  DEFAULT_TRANSLATION_SNAP_METERS,
} from './constants';
import {
  AirflowRoleSchema,
  CatalogAssetSchema,
  OpeningRoleSchema,
  OpeningSchema,
  PlacedAssetSchema,
  RoomSchema,
} from './schema';

describe('Global Conventions & Core Data Schemas', () => {
  it('enforces default snap values: 0.05 m translation and 15 degree rotation', () => {
    expect(DEFAULT_TRANSLATION_SNAP_METERS).toBe(0.05);
    expect(DEFAULT_ROTATION_SNAP_DEGREES).toBe(15);
    expect(DEFAULT_ROTATION_SNAP_RADIANS).toBeCloseTo((15 * Math.PI) / 180);
  });

  it('validates Room with floor polygon (counter-clockwise [x, z]) and wallHeight in meters', () => {
    const validRoom = {
      id: 'room-1',
      name: 'Office Room',
      polygon: [
        [-3, -2],
        [3, -2],
        [3, 2],
        [-3, 2],
      ],
      wallHeight: 2.8,
      openings: [],
    };

    const parsed = RoomSchema.parse(validRoom);
    expect(parsed.polygon).toHaveLength(4);
    expect(parsed.wallHeight).toBe(2.8);

    // Invalid polygon with fewer than 3 vertices
    expect(() =>
      RoomSchema.parse({
        ...validRoom,
        polygon: [
          [0, 0],
          [1, 1],
        ],
      })
    ).toThrow();
  });

  it('validates openings attached to a wall index with offset, dimensions, role, and openFraction', () => {
    const validWindow = {
      id: 'win-1',
      wallIndex: 0,
      type: 'window' as const,
      offset: 1.2,
      width: 1.5,
      height: 1.2,
      sill: 0.9,
      role: 'inlet' as const,
      openFraction: 0.8,
    };

    const parsed = OpeningSchema.parse(validWindow);
    expect(parsed.role).toBe('inlet');
    expect(parsed.openFraction).toBe(0.8);

    // Opening roles must be 'inlet' | 'outlet' | 'closed'
    expect(OpeningRoleSchema.safeParse('inlet').success).toBe(true);
    expect(OpeningRoleSchema.safeParse('outlet').success).toBe(true);
    expect(OpeningRoleSchema.safeParse('closed').success).toBe(true);
    expect(OpeningRoleSchema.safeParse('invalid').success).toBe(false);

    // openFraction must be between 0 and 1
    expect(() =>
      OpeningSchema.parse({
        ...validWindow,
        openFraction: 1.5,
      })
    ).toThrow();
  });

  it('validates airflow roles: "solid" | "source" | "porous" | "none"', () => {
    expect(AirflowRoleSchema.safeParse('solid').success).toBe(true);
    expect(AirflowRoleSchema.safeParse('source').success).toBe(true);
    expect(AirflowRoleSchema.safeParse('porous').success).toBe(true);
    expect(AirflowRoleSchema.safeParse('none').success).toBe(true);
    expect(AirflowRoleSchema.safeParse('other').success).toBe(false);
  });

  it('validates catalog assets with real-world dimensions in meters', () => {
    const validCatalogAsset = {
      id: 'desk-01',
      name: 'Office Desk',
      category: 'furniture',
      dimensions: [1.6, 0.75, 0.8] as [number, number, number], // width, height, depth in meters
      airflowRole: 'solid' as const,
    };

    const parsed = CatalogAssetSchema.parse(validCatalogAsset);
    expect(parsed.dimensions[0]).toBe(1.6);
    expect(parsed.dimensions[1]).toBe(0.75);
    expect(parsed.dimensions[2]).toBe(0.8);
  });

  it('validates placed asset instances with 3D transform and airflow role', () => {
    const validPlaced = {
      id: 'inst-1',
      catalogId: 'desk-01',
      name: 'Office Desk 1',
      position: [0.5, 0, -1.0] as [number, number, number],
      rotation: [0, Math.PI / 2, 0] as [number, number, number],
      dimensions: [1.6, 0.75, 0.8] as [number, number, number],
      airflowRole: 'solid' as const,
    };

    const parsed = PlacedAssetSchema.parse(validPlaced);
    expect(parsed.position).toEqual([0.5, 0, -1.0]);
    expect(parsed.airflowRole).toBe('solid');
  });
});
