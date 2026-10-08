import { z } from 'zod';
import {
  DEFAULT_ROTATION_SNAP_DEGREES,
  DEFAULT_TRANSLATION_SNAP_METERS,
  DEFAULT_WALL_HEIGHT_METERS,
} from './constants';

export const AirflowRoleSchema = z.enum(['solid', 'source', 'porous', 'none']);

export const OpeningRoleSchema = z.enum(['inlet', 'outlet', 'closed']);

export const OpeningTypeSchema = z.enum(['window', 'door']);

/**
 * 2D point on floor plane: [x, z] in meters
 */
export const FloorPointSchema = z.tuple([z.number(), z.number()]);

/**
 * 3D point in meters: [x, y, z] where Y is UP and XZ is the floor plane
 */
export const Vector3Schema = z.tuple([z.number(), z.number(), z.number()]);

/**
 * Window or door opening attached to a specific wall segment
 */
export const OpeningSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  wallIndex: z.number().int().nonnegative(),
  type: OpeningTypeSchema,
  offset: z.number().nonnegative(), // meters along the wall from vertex[wallIndex]
  width: z.number().positive(), // meters
  height: z.number().positive(), // meters
  sill: z.number().nonnegative(), // sill height from floor in meters
  role: OpeningRoleSchema,
  openFraction: z.number().min(0).max(1), // 0 to 1
});

/**
 * Room represented by a counter-clockwise floor polygon on XZ plane and wall height
 */
export const RoomSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  name: z.string().min(1),
  polygon: z.array(FloorPointSchema).min(3), // counter-clockwise outline of [x, z] points
  wallHeight: z.number().positive().default(DEFAULT_WALL_HEIGHT_METERS), // meters
  openings: z.array(OpeningSchema).default([]),
});

/**
 * Asset definition in catalog with real-world dimensions in meters
 */
export const CatalogAssetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  dimensions: Vector3Schema, // [width(x), height(y), depth(z)] in meters
  airflowRole: AirflowRoleSchema,
  modelUrl: z.string().optional(),
});

/**
 * Placed asset instance in the 3D room
 */
export const PlacedAssetSchema = z.object({
  id: z.string().uuid().or(z.string().min(1)),
  catalogId: z.string().min(1),
  name: z.string().min(1),
  position: Vector3Schema, // [x, y, z] in meters (Y is up)
  rotation: Vector3Schema, // [rx, ry, rz] Euler angles in radians
  dimensions: Vector3Schema, // bounding box [width, height, depth] in meters
  airflowRole: AirflowRoleSchema,
});

/**
 * Snap settings configuration
 */
export const SnapConfigSchema = z.object({
  translation: z.number().positive().default(DEFAULT_TRANSLATION_SNAP_METERS),
  rotation: z.number().positive().default(DEFAULT_ROTATION_SNAP_DEGREES),
  enabled: z.boolean().default(true),
});

/**
 * Complete scene state schema
 */
export const SceneDataSchema = z.object({
  room: RoomSchema,
  placedAssets: z.array(PlacedAssetSchema),
  selectedId: z.string().nullable(),
  snapConfig: SnapConfigSchema,
});
