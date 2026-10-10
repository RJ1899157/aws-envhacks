import { describe, expect, it } from 'vitest';
import { bearingToScreen, bearingToXZ, compassPoint, EAST_XZ, NORTH_XZ, windFlowXZ, windFromXZ, xzToBearing } from './wind';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe('wind convention', () => {
  it('north is −Z and east is +X', () => {
    close(NORTH_XZ, [0, -1]);
    close(EAST_XZ, [1, 0]);
    close(bearingToXZ(0), [0, -1]);
    close(bearingToXZ(90), [1, 0]);
    close(bearingToXZ(180), [0, 1]);
    close(bearingToXZ(270), [-1, 0]);
  });

  it('windDirDeg is where the wind comes FROM; air moves the other way', () => {
    close(windFromXZ(0), [0, -1]);
    close(windFlowXZ(0), [0, 1]); // a north wind blows toward +Z (south)
    close(windFlowXZ(270), [1, 0]); // a west wind blows toward +X (east)
  });

  it('bearings round-trip', () => {
    for (const deg of [0, 30, 90, 135, 200, 315]) expect(xzToBearing(bearingToXZ(deg))).toBeCloseTo(deg, 9);
  });

  it('the north-up compass dial matches the plan view (−Z up, +X right)', () => {
    // Screen y grows downward, so north (−Z, up on the plan) is −y on the dial
    close(bearingToScreen(0), [0, -1]);
    close(bearingToScreen(90), [1, 0]);
    // The plan maps world (x, z) to screen (x, z): bearing → screen equals bearing → XZ
    for (const deg of [0, 45, 160, 300]) close(bearingToScreen(deg), bearingToXZ(deg));
  });

  it('names compass points', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(300)).toBe('WNW');
    expect(compassPoint(359)).toBe('N');
  });
});
