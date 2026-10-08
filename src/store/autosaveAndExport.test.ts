import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSceneStore } from './sceneStore';
import {
  AUTOSAVE_STORAGE_KEY,
  clearAutosavedSession,
  getAutosavedSession,
  saveSessionToStorage,
} from './useAutosave';
import { createBedroomSample } from '../core/samples';
import { parseRoom } from '../core/parser';
import { migrateRoom, CURRENT_ROOM_SCHEMA_VERSION } from '../core/migration';
import { captureCanvasScreenshot } from '../builder/screenshot';

class MockLocalStorage {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] ?? null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = String(value);
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
  get length(): number {
    return Object.keys(this.store).length;
  }
  key(index: number): string | null {
    return Object.keys(this.store)[index] ?? null;
  }
}

describe('Autosave, Export/Import, Migration, and Screenshot', () => {
  let mockStorage: MockLocalStorage;

  beforeEach(() => {
    mockStorage = new MockLocalStorage();
    vi.stubGlobal('localStorage', mockStorage);

    useSceneStore.getState().resetRoom();
    useSceneStore.temporal.getState().clear();
  });

  describe('Autosave to localStorage and Session Restore', () => {
    it('persists room to localStorage and restores session data', () => {
      const bedroom = createBedroomSample();
      saveSessionToStorage(bedroom);

      const saved = getAutosavedSession();
      expect(saved).not.toBeNull();
      expect(saved?.room.name).toBe(bedroom.name);
      expect(saved?.savedAt).toBeGreaterThan(0);

      // Verify localStorage key is populated
      const raw = localStorage.getItem(AUTOSAVE_STORAGE_KEY);
      expect(raw).toBeDefined();
      expect(raw).toContain(bedroom.name);

      // Clear session
      clearAutosavedSession();
      expect(getAutosavedSession()).toBeNull();
      expect(localStorage.getItem(AUTOSAVE_STORAGE_KEY)).toBeNull();
    });
  });

  describe('Export then Import Round-Trip', () => {
    it('export then import gives an identical room', () => {
      const bedroom = createBedroomSample();
      useSceneStore.getState().loadRoom(bedroom);

      // Export JSON
      const exportedJson = useSceneStore.getState().exportRoom();
      expect(typeof exportedJson).toBe('string');

      // Reset room
      useSceneStore.getState().resetRoom();
      expect(useSceneStore.getState().room.name).toBe('Default Room (4x3m)');

      // Import JSON back
      const importResult = useSceneStore.getState().importRoom(exportedJson);
      expect(importResult.success).toBe(true);
      expect(importResult.issues.filter((i) => i.level === 'error')).toHaveLength(0);

      const importedRoom = useSceneStore.getState().room;
      expect(importedRoom.name).toEqual(bedroom.name);
      expect(importedRoom.wallHeight).toEqual(bedroom.wallHeight);
      expect(importedRoom.wallThickness).toEqual(bedroom.wallThickness);
      expect(importedRoom.outline).toEqual(bedroom.outline);
      expect(importedRoom.openings).toEqual(bedroom.openings);
      expect(importedRoom.objects).toEqual(bedroom.objects);
      expect(importedRoom.params).toEqual(bedroom.params);
    });

    it('blocks import when file contains validation errors', () => {
      const invalidRoomPayload = {
        name: 'Invalid Room',
        wallHeight: 1.0, // Invalid: min is 2.0m
        outline: [
          [0, 0],
          [2, 0],
          [2, 2],
        ],
        openings: [],
        objects: [],
      };

      const parseResult = parseRoom(invalidRoomPayload);
      const errors = parseResult.issues.filter((i) => i.level === 'error');
      expect(errors.length).toBeGreaterThan(0);
      expect(parseResult.room).toBeNull();
    });
  });

  describe('Schema Versioning & Migration', () => {
    it('upgrades unversioned (v0) room payloads to current schema version v1', () => {
      const legacyPayload = {
        name: 'Legacy Room',
        wallHeight: 2.8,
        outline: [
          [-2, -1.5],
          [2, -1.5],
          [2, 1.5],
          [-2, 1.5],
        ],
        openings: [
          {
            id: 'legacy-win',
            wallIndex: 0,
            type: 'window',
            offset: 1.0,
            width: 1.2,
            height: 1.2,
            sill: 0.9,
          },
        ],
        objects: [],
      };

      const migrationResult = migrateRoom(legacyPayload);
      expect(migrationResult.migrated).toBe(true);
      expect(migrationResult.fromVersion).toBe(0);
      expect(migrationResult.toVersion).toBe(CURRENT_ROOM_SCHEMA_VERSION);

      const migratedRoom = migrationResult.room as Record<string, unknown>;
      expect(migratedRoom.version).toBe(1);
      expect(migratedRoom.wallThickness).toBe(0.15); // defaulted
      expect(migratedRoom.params).toBeDefined(); // defaulted

      // Openings receive default role and openFraction
      const openings = migratedRoom.openings as Array<Record<string, unknown>>;
      expect(openings[0]?.role).toBe('inlet');
      expect(openings[0]?.openFraction).toBe(0.5);

      // Verify parseRoom successfully parses the migrated payload
      const parseResult = parseRoom(legacyPayload);
      expect(parseResult.room).not.toBeNull();
      expect(parseResult.room?.version).toBe(1);
    });
  });

  describe('Canvas Screenshot Utility', () => {
    it('handles missing canvas gracefully without crashing', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const mockDoc = {
        querySelector: vi.fn().mockReturnValue(null),
      };
      vi.stubGlobal('document', mockDoc);

      const result = captureCanvasScreenshot('test_room');
      expect(result).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Canvas element not found'));

      warnSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('captures and triggers download when canvas element is present in DOM', () => {
      const mockCanvas = {
        width: 640,
        height: 480,
        toDataURL: vi.fn().mockReturnValue('data:image/png;base64,mockPngData'),
      };
      const mockLink = {
        href: '',
        download: '',
        click: vi.fn(),
      };
      const mockDoc = {
        querySelector: vi.fn((selector: string) => {
          if (selector === 'canvas') return mockCanvas;
          return null;
        }),
        createElement: vi.fn((tag: string) => {
          if (tag === 'a') return mockLink;
          return {};
        }),
        body: {
          appendChild: vi.fn(),
          removeChild: vi.fn(),
        },
      };

      vi.stubGlobal('document', mockDoc);

      const success = captureCanvasScreenshot('Suite Master');
      expect(success).toBe(true);
      expect(mockCanvas.toDataURL).toHaveBeenCalledWith('image/png');
      expect(mockDoc.body.appendChild).toHaveBeenCalledWith(mockLink);
      expect(mockLink.download).toBe('suite_master_screenshot.png');
      expect(mockLink.href).toBe('data:image/png;base64,mockPngData');
      expect(mockLink.click).toHaveBeenCalled();
      expect(mockDoc.body.removeChild).toHaveBeenCalledWith(mockLink);

      vi.unstubAllGlobals();
    });
  });
});
