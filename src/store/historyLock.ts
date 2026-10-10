import { useSceneStore } from './sceneStore';

/**
 * Undo history is paused while the live design is a scratch copy (what-if mode, an example story).
 * Both can be active at once, so pauses are counted: history resumes when the last holder lets go.
 */
let holders = 0;

export function holdHistory(): void {
  if (holders++ === 0) useSceneStore.temporal.getState().pause();
}

export function releaseHistory(): void {
  if (holders === 0) return;
  if (--holders === 0) useSceneStore.temporal.getState().resume();
}
