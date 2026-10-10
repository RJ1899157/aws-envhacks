import { z } from 'zod';
import { AirflowRoleSchema } from './schema';

export const SourceUnitSchema = z.enum(['m', 'cm', 'mm', 'in']);
export type SourceUnit = z.infer<typeof SourceUnitSchema>;

export const FitModeSchema = z.enum(['contain', 'stretch']);
export type FitMode = z.infer<typeof FitModeSchema>;

export const AssetDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  category: z.string().min(1),
  size: z.tuple([z.number(), z.number(), z.number()]),
  elevation: z.number().default(0),
  role: AirflowRoleSchema,
  wallMounted: z.boolean().optional(),
  color: z.string(),
  variants: z.array(z.string()).optional(),
  defaultAirflow: z.number().optional(),
  model: z.string().optional(),
  fitMode: FitModeSchema.default('contain').optional(),
  sourceUnit: SourceUnitSchema.default('m').optional(),
});
export type AssetDef = z.infer<typeof AssetDefSchema>;

// `defaultAirflow` is m³/h. Device values follow DEFAULT_DEVICE_FLOW_M3H in simulation/constants.ts:
// ceiling fan ≈ BIS IS 374 minimum air delivery of a 1200 mm fan, pedestal fan ≈ 400 mm fan,
// split AC ≈ 1.5 TR indoor unit, purifier = PM2.5 CADR, exhaust fan / range hood = extraction rate.
export const CATALOG_ASSETS: readonly AssetDef[] = [
  // BEDROOM
  { id: 'single-bed', label: 'Single Bed', category: 'Bedroom', size: [1.0, 0.5, 2.0], elevation: 0, role: 'solid', color: '#4f46e5', variants: ['#4f46e5', '#374151', '#fcd34d'] },
  { id: 'double-bed', label: 'Double Bed', category: 'Bedroom', size: [1.5, 0.55, 2.0], elevation: 0, role: 'solid', color: '#4338ca', variants: ['#4338ca', '#9ca3af', '#fbbf24'] },
  { id: 'king-bed', label: 'King Bed', category: 'Bedroom', size: [1.8, 0.6, 2.0], elevation: 0, role: 'solid', color: '#312e81', variants: ['#312e81', '#1f2937', '#b45309'] },
  { id: 'wardrobe', label: 'Wardrobe', category: 'Bedroom', size: [1.2, 2.0, 0.6], elevation: 0, role: 'solid', color: '#78350f', variants: ['#78350f', '#fcd34d', '#ffffff'] },
  { id: 'nightstand', label: 'Nightstand', category: 'Bedroom', size: [0.5, 0.5, 0.4], elevation: 0, role: 'solid', color: '#78350f', variants: ['#78350f', '#d97706', '#1e293b'] },
  { id: 'dresser', label: 'Dresser', category: 'Bedroom', size: [1.2, 0.8, 0.5], elevation: 0, role: 'solid', color: '#78350f', variants: ['#78350f', '#92400e', '#ffffff'] },

  // LIVING
  { id: 'sofa-2-seater', label: 'Sofa (2-Seater)', category: 'Living', size: [1.6, 0.85, 0.9], elevation: 0, role: 'solid', color: '#047857', variants: ['#047857', '#3b82f6', '#d1d5db'] },
  { id: 'sofa-3-seater', label: 'Sofa (3-Seater)', category: 'Living', size: [2.1, 0.85, 0.9], elevation: 0, role: 'solid', color: '#065f46', variants: ['#065f46', '#1d4ed8', '#9ca3af'] },
  { id: 'armchair', label: 'Armchair', category: 'Living', size: [0.9, 0.9, 0.9], elevation: 0, role: 'solid', color: '#b91c1c', variants: ['#b91c1c', '#047857', '#fb923c'] },
  { id: 'coffee-table', label: 'Coffee Table', category: 'Living', size: [1.0, 0.45, 0.6], elevation: 0, role: 'solid', color: '#b45309', variants: ['#b45309', '#fef3c7', '#172554'] },
  { id: 'tv-unit', label: 'TV Unit', category: 'Living', size: [1.5, 0.45, 0.4], elevation: 0, role: 'solid', color: '#374151', variants: ['#374151', '#78350f', '#f8fafc'] },
  { id: 'bookshelf', label: 'Bookshelf', category: 'Living', size: [0.8, 1.8, 0.35], elevation: 0, role: 'porous', color: '#854d0e', variants: ['#854d0e', '#facc15', '#0f172a'] },

  // DINING
  { id: 'dining-table', label: 'Dining Table', category: 'Dining', size: [1.6, 0.76, 0.9], elevation: 0, role: 'solid', color: '#7c2d12', variants: ['#7c2d12', '#d97706', '#f8fafc'] },
  { id: 'dining-chair', label: 'Dining Chair', category: 'Dining', size: [0.45, 0.95, 0.5], elevation: 0, role: 'porous', color: '#1e293b', variants: ['#1e293b', '#7c2d12', '#cbd5e1'] },
  { id: 'round-dining-table', label: 'Round Dining Table', category: 'Dining', size: [1.1, 0.75, 1.1], elevation: 0, role: 'solid', color: '#92400e', variants: ['#92400e', '#f8fafc', '#1e293b'] },
  { id: 'sideboard', label: 'Sideboard', category: 'Dining', size: [1.4, 0.8, 0.45], elevation: 0, role: 'solid', color: '#92400e', variants: ['#92400e', '#475569', '#f1f5f9'] },

  // KITCHEN
  { id: 'kitchen-island', label: 'Kitchen Island', category: 'Kitchen', size: [2.0, 0.9, 0.9], elevation: 0, role: 'solid', color: '#1e293b', variants: ['#1e293b', '#f1f5f9', '#b45309'] },
  { id: 'fridge', label: 'Refrigerator', category: 'Kitchen', size: [0.9, 1.8, 0.7], elevation: 0, role: 'solid', color: '#cbd5e1', variants: ['#cbd5e1', '#0f172a', '#f8fafc'] },
  { id: 'oven', label: 'Oven Range', category: 'Kitchen', size: [0.6, 0.9, 0.6], elevation: 0, role: 'solid', color: '#94a3b8', variants: ['#94a3b8', '#1e293b', '#ffffff'] },
  { id: 'kitchen-counter', label: 'Kitchen Counter', category: 'Kitchen', size: [2.4, 0.9, 0.6], elevation: 0, role: 'solid', color: '#e2e8f0', variants: ['#e2e8f0', '#1e293b', '#b45309'] },
  { id: 'kitchen-sink', label: 'Kitchen Sink Unit', category: 'Kitchen', size: [1.0, 0.9, 0.6], elevation: 0, role: 'solid', color: '#cbd5e1', variants: ['#cbd5e1', '#f8fafc', '#1e293b'] },
  { id: 'range-hood', label: 'Range Hood (Exhaust)', category: 'Kitchen', size: [0.9, 0.45, 0.5], elevation: 1.6, role: 'source', defaultAirflow: 400, color: '#94a3b8', variants: ['#94a3b8', '#1e293b', '#f8fafc'] },
  { id: 'dishwasher', label: 'Dishwasher', category: 'Kitchen', size: [0.6, 0.85, 0.6], elevation: 0, role: 'solid', color: '#e2e8f0', variants: ['#e2e8f0', '#475569', '#ffffff'] },

  // BATHROOM
  { id: 'bathtub', label: 'Bathtub', category: 'Bathroom', size: [1.7, 0.6, 0.8], elevation: 0, role: 'solid', color: '#ffffff', variants: ['#ffffff', '#f1f5f9'] },
  { id: 'toilet', label: 'Toilet', category: 'Bathroom', size: [0.4, 0.8, 0.7], elevation: 0, role: 'solid', color: '#ffffff', variants: ['#ffffff', '#f8fafc'] },
  { id: 'sink-vanity', label: 'Sink Vanity', category: 'Bathroom', size: [0.9, 0.85, 0.5], elevation: 0, role: 'solid', color: '#e2e8f0', variants: ['#e2e8f0', '#78350f', '#0f172a'] },
  { id: 'washing-machine', label: 'Washing Machine', category: 'Bathroom', size: [0.6, 0.85, 0.6], elevation: 0, role: 'solid', color: '#f1f5f9', variants: ['#f1f5f9', '#94a3b8'] },
  { id: 'towel-cabinet', label: 'Towel Cabinet', category: 'Bathroom', size: [0.6, 1.8, 0.35], elevation: 0, role: 'solid', color: '#f8fafc', variants: ['#f8fafc', '#78350f'] },
  { id: 'shower-cabin', label: 'Shower Cabin', category: 'Bathroom', size: [0.9, 2.0, 0.9], elevation: 0, role: 'porous', color: '#bae6fd', variants: ['#bae6fd', '#38bdf8'] },

  // OFFICE
  { id: 'desk', label: 'Office Desk', category: 'Office', size: [1.4, 0.75, 0.7], elevation: 0, role: 'solid', color: '#92400e', variants: ['#92400e', '#1e293b', '#f8fafc'] },
  { id: 'office-chair', label: 'Office Chair', category: 'Office', size: [0.65, 0.95, 0.65], elevation: 0, role: 'porous', color: '#1f2937', variants: ['#1f2937', '#475569', '#b91c1c'] },
  { id: 'filing-cabinet', label: 'Filing Cabinet', category: 'Office', size: [0.4, 0.6, 0.5], elevation: 0, role: 'solid', color: '#64748b', variants: ['#64748b', '#cbd5e1', '#0f172a'] },

  // APPLIANCES & AIRFLOW
  { id: 'pedestal-fan', label: 'Pedestal Fan', category: 'Appliances and Airflow', size: [0.45, 1.3, 0.45], elevation: 0, role: 'source', defaultAirflow: 4500, color: '#0284c7', variants: ['#0284c7', '#0f172a', '#e2e8f0'] },
  { id: 'ceiling-fan', label: 'Ceiling Fan', category: 'Appliances and Airflow', size: [1.2, 0.35, 1.2], elevation: 2.4, role: 'source', defaultAirflow: 12600, color: '#0369a1', variants: ['#0369a1', '#ffffff', '#78350f'] },
  { id: 'air-purifier', label: 'Air Purifier', category: 'Appliances and Airflow', size: [0.38, 0.6, 0.38], elevation: 0, role: 'source', defaultAirflow: 300, color: '#e0e7ff', variants: ['#e0e7ff', '#1e293b', '#cbd5e1'] },
  { id: 'ac-split', label: 'Split AC', category: 'Appliances and Airflow', size: [0.9, 0.3, 0.25], elevation: 2.2, wallMounted: true, role: 'source', defaultAirflow: 1000, color: '#f8fafc', variants: ['#f8fafc', '#e2e8f0'] },
  { id: 'exhaust-fan', label: 'Exhaust Fan', category: 'Appliances and Airflow', size: [0.3, 0.3, 0.15], elevation: 2.0, wallMounted: true, role: 'source', defaultAirflow: 250, color: '#cbd5e1', variants: ['#cbd5e1', '#475569'] },
  { id: 'humidifier', label: 'Humidifier', category: 'Appliances and Airflow', size: [0.2, 0.4, 0.2], elevation: 0, role: 'source', defaultAirflow: 50, color: '#bae6fd', variants: ['#bae6fd', '#ffffff'] },
  { id: 'dehumidifier', label: 'Dehumidifier', category: 'Appliances and Airflow', size: [0.3, 0.5, 0.3], elevation: 0, role: 'source', defaultAirflow: 150, color: '#94a3b8', variants: ['#94a3b8', '#e2e8f0'] },
  { id: 'heater', label: 'Space Heater', category: 'Appliances and Airflow', size: [0.25, 0.6, 0.2], elevation: 0, role: 'source', defaultAirflow: 100, color: '#ef4444', variants: ['#ef4444', '#1e293b'] },

  // POLLUTION SOURCES (device 'pm25Source'; rates and emission heights in simulation/constants.ts PM25_SOURCE_PRESETS).
  // Small markers that do not block air (role 'none'); the top of each sits near its emission height.
  { id: 'pm25-stove-frying', label: 'Gas Stove: Frying', category: 'Pollution sources', size: [0.36, 0.1, 0.36], elevation: 0.9, role: 'none', color: '#f97316', variants: ['#f97316'] },
  { id: 'pm25-stove-boiling', label: 'Gas Stove: Boiling', category: 'Pollution sources', size: [0.3, 0.18, 0.3], elevation: 0.9, role: 'none', color: '#94a3b8', variants: ['#94a3b8'] },
  { id: 'pm25-tawa', label: 'Tawa / Roti', category: 'Pollution sources', size: [0.32, 0.06, 0.32], elevation: 0.92, role: 'none', color: '#44403c', variants: ['#44403c'] },
  { id: 'pm25-incense', label: 'Incense (Agarbatti)', category: 'Pollution sources', size: [0.1, 0.3, 0.1], elevation: 0.6, role: 'none', color: '#a16207', variants: ['#a16207'] },
  { id: 'pm25-mosquito-coil', label: 'Mosquito Coil', category: 'Pollution sources', size: [0.15, 0.05, 0.15], elevation: 0.05, role: 'none', color: '#15803d', variants: ['#15803d'] },
  { id: 'pm25-candle', label: 'Candle / Diya', category: 'Pollution sources', size: [0.1, 0.12, 0.1], elevation: 0.68, role: 'none', color: '#fbbf24', variants: ['#fbbf24'] },
  { id: 'pm25-cigarette', label: 'Cigarette', category: 'Pollution sources', size: [0.12, 0.05, 0.12], elevation: 0.95, role: 'none', color: '#e7e5e4', variants: ['#e7e5e4'] },
  { id: 'pm25-sweeping', label: 'Sweeping / Dusting', category: 'Pollution sources', size: [0.3, 0.3, 0.12], elevation: 0, role: 'none', color: '#ca8a04', variants: ['#ca8a04'] },
  { id: 'pm25-toilet-flush', label: 'Toilet Flushing', category: 'Pollution sources', size: [0.4, 0.8, 0.7], elevation: 0, role: 'none', color: '#f8fafc', variants: ['#f8fafc'] },
  { id: 'pm25-heater', label: 'Kerosene / Coal Heater', category: 'Pollution sources', size: [0.4, 0.5, 0.3], elevation: 0, role: 'none', color: '#b91c1c', variants: ['#b91c1c'] },

  // OPENINGS
  { id: 'single-door', label: 'Single Door', category: 'Openings', size: [0.9, 2.1, 0.15], elevation: 0, role: 'none', wallMounted: true, color: '#a16207', variants: ['#a16207', '#ffffff', '#1e293b'] },
  { id: 'double-door', label: 'Double Door', category: 'Openings', size: [1.6, 2.1, 0.15], elevation: 0, role: 'none', wallMounted: true, color: '#92400e', variants: ['#92400e', '#ffffff', '#1e293b'] },
  { id: 'sliding-door', label: 'Sliding Door', category: 'Openings', size: [2.0, 2.1, 0.15], elevation: 0, role: 'none', wallMounted: true, color: '#38bdf8', variants: ['#38bdf8', '#1e293b', '#ffffff'] },
  { id: 'window', label: 'Window', category: 'Openings', size: [1.2, 1.2, 0.15], elevation: 0.9, role: 'porous', wallMounted: true, color: '#38bdf8', variants: ['#38bdf8', '#ffffff', '#1e293b'] },
  { id: 'wide-window', label: 'Wide Window', category: 'Openings', size: [1.8, 1.2, 0.15], elevation: 0.9, role: 'porous', wallMounted: true, color: '#38bdf8', variants: ['#38bdf8', '#ffffff', '#1e293b'] },
  { id: 'vent', label: 'Air Vent', category: 'Openings', size: [0.4, 0.4, 0.15], elevation: 2.0, role: 'porous', wallMounted: true, color: '#94a3b8', variants: ['#94a3b8', '#ffffff', '#1e293b'] },
  { id: 'archway', label: 'Archway', category: 'Walls', size: [1.2, 2.2, 0.15], elevation: 0, role: 'none', wallMounted: true, color: '#e2e8f0', variants: ['#e2e8f0', '#ffffff', '#94a3b8'] },
  { id: 'wide-archway', label: 'Wide Archway', category: 'Walls', size: [2.4, 2.4, 0.15], elevation: 0, role: 'none', wallMounted: true, color: '#e2e8f0', variants: ['#e2e8f0', '#ffffff'] },
  { id: 'pass-through', label: 'Kitchen Pass-Through', category: 'Walls', size: [1.8, 1.2, 0.15], elevation: 1.0, role: 'none', wallMounted: true, color: '#e2e8f0', variants: ['#e2e8f0', '#ffffff'] },
  { id: 'open-wall', label: 'Open Wall (remove wall)', category: 'Walls', size: [1.0, 2.7, 0.15], elevation: 0, role: 'none', wallMounted: true, color: '#94a3b8', variants: ['#94a3b8'] },

  // DECOR
  { id: 'plant', label: 'Potted Plant', category: 'Decor', size: [0.4, 0.8, 0.4], elevation: 0, role: 'porous', color: '#15803d', variants: ['#15803d', '#4ade80', '#065f46'] },
  { id: 'rug', label: 'Area Rug', category: 'Decor', size: [2.0, 0.05, 1.5], elevation: 0, role: 'none', color: '#f8fafc', variants: ['#f8fafc', '#94a3b8', '#b91c1c'] },
  { id: 'curtains', label: 'Curtains', category: 'Decor', size: [1.5, 2.2, 0.1], elevation: 0.1, wallMounted: true, role: 'porous', color: '#e0e7ff', variants: ['#e0e7ff', '#fef3c7', '#fecdd3'] },
  { id: 'floor-lamp', label: 'Floor Lamp', category: 'Decor', size: [0.3, 1.6, 0.3], elevation: 0, role: 'porous', color: '#fcd34d', variants: ['#fcd34d', '#1e293b', '#e2e8f0'] },
  
  // Legacy aliases for tests
  { id: 'door', label: 'Single Door', category: 'Openings', size: [0.9, 2.1, 0.15], elevation: 0, role: 'none', wallMounted: true, color: '#a16207', variants: [] },
  { id: 'sofa', label: 'Sofa', category: 'Living', size: [2.1, 0.85, 0.9], elevation: 0, role: 'solid', color: '#047857', variants: [] },
];

export const CATALOG_MAP: ReadonlyMap<string, AssetDef> = new Map(
  CATALOG_ASSETS.map((asset) => [asset.id, asset as AssetDef])
);

export function getCatalogAsset(id: string): AssetDef | undefined {
  return CATALOG_MAP.get(id);
}
