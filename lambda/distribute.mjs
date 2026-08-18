/**
 * Batch independent Invitation creation (Phase 4.5-B3, Founder V1).
 *
 * Chunked (≤20 guests per call), deliberately NOT cross-row atomic: every
 * row runs the EXISTING production createGift primitive with its full
 * per-invitation atomicity (event attach, KMS share seal, sealed→sealed
 * presentation copies, compensation). Successful rows stay successful;
 * failed rows are individually retryable. The guest row's invitationGiftId
 * is the idempotency anchor — retries never duplicate. Self-heal: if a
 * previous run created an invitation but died before writing the link back,
 * the row is re-linked to the same-label unclaimed invitation instead of
 * creating a twin.
 *
 * Presentation bootstrap: the FIRST created row may consume freshly staged
 * assets (stagedPresentation); every later row reuses the source invitation
 * via fromGiftId (server-side copy). The response's sourceGiftId feeds the
 * next chunk.
 *
 * Message per row = the Event's persisted relationship variant (V4/V6).
 * Rows whose relationship has no saved variant fail with missing_variant —
 * distribution never invents prose.
 */
import { createGift } from "./gift.mjs";
import { EVENT_COLLECTION, GUEST_COLLECTION, GUEST_BATCH_MAX } from "./event.mjs";

export async function distributeInvitations({
  db,
  decoded,
  body,
  media = null,
  share = null,
  giftCollection,
  now = Date.now(),
}) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const guestIds = Array.isArray(body?.guestIds) ? body.guestIds : null;
  if (!eventId || !guestIds || guestIds.length === 0) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  if (guestIds.length > GUEST_BATCH_MAX) {
    return { status: 400, body: { error: "batch_too_large", max: GUEST_BATCH_MAX } };
  }

  const evSnap = await db.collection(EVENT_COLLECTION).doc(eventId).get();
  if (!evSnap.exists) return { status: 404, body: { error: "event_not_found" } };
  const ev = evSnap.data();
  if (ev.senderUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };
  if (ev.type !== "wedding" || ev.status !== "active") {
    return { status: 400, body: { error: "invalid_event", field: "status" } };
  }
  const variants = ev.variants || {};

  // Reuse source resolution. A provided sourceGiftId is validated by the
  // createGift reuse resolver per row; roles present on it decide what each
  // row inherits. stagedPresentation (first chunk only) seeds row one.
  let sourceGiftId = typeof body?.sourceGiftId === "string" && body.sourceGiftId.trim()
    ? body.sourceGiftId.trim()
    : null;
  let staged = body?.stagedPresentation && typeof body.stagedPresentation === "object"
    ? body.stagedPresentation
    : null;
  const musicThemeId =
    typeof staged?.musicThemeId === "string" && staged.musicThemeId
      ? staged.musicThemeId
      : typeof body?.musicThemeId === "string" && body.musicThemeId
        ? body.musicThemeId
        : null;

  let sourceRoles = null; // { photo: bool, voice: bool, musicThemeId } of the reuse source
  const loadSourceRoles = async () => {
    if (!sourceGiftId) return null;
    const s = await db.collection(giftCollection).doc(sourceGiftId).get();
    if (!s.exists) return null;
    const rec = s.data();
    if (rec.senderUid !== decoded.uid || rec.eventId !== eventId || rec.revoked) return null;
    return {
      photos: (rec.presentation?.photos?.length ?? 0) > 0,
      photo: Boolean(rec.presentation?.photo?.assetId),
      voice: Boolean(rec.presentation?.voice?.assetId),
      musicThemeId: rec.presentation?.musicThemeId ?? null,
    };
  };
  sourceRoles = await loadSourceRoles();
  if (sourceGiftId && !sourceRoles) {
    return { status: 400, body: { error: "invalid_request", field: "sourceGiftId" } };
  }

  // Self-heal index: this event's existing invitations by label, minus the
  // ones already claimed by some guest row.
  const [invSnap, guestSnap] = await Promise.all([
    db.collection(giftCollection).where("eventId", "==", eventId).get(),
    db.collection(GUEST_COLLECTION).where("eventId", "==", eventId).get(),
  ]);
  const claimed = new Set(
    (guestSnap.docs ?? []).map((d) => d.data().invitationGiftId).filter(Boolean),
  );
  const unclaimedByLabel = new Map();
  for (const d of invSnap.docs ?? []) {
    const rec = d.data();
    if (rec.senderUid !== decoded.uid || rec.revoked || claimed.has(d.id)) continue;
    if (rec.recipientLabel && !unclaimedByLabel.has(rec.recipientLabel)) {
      unclaimedByLabel.set(rec.recipientLabel, d.id);
    }
  }

  const results = [];
  for (const rawId of guestIds) {
    const guestId = typeof rawId === "string" ? rawId.trim() : "";
    const fail = (error, extra = {}) => results.push({ guestId, status: "failed", error, ...extra });
    if (!guestId) { fail("invalid_request"); continue; }

    const gSnap = await db.collection(GUEST_COLLECTION).doc(guestId).get();
    if (!gSnap.exists) { fail("guest_not_found"); continue; }
    const guest = gSnap.data();
    if (guest.senderUid !== decoded.uid || guest.eventId !== eventId) { fail("forbidden"); continue; }

    // Idempotency anchor — a linked row is DONE, retries skip it.
    if (guest.invitationGiftId) {
      results.push({ guestId, status: "already", giftId: guest.invitationGiftId });
      continue;
    }
    // Self-heal: adopt a same-label invitation from an interrupted earlier run.
    const orphan = unclaimedByLabel.get(guest.label);
    if (orphan) {
      unclaimedByLabel.delete(guest.label);
      await db.collection(GUEST_COLLECTION).doc(guestId).update({ invitationGiftId: orphan });
      results.push({ guestId, status: "relinked", giftId: orphan });
      if (!sourceGiftId) { sourceGiftId = orphan; sourceRoles = await loadSourceRoles(); }
      continue;
    }

    const variant = variants[guest.relationshipType];
    if (!variant?.message) { fail("missing_variant", { relationshipType: guest.relationshipType }); continue; }

    // Presentation for this row: reuse the source when one exists, else seed
    // from the staged assets (first row of the first chunk).
    const pres = {};
    if (sourceRoles) {
      // Photo Story V1: multi-photo sources carry the WHOLE ordered story
      // to every household; single/legacy sources keep the photo role.
      if (sourceRoles.photos) pres.photos = { fromGiftId: sourceGiftId };
      else if (sourceRoles.photo) pres.photo = { fromGiftId: sourceGiftId };
      if (sourceRoles.voice) pres.voice = { fromGiftId: sourceGiftId };
      if (sourceRoles.musicThemeId) pres.musicThemeId = sourceRoles.musicThemeId;
    } else if (staged) {
      if (Array.isArray(staged.photos) && staged.photos.length > 0) {
        pres.photos = staged.photos
          .filter((p) => p && typeof p.assetId === "string")
          .map((p) => ({ assetId: p.assetId }));
      } else if (staged.photo?.assetId) pres.photo = { assetId: staged.photo.assetId };
      if (staged.voice?.assetId) pres.voice = { assetId: staged.voice.assetId };
      if (musicThemeId) pres.musicThemeId = musicThemeId;
    } else if (musicThemeId) {
      pres.musicThemeId = musicThemeId;
    }

    const res = await createGift({
      db,
      decoded,
      media,
      share,
      now,
      body: {
        message: variant.message,
        senderName: ev.occasion?.inviter ?? null,
        accessMode: body?.accessMode === "heart_key" ? "heart_key" : "direct",
        occasion: { ...ev.occasion, audienceType: guest.relationshipType },
        eventId,
        recipientLabel: guest.label,
        ...(Object.keys(pres).length > 0 ? { presentation: pres } : {}),
      },
    });
    if (res.status !== 200) {
      fail(res.body?.error || "create_failed", { detail: res.body?.field });
      continue;
    }
    // Link back — the row becomes permanently DONE. A crash between create
    // and this write is healed by the same-label adoption above on retry.
    await db.collection(GUEST_COLLECTION).doc(guestId).update({ invitationGiftId: res.body.giftId });
    staged = null; // staged assets are consumed by exactly one row
    if (!sourceGiftId) {
      sourceGiftId = res.body.giftId;
      sourceRoles = await loadSourceRoles();
    }
    results.push({
      guestId,
      status: "created",
      giftId: res.body.giftId,
      token: res.body.token,
      url: res.body.url,
      retrievalKey: res.body.retrievalKey,
      accessMode: res.body.accessMode,
    });
  }

  return { status: 200, body: { eventId, sourceGiftId, results } };
}
