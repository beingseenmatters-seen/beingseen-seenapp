/**
 * Client-side Heart Key (心意钥匙) helpers. Selection/regeneration/customisation
 * all happen here, before the single /gift/create call — so 换一个 is unlimited
 * and free, and the key becomes immutable once the Gift is sealed (created).
 * The server re-validates and hashes whatever key is finally submitted.
 */

/** Reject obvious/weak values — mirrors the server's isWeakKey. */
export function isWeakHeartKey(key: string): boolean {
  if (!/^\d{6}$/.test(key)) return true;
  if (/^(\d)\1{5}$/.test(key)) return true; // all same digit
  if ('0123456789'.includes(key)) return true; // ascending run (123456, 012345…)
  if ('9876543210'.includes(key)) return true; // descending run (654321, 987654…)
  return false;
}

/** A random six-digit Heart Key that is never a weak value. */
export function generateHeartKey(): string {
  const buf = new Uint32Array(1);
  let key: string;
  do {
    crypto.getRandomValues(buf);
    key = String(buf[0] % 1_000_000).padStart(6, '0');
  } while (isWeakHeartKey(key));
  return key;
}

/** Display form: "432 540". */
export function formatHeartKey(key: string): string {
  const d = key.replace(/\D/g, '');
  return d.length === 6 ? `${d.slice(0, 3)} ${d.slice(3)}` : d;
}
