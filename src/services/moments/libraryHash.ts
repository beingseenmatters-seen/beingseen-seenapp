/**
 * Deterministic hashing for Moment Platform pack / moment integrity.
 * Uses Web Crypto when available; Node crypto for exporter/tests.
 */

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Stable JSON: sort object keys recursively. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortValue(obj[key]);
    }
    return out;
  }
  return value;
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throw new Error('Web Crypto subtle.digest is required for Moment Library hashing');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(digest);
}

export async function hashMomentDocument(moment: unknown): Promise<string> {
  return sha256Hex(canonicalJson(moment));
}

/** Pack hash excludes packHash itself. */
export async function hashLibraryPackBody(pack: object): Promise<string> {
  const { packHash: _ignored, ...rest } = pack as Record<string, unknown> & {
    packHash?: string;
  };
  return sha256Hex(canonicalJson(rest));
}
