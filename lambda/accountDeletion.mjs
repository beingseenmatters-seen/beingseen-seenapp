/**
 * PRODUCT-SPECIFIC account deletion — Gift.Seen and Moment.Seen.
 *
 * Core ecosystem rule (frozen): ONE Firebase identity (seen-matters) is shared
 * by Seen, Gift.Seen and Moment.Seen. Products own their DATA; none of them
 * owns the LOGIN. Deleting a product account therefore removes only that
 * product's records and NEVER the shared authentication identity.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ SAFEGUARD — BY CONSTRUCTION, NOT BY DISCIPLINE:                         │
 * │ these handlers do not accept an `auth` (Firebase Admin) dependency at   │
 * │ all. There is no code path here that COULD call deleteUser()/disable    │
 * │ the UID. Seen App code and the shared identity are untouchable from     │
 * │ this module. Do not add an auth parameter in future edits.              │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * Deletion classification (per-collection, audited 2026-09-02):
 *   giftMessages (senderUid)      A  delete + purge sealed S3 media
 *   sharedRsvp (giftId)           A  delete with the gift (guest responses to
 *                                    the sender's gift — unreachable after it)
 *   events (senderUid)            A  delete
 *   eventGuests (eventId)         A  delete with the event (owner-entered)
 *   eventGuestbook (eventId)      A  delete with the event
 *   eventDrawEntrants (eventId)   A  delete with the event
 *   eventDraw (doc id = eventId)  A  delete with the event
 *   liveSessions (ownerUid)       A  delete
 *   tags self-print (ownerUid)    A  delete + contacts/photos (QR was
 *                                    owner-printed; meaningless without them)
 *   tags pre-manufactured         C  DETACH: reset to the unactivated factory
 *                                    shell (physical object stays activatable
 *                                    by a future owner) + delete contacts
 *   tagContacts / tagContactPhotos A delete with their tag (private inbox)
 *   tagEvents (recipientUid)      A  delete (notification spine entries)
 *   tagBatches (createdBy)        C/D anonymize createdBy — manufacturing
 *                                    traceability retained, identity removed
 *   tagCodes                      D  retained: code-uniqueness ledger, carries
 *                                    only hashes — no personal data
 *   authHandoff*                  D  ephemeral TTL'd SSO codes — not identity,
 *                                    self-expiring
 *   mind* collections             —  Mind.Seen is a SEPARATE product; out of
 *                                    scope, untouched
 *
 * Recipient-facing links of deleted gifts/events resolve to the existing
 * honest "no longer available" card — the same behaviour revocation already
 * ships, i.e. the established product policy, not a new failure mode.
 *
 * Moment.Seen (audited): server-side stores NOTHING per-user today — its one
 * backend path (/moment/caption) is stateless and Moment is local-first. The
 * handler below is still the real, authenticated, product-scoped deletion
 * door: it deletes whatever Moment-owned server data exists (today: none) and
 * gives the product a single place to grow that scope. Local media the user
 * exported to their device is theirs and is never touched.
 */
import { GIFT_COLLECTION } from "./gift.mjs";
import { sealedAssetIds, deleteSealedMedia } from "./giftMedia.mjs";
import { EVENT_COLLECTION, GUEST_COLLECTION } from "./event.mjs";
import { SHARED_RSVP_COLLECTION } from "./sharedRsvp.mjs";
import {
  GUESTBOOK_COLLECTION, ENTRANT_COLLECTION, DRAW_COLLECTION, LIVE_SESSION_COLLECTION,
} from "./onsite.mjs";
import {
  TAG_COLLECTION, TAG_CONTACT_COLLECTION, TAG_CONTACT_PHOTO_COLLECTION,
  TAG_EVENT_COLLECTION, TAG_BATCH_COLLECTION,
} from "./tag.mjs";

const ANON = "deleted-account";

async function docsWhere(db, collection, field, value) {
  const snap = await db.collection(collection).where(field, "==", value).get();
  return (snap.docs ?? []).map((d) => ({ id: d.id, data: d.data() }));
}

/**
 * POST /gift/account/delete (route: /sender/account/delete)
 * Deletes ONLY Gift.Seen product data owned by the authenticated UID.
 * Idempotent: a repeat call finds nothing and still succeeds.
 */
export async function deleteGiftAccount({ db, decoded, media = null, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const uid = decoded.uid;
  const deleted = {
    gifts: 0, sharedRsvps: 0, events: 0, eventGuests: 0, guestbook: 0,
    drawEntrants: 0, draws: 0, liveSessions: 0,
    tagsDeleted: 0, tagsDetached: 0, tagContacts: 0, tagEvents: 0, batchesAnonymized: 0,
  };

  // 1. Gifts — the sender's sealed expressions + their guests' shared-link
  //    responses + every private media asset behind them.
  for (const { id: tokenHash, data: rec } of await docsWhere(db, GIFT_COLLECTION, "senderUid", uid)) {
    for (const assetId of sealedAssetIds(rec)) {
      try {
        await deleteSealedMedia({ store: media, tokenHash, assetId, reason: "account-deletion" });
      } catch { /* best-effort, same contract as revoke; record still dies below */ }
    }
    for (const { id } of await docsWhere(db, SHARED_RSVP_COLLECTION, "giftId", tokenHash)) {
      await db.collection(SHARED_RSVP_COLLECTION).doc(id).delete();
      deleted.sharedRsvps += 1;
    }
    await db.collection(GIFT_COLLECTION).doc(tokenHash).delete();
    deleted.gifts += 1;
  }

  // 2. Events and everything scoped under them.
  for (const { id: eventId } of await docsWhere(db, EVENT_COLLECTION, "senderUid", uid)) {
    for (const col of [GUEST_COLLECTION, GUESTBOOK_COLLECTION, ENTRANT_COLLECTION]) {
      for (const { id } of await docsWhere(db, col, "eventId", eventId)) {
        await db.collection(col).doc(id).delete();
        if (col === GUEST_COLLECTION) deleted.eventGuests += 1;
        else if (col === GUESTBOOK_COLLECTION) deleted.guestbook += 1;
        else deleted.drawEntrants += 1;
      }
    }
    // Shared-link RSVPs also carry an eventId — sweep any not already removed
    // through their gift above.
    for (const { id } of await docsWhere(db, SHARED_RSVP_COLLECTION, "eventId", eventId)) {
      await db.collection(SHARED_RSVP_COLLECTION).doc(id).delete();
      deleted.sharedRsvps += 1;
    }
    const drawRef = db.collection(DRAW_COLLECTION).doc(eventId);
    if ((await drawRef.get()).exists) { await drawRef.delete(); deleted.draws += 1; }
    await db.collection(EVENT_COLLECTION).doc(eventId).delete();
    deleted.events += 1;
  }

  // 3. Live sessions (sessionId === eventId for event ones; ownerUid query
  //    also catches any future standalone sessions).
  for (const { id } of await docsWhere(db, LIVE_SESSION_COLLECTION, "ownerUid", uid)) {
    await db.collection(LIVE_SESSION_COLLECTION).doc(id).delete();
    deleted.liveSessions += 1;
  }

  // 4. Tags. Self-print tags die with the account; pre-manufactured tags are
  //    DETACHED back to their unactivated factory shell so the physical object
  //    a future owner holds keeps working — ownership, profile, message and
  //    inbox all removed either way.
  for (const { id: tagId, data: tag } of await docsWhere(db, TAG_COLLECTION, "ownerUid", uid)) {
    for (const { id: contactId } of await docsWhere(db, TAG_CONTACT_COLLECTION, "tagId", tagId)) {
      const photoRef = db.collection(TAG_CONTACT_PHOTO_COLLECTION).doc(contactId);
      if ((await photoRef.get()).exists) await photoRef.delete();
      await db.collection(TAG_CONTACT_COLLECTION).doc(contactId).delete();
      deleted.tagContacts += 1;
    }
    if (tag.provision) {
      await db.collection(TAG_COLLECTION).doc(tagId).update({
        ownerUid: null,
        status: "unactivated",
        displayLabel: null,
        ownerMessage: "",
        profile: {},
        ownerProfile: {},
        activatedAt: null,
        missingSince: null,
        provision: { ...tag.provision, by: ANON },
        updatedAt: now,
      });
      deleted.tagsDetached += 1;
    } else {
      await db.collection(TAG_COLLECTION).doc(tagId).delete();
      deleted.tagsDeleted += 1;
    }
  }

  // 5. Notification-spine entries addressed to this owner.
  for (const { id } of await docsWhere(db, TAG_EVENT_COLLECTION, "recipientUid", uid)) {
    await db.collection(TAG_EVENT_COLLECTION).doc(id).delete();
    deleted.tagEvents += 1;
  }

  // 6. Manufacturing batches: traceability stays, identity goes.
  for (const { id } of await docsWhere(db, TAG_BATCH_COLLECTION, "createdBy", uid)) {
    await db.collection(TAG_BATCH_COLLECTION).doc(id).update({ createdBy: ANON });
    deleted.batchesAnonymized += 1;
  }

  // The shared Firebase identity is deliberately NOT touched — Seen and
  // Moment.Seen keep working with this UID, and the user may re-enter
  // Gift.Seen later as a fresh product user.
  return { status: 200, body: { ok: true, product: "gift", deleted } };
}

/**
 * POST /moment/account/delete
 * Moment.Seen is local-first: the audit found no per-user server-side data
 * (its only backend call is the stateless caption endpoint). This door still
 * performs a real, authenticated, product-scoped deletion — today that scope
 * is empty on the server, and any future Moment-owned collection must be
 * added HERE and nowhere else. Never touches the shared identity, other
 * products, or media already saved to the user's device.
 */
export async function deleteMomentAccount({ db, decoded, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  void db; void now; // reserved for future Moment-owned collections
  const deleted = {}; // audited 2026-09-02: no Moment.Seen server-side records exist
  return { status: 200, body: { ok: true, product: "moment", deleted } };
}
