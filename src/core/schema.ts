import { z } from 'zod';

/**
 * 2D vector on the XZ floor plane: [x, z] in meters
 */
export const Vec2Schema = z.tuple([z.number(), z.number()]);
export type Vec2 = z.infer<typeof Vec2Schema>;

/**
 * 3D vector: [x, y, z] in meters where Y is UP and XZ is the floor plane
 */
export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

/**
 * Positive 3D size bounding box: [width, height, depth] in meters
 */
export const PositiveVec3Schema = z.tuple([
  z.number().positive('Width must be greater than 0'),
  z.number().positive('Height must be greater than 0'),
  z.number().positive('Depth must be greater than 0'),
]);
export type PositiveVec3 = z.infer<typeof PositiveVec3Schema>;

/**
 * Airflow role classifications for CFD & IAQ simulation
 */
export const AirflowRoleSchema = z.enum(['solid', 'source', 'porous', 'none']);
export type AirflowRole = z.infer<typeof AirflowRoleSchema>;

/**
 * Role of a wall opening in ventilation
 */
export const OpeningRoleSchema = z.enum(['inlet', 'outlet', 'closed']);
export type OpeningRole = z.infer<typeof OpeningRoleSchema>;

/**
 * Architectural opening type
 */
export const OpeningTypeSchema = z.enum(['window', 'door']);
export type OpeningType = z.infer<typeof OpeningTypeSchema>;

/**
 * Wall opening schema (windows and doors)
 */
export const OpeningSchema = z.object({
  id: z.string().min(1),
  wallIndex: z.number().int().nonnegative('Wall index must be a non-negative integer'),
  type: OpeningTypeSchema,
  offset: z.number().nonnegative('Opening offset must be non-negative'),
  width: z.number().positive('Opening width must be positive'),
  height: z.number().positive('Opening height must be positive'),
  sill: z.number().nonnegative('Sill height must be non-negative'),
  role: OpeningRoleSchema.default('closed'),
  openFraction: z.number().min(0).max(1).default(0),
});
export type Opening = z.infer<typeof OpeningSchema>;

/**
 * 3D placed object instance in the room
 */
export const ObjectSchema = z.object({
  id: z.string().min(1),
  assetId: z.string().min(1),
  name: z.string().min(1),
  position: Vec3Schema, // [x, y, z] in meters
  rotation: Vec3Schema.default([0, 0, 0]), // [rx, ry, rz] Euler angles in radians
  size: PositiveVec3Schema, // [width, height, depth] in meters (all > 0)
  scale: Vec3Schema.optional(), // optional [sx, sy, sz] multiplier
  elevation: z.number().default(0), // elevation offset from floor in meters
  role: AirflowRoleSchema.default('solid'),
  wallMounted: z.boolean().default(false),
  color: z.string().optional(),
  defaultAirflow: z.number().optional(), // optional airflow rate (m³/h or m/s)
});
export type SceneObject = z.infer<typeof ObjectSchema>;

/**
 * Optional IAQ pollutant source parameters
 */
export const PollutantSourceSchema = z.object({
  type: z.string().default('VOC'),
  emissionRateMgH: z.number().nonnegative().default(10), // mg/hour
  position: Vec3Schema.optional(),
});
export type PollutantSource = z.infer<typeof PollutantSourceSchema>;

/**
 * Environmental and ventilation simulation parameters
 */
export const RoomParamsSchema = z.object({
  windSpeed: z.number().nonnegative('Wind speed cannot be negative').default(2.5), // m/s
  windDirDeg: z.number().min(0).max(360, 'Wind direction must be 0-360 degrees').default(0), // 0° = North
  pressurePa: z.number().positive('Atmospheric pressure must be positive').default(101325), // Pa
  indoorTempC: z.number().default(22.0), // °C
  outdoorTempC: z.number().default(25.0), // °C
  humidity: z.number().min(0).max(100, 'Humidity must be 0-100%').default(50.0), // %
  datetime: z.string().default('2026-10-05T12:00:00Z'),
  pollutantSource: PollutantSourceSchema.optional(),
});
export type RoomParams = z.infer<typeof RoomParamsSchema>;

/**
 * Per-wall override attributes for custom height, thickness, and material colour
 */
export const WallOverrideSchema = z.object({
  height: z.number().min(1.0).max(10.0).optional(),
  thickness: z.number().min(0.05).max(1.0).optional(),
  color: z.string().optional(),
});
export type WallOverride = z.infer<typeof WallOverrideSchema>;

/**
 * Complete Room specification for 3D modeling and IAQ simulation
 */
export const RoomSchema = z.object({
  version: z.literal(1).default(1),
  name: z.string().min(1).default('Default Room'),
  wallHeight: z
    .number()
    .min(2.0, 'Wall height must be at least 2.0m')
    .max(6.0, 'Wall height cannot exceed 6.0m')
    .default(2.7),
  wallThickness: z
    .number()
    .min(0.05, 'Wall thickness must be at least 0.05m')
    .max(0.5, 'Wall thickness cannot exceed 0.5m')
    .default(0.15),
  outline: z.array(Vec2Schema).min(3, 'Room outline must have at least 3 vertices'),
  openings: z.array(OpeningSchema).default([]),
  objects: z.array(ObjectSchema).default([]),
  params: RoomParamsSchema.default(() => RoomParamsSchema.parse({})),
  wallOverrides: z.record(z.coerce.number(), WallOverrideSchema).optional(),
});
export type Room = z.infer<typeof RoomSchema>;
