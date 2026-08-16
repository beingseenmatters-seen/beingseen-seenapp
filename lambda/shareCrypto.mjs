/**
 * Recoverable share credential crypto (Phase 4.5-A).
 *
 * Purpose: let the AUTHENTICATED SENDER re-obtain their own gift's share
 * token (再次分享 / QR regeneration) without ever storing the raw token in
 * Firestore. The recipient lookup identity stays tokenHash; this module only
 * adds a sealed, sender-recoverable copy.
 *
 * Design (approved direction — no ad-hoc reversible crypto):
 *   · AWS KMS symmetric key (SYMMETRIC_DEFAULT = AES-256-GCM), direct
 *     Encrypt/Decrypt — the token is ~22 bytes, far under KMS's 4KB direct
 *     limit, so no envelope layer is needed.
 *   · EncryptionContext { purpose: "gift_share", tokenHash } binds each
 *     ciphertext to its own record: a ciphertext copied onto another gift
 *     document will NOT decrypt (context mismatch), so Firestore tampering
 *     cannot redirect share recovery.
 *   · Key custody: the CMK lives in KMS; the Lambda execution role gets
 *     kms:Encrypt + kms:Decrypt on that ONE key. Nobody handles raw key
 *     material. Firestore alone (backup, export, leak) reveals nothing.
 *   · Rotation: enable automatic annual rotation on the CMK — KMS retains
 *     prior key versions, so existing ciphertexts keep decrypting with zero
 *     migration. Decrypt omits KeyId (the ciphertext names its key version).
 *   · Failure behavior is EXPLICIT, never silent: seal failure aborts the
 *     event-based create (503), recover failure returns its own error —
 *     no fabricated links, no plaintext fallback.
 *
 * Feature flag: GIFT_SHARE_KMS_KEY_ID env var. Absent → returns null and
 *   event-based creation refuses with share_unavailable (an Event invitation
 *   without a recoverable share would be a managed record the sender cannot
 *   re-share — worse than failing honestly).
 */

/** Build the KMS-backed crypto, or null when the feature is unconfigured. */
export function makeKmsShareCrypto({ keyId } = {}) {
  const resolvedKeyId = keyId ?? process.env.GIFT_SHARE_KMS_KEY_ID ?? "";
  if (!resolvedKeyId) return null;

  // Lazy import so cold starts without share activity pay nothing (same
  // pattern as the S3 media store).
  let clientPromise = null;
  const getClient = () =>
    (clientPromise ??= import("@aws-sdk/client-kms").then((m) => ({
      m,
      client: new m.KMSClient({}),
    })));

  const encryptionContext = (tokenHash) => ({ purpose: "gift_share", tokenHash });

  return {
    /** token + tokenHash → base64 ciphertext for the gift record. Throws on failure. */
    async seal(token, tokenHash) {
      const { m, client } = await getClient();
      const out = await client.send(
        new m.EncryptCommand({
          KeyId: resolvedKeyId,
          Plaintext: Buffer.from(String(token), "utf8"),
          EncryptionContext: encryptionContext(tokenHash),
        }),
      );
      return Buffer.from(out.CiphertextBlob).toString("base64");
    },
    /** Sealed credential + its record's tokenHash → raw token. Throws on failure/mismatch. */
    async open(sealed, tokenHash) {
      const { m, client } = await getClient();
      const out = await client.send(
        new m.DecryptCommand({
          CiphertextBlob: Buffer.from(String(sealed), "base64"),
          EncryptionContext: encryptionContext(tokenHash),
        }),
      );
      return Buffer.from(out.Plaintext).toString("utf8");
    },
  };
}
