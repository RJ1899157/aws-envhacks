import { CATALOG_ASSETS, getCatalogAsset, type AssetDef } from '../../core/catalog';

/**
 * The app's short asset list. It only picks and relabels catalogue entries (the full
 * library and saved designs are unaffected): ventilation and pollution sources up front, a handful
 * of furniture big enough to block air, and everything else tucked under "More furniture".
 */

export interface AltItem {
  assetId: string;
  label: string;
  hint: string;
}

export interface AltGroup {
  title: string;
  items: AltItem[];
}

export const VENTILATION_GROUPS: AltGroup[] = [
  {
    title: 'Windows',
    items: [
      { assetId: 'window', label: 'Window', hint: 'Standard 1.2 m window' },
      { assetId: 'wide-window', label: 'Wide window', hint: '1.8 m, lets more air in' },
      { assetId: 'vent', label: 'Air vent', hint: 'Small opening high on the wall' },
    ],
  },
  {
    title: 'Doors & balcony',
    items: [
      { assetId: 'single-door', label: 'Door', hint: 'Between rooms or to outside' },
      { assetId: 'sliding-door', label: 'Balcony door', hint: 'Full-height sliding door' },
      { assetId: 'archway', label: 'Open passage', hint: 'Doorway with no door' },
    ],
  },
  {
    title: 'Exhaust',
    items: [
      { assetId: 'exhaust-fan', label: 'Exhaust fan', hint: 'Kitchen or bathroom wall, blows air outside' },
      { assetId: 'range-hood', label: 'Range hood', hint: 'Above the stove, pulls cooking smoke out' },
    ],
  },
  {
    title: 'Fans, AC & purifier',
    items: [
      { assetId: 'ceiling-fan', label: 'Ceiling fan', hint: 'Mixes the air in the room' },
      { assetId: 'pedestal-fan', label: 'Pedestal fan', hint: 'Pushes air in one direction' },
      { assetId: 'ac-split', label: 'Split AC', hint: 'Recirculates room air (no fresh air)' },
      { assetId: 'air-purifier', label: 'Air purifier', hint: 'Filters PM2.5 out of the room' },
    ],
  },
];

export const POLLUTION_GROUPS: AltGroup[] = [
  {
    title: 'Cooking',
    items: [
      { assetId: 'pm25-stove-frying', label: 'Frying', hint: 'Gas stove, heaviest cooking smoke' },
      { assetId: 'pm25-tawa', label: 'Tawa / roti', hint: 'Dry heat on a hot pan' },
      { assetId: 'pm25-stove-boiling', label: 'Boiling', hint: 'Gas stove, light emissions' },
    ],
  },
  {
    title: 'Burning',
    items: [
      { assetId: 'pm25-incense', label: 'Incense', hint: 'Agarbatti' },
      { assetId: 'pm25-mosquito-coil', label: 'Mosquito coil', hint: 'Burns for hours' },
      { assetId: 'pm25-candle', label: 'Candle / diya', hint: 'Small flame' },
      { assetId: 'pm25-cigarette', label: 'Cigarette', hint: 'Smoking indoors' },
      { assetId: 'pm25-heater', label: 'Kerosene / coal heater', hint: 'Very high emissions' },
    ],
  },
  {
    title: 'Cleaning',
    items: [{ assetId: 'pm25-sweeping', label: 'Sweeping / dusting', hint: 'Stirs dust back into the air' }],
  },
  {
    title: 'Bathroom',
    items: [{ assetId: 'pm25-toilet-flush', label: 'Toilet flushing', hint: 'Tiny PM2.5; mainly a germ spray' }],
  },
];

export const FURNITURE_ITEMS: AltItem[] = [
  { assetId: 'double-bed', label: 'Bed', hint: 'Resize after placing' },
  { assetId: 'sofa-3-seater', label: 'Sofa', hint: 'Blocks low air movement' },
  { assetId: 'wardrobe', label: 'Wardrobe', hint: 'Tall: blocks airflow' },
  { assetId: 'dining-table', label: 'Dining table', hint: '' },
  { assetId: 'dining-chair', label: 'Chair', hint: 'Air passes through' },
  { assetId: 'desk', label: 'Table / desk', hint: '' },
  { assetId: 'kitchen-counter', label: 'Kitchen counter', hint: '' },
  { assetId: 'fridge', label: 'Fridge', hint: 'Tall: blocks airflow' },
  { assetId: 'bookshelf', label: 'Bookshelf', hint: 'Tall, partly open' },
];

const PICKED = new Set(
  [...VENTILATION_GROUPS, ...POLLUTION_GROUPS].flatMap((g) => g.items.map((i) => i.assetId)).concat(FURNITURE_ITEMS.map((i) => i.assetId))
);
/** Legacy aliases kept in the catalogue for old designs */
const ALIASES = new Set(['door', 'sofa']);
const NOT_FURNITURE = new Set(['Openings', 'Walls', 'Pollution sources']);

/** Every other catalogue entry that stands on the floor, for the collapsed "More furniture" list. */
export const MORE_FURNITURE_ITEMS: AltItem[] = CATALOG_ASSETS.filter(
  (a) => !PICKED.has(a.id) && !ALIASES.has(a.id) && !NOT_FURNITURE.has(a.category)
).map((a) => ({ assetId: a.id, label: a.label, hint: a.category }));

export function altAsset(item: AltItem): AssetDef | undefined {
  return getCatalogAsset(item.assetId);
}

/** Friendly name of a placed object or opening subtype, falling back to the catalogue label. */
const ALT_LABELS: Record<string, string> = Object.fromEntries(
  [...VENTILATION_GROUPS, ...POLLUTION_GROUPS].flatMap((g) => g.items).concat(FURNITURE_ITEMS).map((i) => [i.assetId, i.label])
);

export function altLabel(assetId: string | undefined, fallback: string): string {
  return (assetId && ALT_LABELS[assetId]) || fallback;
}
