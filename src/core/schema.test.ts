import { describe, expect, it } from 'vitest';
import { createVentilatedRoom } from '../test/fixtures';
import {
  AirflowRoleSchema,
  ObjectSchema,
  OpeningRoleSchema,
  OpeningSchema,
  RoomParamsSchema,
  RoomSchema,
} from './schema';

describe('RoomSchema & Data Validation', () => {
  it('parses the default room successfully without errors', () => {
    const defaultRoom = createVentilatedRoom();
    const result = RoomSchema.safeParse(defaultRoom);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.name).toBe('Default Room (4x3m)');
      expect(result.data.wallHeight).toBe(2.7);
      expect(result.data.wallThickness).toBe(0.15);
      expect(result.data.outline).toHaveLength(4);
      expect(result.data.openings).toHaveLength(2);
      expect(result.data.objects).toEqual([]);
      expect(result.data.params.pressurePa).toBe(101325);
      expect(result.data.params.indoorTempC).toBe(22.0);
      expect(result.data.params.outdoorTempC).toBe(25.0);
    }
  });

  it('rejects negative widths in openings', () => {
    const invalidOpening = {
      id: 'win-bad',
      wallIndex: 0,
      type: 'window' as const,
      offset: 1.0,
      width: -1.2, // Negative width
      height: 1.2,
      sill: 0.9,
      role: 'inlet' as const,
      openFraction: 0.5,
    };

    const result = OpeningSchema.safeParse(invalidOpening);
    expect(result.success).toBe(false);
  });

  it('rejects zero width in openings', () => {
    const invalidOpening = {
      id: 'win-zero',
      wallIndex: 0,
      type: 'window' as const,
      offset: 1.0,
      width: 0, // Zero width
      height: 1.2,
      sill: 0.9,
      role: 'inlet' as const,
      openFraction: 0.5,
    };

    const result = OpeningSchema.safeParse(invalidOpening);
    expect(result.success).toBe(false);
  });

  it('rejects negative widths in object sizes', () => {
    const invalidObject = {
      id: 'obj-bad',
      assetId: 'desk',
      name: 'Bad Desk',
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number],
      size: [-1.4, 0.75, 0.7] as [number, number, number], // Negative width
      elevation: 0,
      role: 'solid' as const,
    };

    const result = ObjectSchema.safeParse(invalidObject);
    expect(result.success).toBe(false);
  });

  it('rejects wallHeight outside 2.0m - 6.0m bounds', () => {
    const defaultRoom = createVentilatedRoom();

    expect(RoomSchema.safeParse({ ...defaultRoom, wallHeight: 1.8 }).success).toBe(false);
    expect(RoomSchema.safeParse({ ...defaultRoom, wallHeight: 6.5 }).success).toBe(false);
    expect(RoomSchema.safeParse({ ...defaultRoom, wallHeight: 3.5 }).success).toBe(true);
  });

  it('rejects wallThickness outside 0.05m - 0.5m bounds', () => {
    const defaultRoom = createVentilatedRoom();

    expect(RoomSchema.safeParse({ ...defaultRoom, wallThickness: 0.02 }).success).toBe(false);
    expect(RoomSchema.safeParse({ ...defaultRoom, wallThickness: 0.6 }).success).toBe(false);
    expect(RoomSchema.safeParse({ ...defaultRoom, wallThickness: 0.2 }).success).toBe(true);
  });

  it('rejects outlines with fewer than 3 vertices', () => {
    const defaultRoom = createVentilatedRoom();

    expect(
      RoomSchema.safeParse({
        ...defaultRoom,
        outline: [
          [0, 0],
          [2, 0],
        ],
      }).success
    ).toBe(false);
  });

  it('validates airflow and opening roles correctly', () => {
    expect(AirflowRoleSchema.safeParse('solid').success).toBe(true);
    expect(AirflowRoleSchema.safeParse('source').success).toBe(true);
    expect(AirflowRoleSchema.safeParse('porous').success).toBe(true);
    expect(AirflowRoleSchema.safeParse('none').success).toBe(true);
    expect(AirflowRoleSchema.safeParse('unknown').success).toBe(false);

    expect(OpeningRoleSchema.safeParse('inlet').success).toBe(true);
    expect(OpeningRoleSchema.safeParse('outlet').success).toBe(true);
    expect(OpeningRoleSchema.safeParse('closed').success).toBe(true);
    expect(OpeningRoleSchema.safeParse('other').success).toBe(false);
  });

  it('applies sensible defaults for RoomParamsSchema when omitted', () => {
    const parsed = RoomParamsSchema.parse({});
    expect(parsed.windSpeed).toBe(2.5);
    expect(parsed.windDirDeg).toBe(0);
    expect(parsed.pressurePa).toBe(101325);
    expect(parsed.indoorTempC).toBe(22.0);
    expect(parsed.outdoorTempC).toBe(25.0);
    expect(parsed.humidity).toBe(50.0);
    expect(parsed.datetime).toBeDefined();
  });
});
