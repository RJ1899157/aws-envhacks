import { beforeEach, describe, expect, it } from 'vitest';
import { createBedroomSample } from '../core/samples';
import type { Room } from '../core/schema';
import { useSceneStore } from './sceneStore';
import { houseScenarios, useScenarioStore } from './scenarioStore';

const design = () => {
  const { room, otherRooms } = useSceneStore.getState();
  return JSON.stringify([room, ...otherRooms]);
};

describe('scenario store', () => {
  beforeEach(() => {
    const room = createBedroomSample();
    room.openings = [{ id: 'w1', wallIndex: 0, type: 'window', offset: 0.5, width: 1, height: 1.2, sill: 0.9, role: 'closed', openFraction: 0 }];
    useSceneStore.getState().loadRoom(room, []);
    useSceneStore.temporal.getState().clear();
    useScenarioStore.setState({ whatIf: null, compare: null, preview: null });
  });

  it('"Apply to my design" is one undo step', () => {
    const before = design();
    const room = useSceneStore.getState().room;
    useScenarioStore.getState().applyToDesign({ actions: [{ type: 'setOpening', roomId: room.id!, openingId: 'w1', openFraction: 1 }] });
    expect(useSceneStore.getState().room.openings[0]!.openFraction).toBe(1);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(1);
    useSceneStore.temporal.getState().undo();
    expect(design()).toBe(before);
  });

  it('what-if records edits as actions and leaves the design and its history unchanged', () => {
    const before = design();
    useScenarioStore.getState().enterWhatIf();
    const st = useSceneStore.getState();
    st.updateOpening('w1', { openFraction: 0.5, role: 'inlet' });
    const actions = useScenarioStore.getState().whatIfActions();
    expect(actions).toEqual([{ type: 'setOpening', roomId: st.room.id, openingId: 'w1', openFraction: 0.5 }]);
    const saved = useScenarioStore.getState().saveWhatIf('Open the window');
    expect(saved?.actions).toEqual(actions);
    // Design back to the baseline, plus the saved scenario (one undoable step)
    const { scenarios, ...rest } = useSceneStore.getState().room;
    expect(JSON.stringify([rest as Room])).toBe(before);
    expect(scenarios?.[0]?.name).toBe('Open the window');
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(1);
    useSceneStore.temporal.getState().undo();
    expect(design()).toBe(before);
  });

  it('discarding what-if restores the design exactly', () => {
    const before = design();
    useScenarioStore.getState().enterWhatIf();
    useSceneStore.getState().updateOpening('w1', { openFraction: 1, role: 'inlet' });
    useScenarioStore.getState().discardWhatIf();
    expect(design()).toBe(before);
    expect(useSceneStore.temporal.getState().pastStates.length).toBe(0);
  });

  it('renames, duplicates and deletes saved scenarios', () => {
    const s = useScenarioStore.getState();
    s.saveScenario({ id: 'a', name: 'A', actions: [] });
    s.renameScenario('a', 'Night');
    s.duplicateScenario('a');
    const rooms = () => { const st = useSceneStore.getState(); return [st.room, ...st.otherRooms]; };
    expect(houseScenarios(rooms()).map((x) => x.name)).toEqual(['Night', 'Night (copy)']);
    s.deleteScenario('a');
    expect(houseScenarios(rooms()).map((x) => x.name)).toEqual(['Night (copy)']);
  });
});
