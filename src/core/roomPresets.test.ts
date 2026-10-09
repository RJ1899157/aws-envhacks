import { describe, expect, it } from 'vitest';
import { getCatalogAsset } from './catalog';
import { createRoomOfType, ROOM_TYPE_ORDER, ROOM_TYPES, rectOutline } from './rooms';
import { buildPresetObjects, presetSummary, ROOM_PRESETS } from './roomPresets';
import { validateObject } from './placementValidator';

describe('room presets', () => {
  it('only uses assets that exist in the catalog, and the basic room is empty', () => {
    for (const items of Object.values(ROOM_PRESETS)) {
      for (const item of items) expect(getCatalogAsset(item.assetId), item.assetId).toBeDefined();
    }
    expect(ROOM_PRESETS.basic).toHaveLength(0);
    expect(presetSummary('basic')).toBe('Empty');
    expect(presetSummary('bedroom')).toMatch(/double bed/i);
  });

  for (const type of ROOM_TYPE_ORDER) {
    for (const rotated of [false, true]) {
      it(`${type}${rotated ? ' (rotated)' : ''}: every piece is inside the room and nothing solid overlaps`, () => {
        const [w, d] = ROOM_TYPES[type].size;
        const outline = rectOutline(3, -1, rotated ? d : w, rotated ? w : d);
        const room = { ...createRoomOfType(type, []), outline };
        room.objects = buildPresetObjects(type, outline, rotated);
        expect(room.objects).toHaveLength(ROOM_PRESETS[type].length);
        for (const obj of room.objects) {
          expect(validateObject(obj, room), `${obj.assetId} at ${obj.position}`).toEqual([]);
        }
      });
    }
  }
});
