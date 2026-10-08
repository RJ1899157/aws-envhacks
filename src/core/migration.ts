import { RoomParamsSchema } from './schema';

export const CURRENT_ROOM_SCHEMA_VERSION = 1;

export interface MigrationResult {
  room: unknown;
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  warnings: string[];
}

/**
 * Migration pipeline for Room data schemas across versions.
 * Safely upgrades legacy or unversioned room payloads to CURRENT_ROOM_SCHEMA_VERSION (1).
 */
export function migrateRoom(raw: unknown): MigrationResult {
  if (typeof raw !== 'object' || raw === null) {
    return {
      room: raw,
      migrated: false,
      fromVersion: 0,
      toVersion: CURRENT_ROOM_SCHEMA_VERSION,
      warnings: ['Invalid room payload: expected an object'],
    };
  }

  const payload = { ...(raw as Record<string, unknown>) };
  const rawVersion = typeof payload.version === 'number' ? payload.version : 0;
  const warnings: string[] = [];
  let migrated = false;

  let currentVersion = rawVersion;

  // Migration from unversioned (v0) to v1
  if (currentVersion === 0) {
    warnings.push('Room payload was unversioned (v0); automatically upgraded to schema v1.');
    payload.version = 1;

    // Default wallThickness if missing or out of spec
    if (typeof payload.wallThickness !== 'number') {
      payload.wallThickness = 0.15;
    }

    // Default wallHeight if missing
    if (typeof payload.wallHeight !== 'number') {
      payload.wallHeight = 2.7;
    }

    // Ensure openings array and opening defaults
    if (!Array.isArray(payload.openings)) {
      payload.openings = [];
    } else {
      payload.openings = payload.openings.map((op: unknown) => {
        if (typeof op === 'object' && op !== null) {
          const openingObj = { ...(op as Record<string, unknown>) };
          if (!openingObj.role) {
            openingObj.role = openingObj.type === 'door' ? 'closed' : 'inlet';
          }
          if (typeof openingObj.openFraction !== 'number') {
            openingObj.openFraction = openingObj.role === 'closed' ? 0 : 0.5;
          }
          return openingObj;
        }
        return op;
      });
    }

    // Ensure objects array
    if (!Array.isArray(payload.objects)) {
      payload.objects = [];
    }

    // Ensure params defaults
    if (!payload.params || typeof payload.params !== 'object') {
      payload.params = RoomParamsSchema.parse({});
    }

    migrated = true;
    currentVersion = 1;
  }

  // Future migration stub: v1 -> v2
  // When CURRENT_ROOM_SCHEMA_VERSION becomes 2, add migration logic here:
  // if (currentVersion === 1 && CURRENT_ROOM_SCHEMA_VERSION >= 2) { ... }

  return {
    room: payload,
    migrated,
    fromVersion: rawVersion,
    toVersion: currentVersion,
    warnings,
  };
}
