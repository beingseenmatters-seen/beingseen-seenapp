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
import { INVITATION_EVENT_TYPES, OCCASION_TYPE_BUSINESS, OCCASION_TYPE_CASUAL } from "./occasion.mjs";
import {
  chargeCredits as billingChargeCredits,
  getBalance as billingGetBalance,
  CHARGEABLE_PRODUCTS,
} from "./billing.mjs";

/**
 * Phase 3 charging (LOCKED): ONE genuinely new independent invitation = 100
 * Credits (private_event_invitation for wedding/birthday,
 * business_event_invitation for business) — never multiplied by party size,
 * RSVP counts or attendance. The guest ROW is the invitation unit and its
 * deterministic ledger key `evt_{eventId}_{guestId}` means each row can be
 * charged AT MOST ONCE, EVER — across retries, tabs and racing Lambdas.
 *
 * Charge order per row: CHARGE FIRST (guard re-verifies the row is still
 * un-linked INSIDE the transaction and stamps invoicePaidAt), then create the
 * invitation, then link. Crash windows all heal:
 *   charge✓ create✗ → retry hits the duplicate ledger entry (0) and creates;
 *   create✓ link✗   → retry adopts the same-label orphan (relinked, 0).
 * `already`/`relinked` rows and pre-Phase-3 legacy invitations are NEVER
 * charged (billing is not retroactive).
 *
 * 轻松相聚 rows are NEVER charged per-row: the gathering's flat 20 Credits
 * ride the FIRST publication's `cas_{eventId}` ledger entry (gift.mjs), and
 * this module ensures that entry exists once before free rows flow.
 *
 * Legacy clients (no billingAck): rows stay FREE and are logged —
 * BILLING_REQUIRE_KEY=on closes the window (NO INVISIBLE CHARGING).
 */
const EVENT_PRODUCT_BY_TYPE = {
  wedding: "private_event_invitation",
  birthday: "private_event_invitation",
  [OCCASION_TYPE_BUSINESS]: "business_event_invitation",
};

export async function distributeInvitations({
  db,
  decoded,
  body,
  media = null,
  share = null,
  giftCollection,
  now = Date.now(),
  billing = { chargeCredits: billingChargeCredits, getBalance: billingGetBalance },
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
  if (!INVITATION_EVENT_TYPES.includes(ev.type) || ev.status !== "active") {
    return { status: 400, body: { error: "invalid_event", field: "status" } };
  }
  const variants = ev.variants || {};

  // --- Phase 3 billing mode for this batch ---------------------------------
  const invitationProduct = ev.type === OCCASION_TYPE_CASUAL ? null : EVENT_PRODUCT_BY_TYPE[ev.type] ?? null;
  const billingAck = body?.billingAck === true;
  const billed = billingAck && invitationProduct !== null;
  if (!billingAck) {
    if (process.env.BILLING_REQUIRE_KEY === "on") {
      return { status: 400, body: { error: "billing_client_required" } };
    }
    console.warn(`[billing] legacy ack-less distribute uid=${decoded.uid} event=${eventId} type=${ev.type}`);
  }

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

  // 轻松相聚 flat publication charge: make sure the gathering's single
  // 20-Credit entry exists before free rows flow. Deterministic key — a
  // gathering already paid via its first seal is observed as a duplicate.
  if (billingAck && ev.type === OCCASION_TYPE_CASUAL) {
    const res = await billing.chargeCredits({
      db,
      uid: decoded.uid,
      product: "casual_gathering_publish",
      idempotencyKey: `cas_${eventId}`,
      subjectId: eventId,
      meta: { eventId, via: "distribute" },
      now,
    });
    if (!res.ok) {
      if (res.error === "insufficient_credits") {
        return {
          status: 402,
          body: { error: "insufficient_credits", free: res.free, paid: res.paid, needed: res.needed },
        };
      }
      return { status: 400, body: { error: res.error ?? "billing_failed" } };
    }
  }

  // Pre-flight (billed batches): the SERVER counts the genuinely chargeable
  // rows — un-linked, no adoptable same-label orphan, wording available — and
  // refuses the whole batch on insufficient balance BEFORE creating anything.
  // The client never supplies the amount; this count is display-parity only
  // (the per-row charge below re-verifies everything transactionally).
  if (billed) {
    const orphanLabels = new Set(unclaimedByLabel.keys());
    let chargeableCount = 0;
    for (const rawId of guestIds) {
      const gid = typeof rawId === "string" ? rawId.trim() : "";
      if (!gid) continue;
      const gs = await db.collection(GUEST_COLLECTION).doc(gid).get();
      if (!gs.exists) continue;
      const g = gs.data();
      if (g.senderUid !== decoded.uid || g.eventId !== eventId) continue;
      if (g.invitationGiftId) continue;
      if (orphanLabels.has(g.label)) { orphanLabels.delete(g.label); continue; }
      const v = variants[g.relationshipType] ??
        (ev.type === "birthday" || ev.type === "business_event" || ev.type === "casual" ? variants.general : undefined);
      if (!v?.message) continue;
      chargeableCount += 1;
    }
    if (chargeableCount > 0) {
      const unitPrice = CHARGEABLE_PRODUCTS[invitationProduct].unitPrice;
      const needed = unitPrice * chargeableCount;
      const bal = await billing.getBalance({ db, uid: decoded.uid, now });
      // spendable, not total: provider-reversal debt (negative paid) must not
      // hide the weekly Free Credits this batch could legitimately consume —
      // the same debt gate chargeCredits itself enforces per row.
      if ((bal.spendable ?? bal.total) < needed) {
        return {
          status: 402,
          body: {
            error: "insufficient_credits",
            free: bal.free,
            paid: bal.paid,
            needed,
            unitPrice,
            chargeableCount,
          },
        };
      }
    }
  }

  const results = [];
  let stoppedInsufficient = false;
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

    // Variant resolution (Founder §5): the guest's relationship wording when
    // one is saved, otherwise the Event's "general" wording (Birthday /
    // Business / Casual). A row only fails when NEITHER exists. Wedding keeps
    // its strict per-relationship contract unchanged.
    const variant =
      variants[guest.relationshipType] ??
      (ev.type === "birthday" || ev.type === "business_event" || ev.type === "casual" ? variants.general : undefined);
    if (!variant?.message) { fail("missing_variant", { relationshipType: guest.relationshipType }); continue; }

    // A balance exhausted mid-batch stops FURTHER chargeable rows honestly —
    // earlier successes stand (this workflow's locked per-row contract) and
    // every stopped row is individually retryable after a top-up.
    if (stoppedInsufficient) { fail("skipped_insufficient"); continue; }

    // --- Phase 3: charge THIS row (at most once, ever) ---------------------
    if (billed) {
      const guestRef = db.collection(GUEST_COLLECTION).doc(guestId);
      const charge = await billing.chargeCredits({
        db,
        uid: decoded.uid,
        product: invitationProduct,
        idempotencyKey: `evt_${eventId}_${guestId}`,
        subjectId: guestId,
        // The row's link state is re-verified INSIDE the charge transaction
        // (tagPublishAuth lesson): a concurrent distribute that linked this
        // row first forces a retry that observes the link and refuses with
        // zero writes — one invitation, one charge, under all interleavings.
        guard: async (tx) => {
          const gs = await tx.get(guestRef);
          const g = gs.exists ? gs.data() : null;
          if (!g || g.senderUid !== decoded.uid || g.eventId !== eventId) {
            return { ok: false, error: "forbidden" };
          }
          if (g.invitationGiftId) return { ok: false, error: "already_linked" };
          return { ok: true, writes: [{ kind: "update", ref: guestRef, data: { invoicePaidAt: now } }] };
        },
        meta: { eventId, guestId },
        now,
      });
      if (!charge.ok) {
        if (charge.error === "already_linked") {
          const gs = await guestRef.get();
          results.push({ guestId, status: "already", giftId: gs.data()?.invitationGiftId ?? null });
          continue;
        }
        if (charge.error === "insufficient_credits") {
          stoppedInsufficient = true;
          fail("insufficient_credits", { needed: charge.needed, free: charge.free, paid: charge.paid });
          continue;
        }
        fail(charge.error ?? "billing_failed");
        continue;
      }
      // charge.duplicate === true → this row was paid by an earlier run that
      // crashed before creating/linking; proceed and heal it now, free.
    }

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
      // This module owns the per-row invitation charge above; the internal
      // gift creation must never classify/charge the same publication again.
      eventBilling: "exempt",
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
