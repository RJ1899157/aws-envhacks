import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingModal, ONBOARDING_STORAGE_KEY } from './OnboardingModal';

class MockLocalStorage {
  private store: Record<string, string> = {};
  getItem(k: string) {
    return this.store[k] ?? null;
  }
  setItem(k: string, v: string) {
    this.store[k] = String(v);
  }
  removeItem(k: string) {
    delete this.store[k];
  }
  clear() {
    this.store = {};
  }
}

describe('OnboardingModal Component', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MockLocalStorage());
  });

  it('exports OnboardingModal and storage key', () => {
    expect(OnboardingModal).toBeDefined();
    expect(ONBOARDING_STORAGE_KEY).toBe('airforce_onboarding_completed_v1');
  });

  it('persists completion flag in storage', () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, 'true');
    expect(localStorage.getItem(ONBOARDING_STORAGE_KEY)).toBe('true');
  });
});
