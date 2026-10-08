import { z } from 'zod';
import {
  AirflowRoleSchema,
  CatalogAssetSchema,
  FloorPointSchema,
  OpeningRoleSchema,
  OpeningSchema,
  OpeningTypeSchema,
  PlacedAssetSchema,
  RoomSchema,
  SceneDataSchema,
  SnapConfigSchema,
  Vector3Schema,
} from './schema';

export type AirflowRole = z.infer<typeof AirflowRoleSchema>;
export type OpeningRole = z.infer<typeof OpeningRoleSchema>;
export type OpeningType = z.infer<typeof OpeningTypeSchema>;
export type FloorPoint = z.infer<typeof FloorPointSchema>;
export type Vector3Tuple = z.infer<typeof Vector3Schema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type CatalogAsset = z.infer<typeof CatalogAssetSchema>;
export type PlacedAsset = z.infer<typeof PlacedAssetSchema>;
export type SnapConfig = z.infer<typeof SnapConfigSchema>;
export type SceneData = z.infer<typeof SceneDataSchema>;
