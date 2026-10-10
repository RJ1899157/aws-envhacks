import type { VoxelSimResult } from '../simulation/voxel/solver';

/**
 * Compact encoding of a voxel result for the precomputed showcase files. Every typed array in the
 * result is moved into one binary blob; float fields are quantized to 16 bits with a scale per
 * field (signed when the field has negative values, so zero stays exactly zero, e.g. closed faces;
 * unsigned from 0 otherwise), NaN kept as a sentinel. Integer arrays are stored as they are. The
 * rest (zones, paths, metrics, …) stays plain JSON. The blob is gzipped by the caller.
 */

export type ArrayKind = 'u16' | 's16' | 'u8' | 'i16';

export interface EncodedArray {
  kind: ArrayKind;
  /** Byte offset in the blob */
  offset: number;
  length: number;
  /** value = q × scale (u16 / s16) */
  scale?: number;
}

export interface EncodedResult {
  /** The result with every typed array replaced by { $a: index } */
  structure: unknown;
  arrays: EncodedArray[];
}

const U16_NAN = 0xffff;
const S16_NAN = -0x8000;

function quantize(src: Float32Array): { kind: ArrayKind; bytes: Uint8Array; scale: number } {
  let maxAbs = 0;
  let negative = false;
  for (let i = 0; i < src.length; i++) {
    const v = src[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < 0) negative = true;
    maxAbs = Math.max(maxAbs, Math.abs(v));
  }
  if (negative) {
    const scale = maxAbs > 0 ? maxAbs / 32767 : 1;
    const q = new Int16Array(src.length);
    for (let i = 0; i < src.length; i++) q[i] = Number.isFinite(src[i]!) ? Math.round(src[i]! / scale) : S16_NAN;
    return { kind: 's16', bytes: new Uint8Array(q.buffer), scale };
  }
  const scale = maxAbs > 0 ? maxAbs / 65534 : 1;
  const q = new Uint16Array(src.length);
  for (let i = 0; i < src.length; i++) q[i] = Number.isFinite(src[i]!) ? Math.round(src[i]! / scale) : U16_NAN;
  return { kind: 'u16', bytes: new Uint8Array(q.buffer), scale };
}

/** Splits a result into JSON structure + one binary blob of quantized arrays. */
export function encodeResult(result: VoxelSimResult): EncodedResult & { blob: Uint8Array } {
  const arrays: EncodedArray[] = [];
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const push = (kind: ArrayKind, bytes: Uint8Array, length: number, scale?: number) => {
    // 2-byte alignment keeps every 16-bit chunk addressable
    if (offset % 2) {
      chunks.push(new Uint8Array(1));
      offset++;
    }
    arrays.push({ kind, offset, length, ...(scale !== undefined && { scale }) });
    chunks.push(bytes);
    offset += bytes.byteLength;
    return { $a: arrays.length - 1 };
  };
  const walk = (v: unknown): unknown => {
    if (v instanceof Float32Array) {
      const q = quantize(v);
      return push(q.kind, q.bytes, v.length, q.scale);
    }
    if (v instanceof Uint8Array) return push('u8', new Uint8Array(v), v.length);
    if (v instanceof Int16Array) return push('i16', new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)), v.length);
    if (ArrayBuffer.isView(v)) throw new Error(`Unsupported typed array ${v.constructor.name}`);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    if (typeof v === 'number' && !Number.isFinite(v)) return { $n: String(v) };
    return v;
  };
  const structure = walk(result);
  const blob = new Uint8Array(offset);
  let o = 0;
  for (const c of chunks) {
    blob.set(c, o);
    o += c.byteLength;
  }
  return { structure, arrays, blob };
}

function decodeArray(a: EncodedArray, blob: Uint8Array): Float32Array | Uint8Array | Int16Array {
  // A copy with its own buffer (Node Buffers share a pool, so their .buffer isn't just this chunk)
  const bytes = new Uint8Array(blob.subarray(a.offset, a.offset + a.length * (a.kind === 'u8' ? 1 : 2)));
  if (a.kind === 'u8') return bytes;
  if (a.kind === 'i16') return new Int16Array(bytes.buffer);
  const out = new Float32Array(a.length);
  const scale = a.scale ?? 1;
  if (a.kind === 'u16') {
    const q = new Uint16Array(bytes.buffer);
    for (let i = 0; i < a.length; i++) out[i] = q[i] === U16_NAN ? NaN : q[i]! * scale;
  } else {
    const q = new Int16Array(bytes.buffer);
    for (let i = 0; i < a.length; i++) out[i] = q[i] === S16_NAN ? NaN : q[i]! * scale;
  }
  return out;
}

/** Rebuilds a result from its structure, array table and (un-gzipped) blob. */
export function decodeResult(encoded: EncodedResult, blob: Uint8Array): VoxelSimResult {
  const decoded = encoded.arrays.map((a) => decodeArray(a, blob));
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.$a === 'number' && Object.keys(o).length === 1) return decoded[o.$a];
      if (typeof o.$n === 'string' && Object.keys(o).length === 1) return Number(o.$n);
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(encoded.structure) as VoxelSimResult;
}
