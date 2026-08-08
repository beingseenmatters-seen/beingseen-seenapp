/**
 * Moments → Matching persistence (Behaviour channel · durable).
 *
 * Turns a user's retained Moment sessions into durable Firestore evidence and a
 * denormalized Moment matching profile the server can read. Firestore is the
 * source of truth; localStorage (momentsService) is only a cache.
 *
 * Flow (idempotent, safe to call any number of times):
 *   1. Push each retained session's Moment Evidence to `users/{uid}/momentEvidence/*`
 *      (deterministic ids → merge upsert, never duplicates).
 *   2. Rebuild the denormalized `momentProfile` + `profile.momentReady` from the
 *      FULL durable evidence (all sessions, all devices) — never from one device's
 *      local cache, so a device switch can never shrink the profile.
 *
 * Independence (founder decision): this NEVER reads or writes soulProfile /
 * emergentTraits / profile.matchReady. Reflect and Moments stay independent
 * evidence channels; they meet only in the matching engine.
 *
 * Triggers: a completed Moments session, and login (backfill + cross-device).
 */

import {
  collection,
  doc,
  getDocs,
  setDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { momentsClient } from '../moments/momentsClient';
import type { UnderstandingEvidence } from '../../types/evidence';
import { createMomentEvidenceFromSession } from './momentEvidence';
import { buildMomentProfileFromEvidence, isMomentReady } from './momentMatchingProfile';
import { logMomentPipelineDiagnostics } from './momentDiagnostics';

const FIRESTORE_WRITE_MS = 12_000;
/** Stay well under Firestore's 500-write batch limit. */
const BATCH_CAP = 400;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Reconcile durable Moment Evidence + the denormalized matching profile from the
 * signed-in user's retained Moment sessions. Fire-and-forget; failures keep the
 * local cache intact and are retried on the next trigger.
 */
export async function syncMomentUnderstanding(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;

  try {
    const evidenceCollection = collection(db, 'users', uid, 'momentEvidence');

    // 1. Push local retained sessions' evidence to the durable SSOT.
    const data = await momentsClient.exportAll();
    const retained = (data.completedSessions ?? []).filter(
      (s) => s.status === 'completed' && s.sketch,
    );

    if (retained.length > 0) {
      const nowIso = new Date(Date.now()).toISOString();
      const items: UnderstandingEvidence[] = [];
      for (const session of retained) {
        items.push(...createMomentEvidenceFromSession(session, { userId: uid, now: nowIso }));
      }
      // Chunk under the batch-write limit (evidence count is small in practice).
      for (let i = 0; i < items.length; i += BATCH_CAP) {
        const batch = writeBatch(db);
        for (const ev of items.slice(i, i + BATCH_CAP)) {
          batch.set(doc(evidenceCollection, ev.id), ev, { merge: true });
        }
        await withTimeout(batch.commit(), FIRESTORE_WRITE_MS, 'moment evidence write');
      }
    }

    // 2. Rebuild the denormalized matching profile from the FULL durable evidence
    //    (never only this device's local sessions → no cross-device shrink).
    const snapshot = await getDocs(evidenceCollection);
    const allEvidence = snapshot.docs.map((d) => d.data() as UnderstandingEvidence);
    const profile = buildMomentProfileFromEvidence(allEvidence);

    // Developer observability (opt-in, dev only): full pipeline snapshot.
    logMomentPipelineDiagnostics(uid, retained, profile);

    await withTimeout(
      setDoc(
        doc(db, 'users', uid),
        {
          momentProfile: { ...profile, updatedAt: serverTimestamp() },
          // profile.momentReady is the Behaviour-channel pool flag. profile.updatedAt
          // is the shared pool-recency field. Merge preserves profile.matchReady.
          profile: { momentReady: isMomentReady(profile), updatedAt: serverTimestamp() },
        },
        { merge: true },
      ),
      FIRESTORE_WRITE_MS,
      'moment profile write',
    );
  } catch (err) {
    console.warn('[MomentEvidence] sync failed (kept locally, will retry):', err);
  }
}
