import { describe, expect, it } from 'vitest';
import { createStarterHouse } from '../ui/alt/starterHouse';
import { buildFileName, buildToFile, designFingerprint, parseBuildFile } from './buildsStore';

describe('build files', () => {
  it('round-trips a whole house through a downloaded file', async () => {
    const rooms = createStarterHouse({ living: 1, kitchen: 1, bedroom: 2, bathroom: 1 });
    const text = await buildToFile('Our flat', rooms).text();
    const back = parseBuildFile(text);
    expect(back.name).toBe('Our flat');
    expect(back.rooms).toHaveLength(5);
    expect(designFingerprint(back.rooms)).toBe(designFingerprint(rooms));
  });

  it("opens the old editor's exports (a room with otherRooms)", () => {
    const [a, b] = createStarterHouse({ living: 1, kitchen: 1 });
    const legacy = JSON.stringify({ ...a, otherRooms: [b] });
    const back = parseBuildFile(legacy);
    expect(back.rooms.map((r) => r.name)).toEqual([a!.name, b!.name]);
  });

  it('rejects files that are not designs with a readable message', () => {
    expect(() => parseBuildFile('not json')).toThrow(/valid JSON/);
    expect(() => parseBuildFile(JSON.stringify({ hello: 'world' }))).toThrow();
  });

  it('makes safe file names', () => {
    expect(buildFileName('Our 2BHK flat / v2')).toBe('our-2bhk-flat-v2.airforce.json');
    expect(buildFileName('  ')).toBe('airforce-build.airforce.json');
  });
});
