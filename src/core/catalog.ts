import { z } from 'zod';
import { AirflowRoleSchema, PositiveVec3Schema, type PositiveVec3 } from './schema';

/**
 * Asset definition schema for the item catalog
 */
export const AssetDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.string().min(1),
  size: PositiveVec3Schema, // [width, height, depth] in meters
  elevation: z.number().default(0), // default elevation from floor in meters
  role: AirflowRoleSchema,
  wallMounted: z.boolean().optional(),
  color: z.string(),
  defaultAirflow: z.number().optional(), // airflow rate in m³/h
});
export type AssetDef = z.infer<typeof AssetDefSchema>;

/**
 * AirForce asset catalog with realistic real-world dimensions (in meters),
 * airflow simulation roles, and mounting properties.
 */
export const CATALOG_ASSETS: readonly AssetDef[] = [
  {
    id: 'single-bed',
    label: 'Single Bed',
    category: 'furniture',
    size: [1.0, 0.5, 2.0] as PositiveVec3,
    elevation: 0,
    role: 'solid',
    color: '#4f46e5',
  },
  {
    id: 'double-bed',
    label: 'Double Bed',
    category: 'furniture',
    size: [1.5, 0.55, 2.0] as PositiveVec3,
    elevation: 0,
    role: 'solid',
    color: '#4338ca',
  },
  {
    id: 'wardrobe',
    label: 'Wardrobe',
    category: 'furniture',
    size: [1.2, 2.0, 0.6] as PositiveVec3,
    elevation: 0,
    role: 'solid',
    color: '#78350f',
  },
  {
    id: 'desk',
    label: 'Desk',
    category: 'furniture',
    size: [1.4, 0.75, 0.7] as PositiveVec3,
    elevation: 0,
    role: 'solid',
    color: '#92400e',
  },
  {
    id: 'office-chair',
    label: 'Office Chair',
    category: 'furniture',
    size: [0.65, 0.95, 0.65] as PositiveVec3,
    elevation: 0,
    role: 'porous',
    color: '#1f2937',
  },
  {
    id: 'sofa',
    label: 'Sofa',
    category: 'furniture',
    size: [2.1, 0.85, 0.9] as PositiveVec3,
    elevation: 0,
    role: 'solid',
    color: '#047857',
  },
  {
    id: 'coffee-table',
    label: 'Coffee Table',
    category: 'furniture',
    size: [1.0, 0.45, 0.6] as PositiveVec3,
    elevation: 0,
    role: 'solid',
    color: '#b45309',
  },
  {
    id: 'dining-table',
    label: 'Dining Table',
    category: 'furniture',
    size: [1.6, 0.76, 0.9] as PositiveVec3,
    elevation: 0,
    role: 'solid',
    color: '#7c2d12',
  },
  {
    id: 'bookshelf',
    label: 'Bookshelf',
    category: 'furniture',
    size: [0.8, 1.8, 0.35] as PositiveVec3,
    elevation: 0,
    role: 'porous',
    color: '#854d0e',
  },
  {
    id: 'tv-unit',
    label: 'TV Unit',
    category: 'furniture',
    size: [1.5, 0.45, 0.4] as PositiveVec3,
    elevation: 0,
    role: 'solid',
    color: '#374151',
  },
  {
    id: 'pedestal-fan',
    label: 'Pedestal Fan',
    category: 'hvac',
    size: [0.45, 1.3, 0.45] as PositiveVec3,
    elevation: 0,
    role: 'source',
    defaultAirflow: 500,
    color: '#0284c7',
  },
  {
    id: 'ceiling-fan',
    label: 'Ceiling Fan',
    category: 'hvac',
    size: [1.2, 0.35, 1.2] as PositiveVec3,
    elevation: 2.4,
    role: 'source',
    defaultAirflow: 800,
    color: '#0369a1',
  },
  {
    id: 'air-purifier',
    label: 'Air Purifier',
    category: 'hvac',
    size: [0.38, 0.6, 0.38] as PositiveVec3,
    elevation: 0,
    role: 'source',
    defaultAirflow: 300,
    color: '#e0e7ff',
  },
  {
    id: 'window',
    label: 'Window',
    category: 'openings',
    size: [1.2, 1.2, 0.15] as PositiveVec3,
    elevation: 0.9,
    role: 'porous',
    wallMounted: true,
    color: '#38bdf8',
  },
  {
    id: 'door',
    label: 'Door',
    category: 'openings',
    size: [0.9, 2.1, 0.15] as PositiveVec3,
    elevation: 0,
    role: 'none',
    wallMounted: true,
    color: '#a16207',
  },
  {
    id: 'plant',
    label: 'Plant',
    category: 'decor',
    size: [0.4, 0.8, 0.4] as PositiveVec3,
    elevation: 0,
    role: 'porous',
    color: '#15803d',
  },
] as const;

/**
 * Map index for quick catalog asset lookups
 */
export const CATALOG_MAP: ReadonlyMap<string, AssetDef> = new Map(
  CATALOG_ASSETS.map((asset) => [asset.id, asset])
);

/**
 * Retrieve an asset definition from the catalog by ID
 */
export function getCatalogAsset(id: string): AssetDef | undefined {
  return CATALOG_MAP.get(id);
}
