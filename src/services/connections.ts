import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  query,
  where,
  serverTimestamp,
  or,
  orderBy,
  onSnapshot
} from 'firebase/firestore';
import { db } from './firebase';
import type { SeenUser } from '../auth/providers/types';
import { apiClient } from './apiClient';
import { MATCH_CANDIDATE_API } from '../config/api';
import { asConnectionOrigin, type ConnectionOrigin } from './connectionOrigin';

export interface ConnectionRequest {
  id?: string;
  fromUid: string;
  toUid: string;
  status: 'pending' | 'accepted' | 'declined';
  reason: string;
  matchScore: number | null;
  matchReasons?: string[];
  /** Connection Origin — which understanding channel brought them together. */
  origin?: ConnectionOrigin;
  createdAt: any;
  updatedAt: any;
  // Hydrated fields for UI
  senderProfile?: CandidateProfile;
}

export interface Connection {
  id?: string;
  users: string[];
  createdAt: any;
  createdFromRequestId: string;
  userMap: Record<string, boolean>;
  matchReasons?: string[];
  /** Connection Origin — carried from the originating request; shown to both users. */
  origin?: ConnectionOrigin;
  lastMessage?: string;
  lastMessageAt?: any;
  // Hydrated fields for UI
  otherUserProfile?: CandidateProfile;
}

export interface ChatMessage {
  id?: string;
  connectionId: string;
  senderUid: string;
  text: string;
  createdAt: any;
}

export interface CandidateProfile {
  uid: string;
  nickname?: string;
  soulProfile?: any;
  basic?: any;
  finalScore?: number;
  matchReason?: string;
  matchReasons?: string[];
  /** T-301: localized human-language resonance reasons from /match/candidate. */
  reasonsLocalized?: Array<{ zh: string; en: string }>;
  /** Connection Origin — internal channel classification from /match/candidate. */
  source?: ConnectionOrigin;
}

/**
 * T-301 — batch-hydrate minimal public profiles (uid, nickname) for users the
 * caller already shares a request/connection with, via the Admin SDK endpoint.
 * Used once owner-only Firestore rules make direct cross-user reads impossible.
 */
async function hydrateProfiles(
  uids: string[],
): Promise<Record<string, { uid: string; nickname: string }>> {
  const unique = Array.from(new Set(uids.filter(Boolean)));
  if (unique.length === 0) return {};
  try {
    const result = await apiClient('/profiles/hydrate', {
      method: 'POST',
      data: { uids: unique },
    });
    return result?.profiles || {};
  } catch (err) {
    console.warn('[hydrateProfiles] failed:', err);
    return {};
  }
}

/**
 * T-301 — server-side candidate selection. The client sends only its identity
 * (ID token attached by apiClient); the server ranks on emergent traits and
 * returns one candidate with human-language reasons (no traits, no scores).
 */
async function getResonateCandidateServer(): Promise<CandidateProfile | null> {
  try {
    const result = await apiClient('/match/candidate', { method: 'POST', data: {} });
    const c = result?.candidate;
    if (!c) return null;
    return {
      uid: c.uid,
      nickname: c.nickname,
      reasonsLocalized: Array.isArray(c.reasons) ? c.reasons : [],
      source: asConnectionOrigin(c.source),
    };
  } catch (err) {
    console.error('[getResonateCandidateServer] failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Candidate Selection
// ---------------------------------------------------------------------------

export function generateMatchReasons(mySoul: any, candidateSoul: any): string[] {
  const reasons: string[] = [];
  if (!mySoul || !candidateSoul) return reasons;
  
  const model1 = mySoul.reflectModel || mySoul.latestInsight;
  const model2 = candidateSoul.reflectModel || candidateSoul.latestInsight;
  
  if (!model1 || !model2) return reasons;

  // Simple exact match checks for string fields
  if (model1.decisionModel && model1.decisionModel === model2.decisionModel) {
    reasons.push('decision_model');
  }
  if (model1.behaviorPattern && model1.behaviorPattern === model2.behaviorPattern) {
    reasons.push('behavior_pattern');
  }
  if (model1.coreConflict && model1.coreConflict === model2.coreConflict) {
    reasons.push('core_conflict');
  }
  if (model1.relationshipNeed && model1.relationshipNeed === model2.relationshipNeed) {
    reasons.push('relationship_need');
  }
  if (model1.motivation && model1.motivation === model2.motivation) {
    reasons.push('motivation');
  }

  // Array overlap checks
  const checkArrayOverlap = (field: string, reasonKey: string) => {
    if (Array.isArray(model1[field]) && Array.isArray(model2[field])) {
      const overlap = model1[field].filter((v: string) => model2[field].includes(v));
      if (overlap.length > 0) {
        reasons.push(reasonKey);
      }
    }
  };

  checkArrayOverlap('thinkingStyle', 'thinking_style');
  checkArrayOverlap('coreQuestions', 'core_questions');
  checkArrayOverlap('worldview', 'worldview');
  checkArrayOverlap('relationshipPhilosophy', 'relationship_philosophy');
  checkArrayOverlap('conversationStyle', 'conversation_style');

  // If no specific reasons, provide some fallbacks
  if (reasons.length === 0) {
    reasons.push('similar_frequency');
  }

  // Return up to 3 reasons
  return reasons.slice(0, 3);
}

export async function getResonateCandidate(currentUid: string): Promise<CandidateProfile | null> {
  if (!currentUid) return null;

  // T-301 W6 — server-side selection (owner-only rules forbid client fetch-all).
  if (MATCH_CANDIDATE_API) {
    return getResonateCandidateServer();
  }

  try {
    console.log('[getResonateCandidate] Fetching users for candidate selection...');
    // For v1, we just query some users and pick one that isn't the current user 
    // and isn't already connected/requested.
    // In a real app, this would be a complex backend matching query.
    const usersRef = collection(db, 'users');
    // We'll just fetch a small batch of users. Since we can't easily do a random query,
    // we'll just get some and filter client-side for v1.
    const q = query(usersRef);
    const snapshot = await getDocs(q);
    
    console.log('[getResonateCandidate] Total users fetched:', snapshot.size);

    // Fetch current user to get their profile
    const myDoc = await getDoc(doc(db, 'users', currentUid));
    if (!myDoc.exists()) return null;
    const myData = myDoc.data() as SeenUser;
    
    let candidates: CandidateProfile[] = [];
    
    snapshot.forEach(docSnap => {
      const data = docSnap.data() as SeenUser;
      if (data.uid !== currentUid) {
        // Only include candidates who actually have a reflect model or insight
        const soulProfile: any = data.soulProfile;
        if (soulProfile?.reflectModel || soulProfile?.latestInsight) {
          candidates.push({
            uid: data.uid,
            nickname: data.nickname || data.basic?.nickname || 'Anonymous User',
            soulProfile: data.soulProfile,
            basic: data.basic
          });
        }
      }
    });

    console.log('[getResonateCandidate] Candidates after filtering self and empty profiles:', candidates.length);

    // Filter out users we already have a connection or pending request with
    let excludedUids = new Set<string>();
    try {
      const existingRequests = await getDocs(
        query(
          collection(db, 'connectionRequests'),
          or(
            where('fromUid', '==', currentUid),
            where('toUid', '==', currentUid)
          )
        )
      );
      
      existingRequests.forEach(docSnap => {
        const req = docSnap.data() as ConnectionRequest;
        if (req.status !== 'declined') { // If declined, maybe we don't show again, but let's exclude all for now
          excludedUids.add(req.fromUid);
          excludedUids.add(req.toUid);
        }
      });
    } catch (reqErr) {
      console.warn('[getResonateCandidate] Could not fetch connectionRequests (might be missing index or rules), skipping exclusion:', reqErr);
    }

    candidates = candidates.filter(c => !excludedUids.has(c.uid));
    console.log('[getResonateCandidate] Candidates after filtering existing requests/connections:', candidates.length);

    if (candidates.length === 0) {
      console.log('[getResonateCandidate] No candidates found.');
      return null;
    }

    // Call Backend Lambda to rank candidates
    console.log('[getResonateCandidate] Sending candidates to backend matching engine...');

    try {
      const result = await apiClient('/match/rank', {
        method: 'POST',
        data: {
          currentUser: myData,
          candidates
        }
      });

      if (result.rankedCandidates && result.rankedCandidates.length > 0) {
        const topCandidate = result.rankedCandidates[0];
        console.log('[getResonateCandidate] Backend returned ranked candidate:', topCandidate.uid, 'Score:', topCandidate.finalScore);
        
        // Generate match reasons
        topCandidate.matchReasons = generateMatchReasons(myData.soulProfile, topCandidate.soulProfile);
        
        return topCandidate;
      }
    } catch (error) {
      console.error('[getResonateCandidate] Backend matching failed:', error);
      // Fallback to local sort if backend fails
      candidates.sort((a, b) => {
        const aHasModel = a.soulProfile?.reflectModel ? 1 : 0;
        const bHasModel = b.soulProfile?.reflectModel ? 1 : 0;
        return bHasModel - aHasModel;
      });
      const topCandidate = candidates[0];
      topCandidate.matchReasons = generateMatchReasons(myData.soulProfile, topCandidate.soulProfile);
      return topCandidate;
    }

    return null;
  } catch (error) {
    console.error('[getResonateCandidate] Error fetching candidate. This might be a permissions issue:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export async function sendConnectionRequest(
  fromUid: string, 
  toUid: string, 
  reason: string = 'You both reflect deeply on similar themes.',
  matchScore: number | null = null,
  matchReasons: string[] = [],
  origin?: ConnectionOrigin
): Promise<boolean> {
  console.log('[sendConnectionRequest] Called with:', { fromUid, toUid, reason, matchScore, matchReasons });
  try {
    // Check for existing pending requests or connections
    const existingReqs = await getDocs(
      query(
        collection(db, 'connectionRequests'),
        where('fromUid', '==', fromUid),
        where('toUid', '==', toUid),
        where('status', '==', 'pending')
      )
    );
    
    if (!existingReqs.empty) {
      console.log('[sendConnectionRequest] Request already exists. Aborting write.');
      return false;
    }

    // Also check reverse
    const reverseReqs = await getDocs(
      query(
        collection(db, 'connectionRequests'),
        where('fromUid', '==', toUid),
        where('toUid', '==', fromUid),
        where('status', '==', 'pending')
      )
    );

    if (!reverseReqs.empty) {
      console.log('[sendConnectionRequest] Reverse request already exists. Aborting write.');
      return false;
    }

    // Check if already connected
    const existingConnections = await getDocs(
      query(
        collection(db, 'connections'),
        where(`userMap.${fromUid}`, '==', true),
        where(`userMap.${toUid}`, '==', true)
      )
    );

    if (!existingConnections.empty) {
      console.log('[sendConnectionRequest] Already connected. Aborting write.');
      return false;
    }

    const payload = {
      fromUid,
      toUid,
      status: 'pending',
      reason,
      matchScore: matchScore === undefined ? null : matchScore, // Ensure no undefined values
      matchReasons: matchReasons || [],
      ...(origin ? { origin } : {}), // Connection Origin (omit when unknown — no undefined in Firestore)
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    console.log('[sendConnectionRequest] Firestore write start. Collection: connectionRequests, Payload:', payload);

    const docRef = await addDoc(collection(db, 'connectionRequests'), payload);

    console.log('[sendConnectionRequest] Firestore write success! Document ID:', docRef.id);
    return true;
  } catch (error) {
    console.error('[sendConnectionRequest] Firestore write failure! Full error:', error);
    return false;
  }
}

export async function getInboxRequests(currentUid: string): Promise<ConnectionRequest[]> {
  try {
    const q = query(
      collection(db, 'connectionRequests'),
      where('toUid', '==', currentUid),
      where('status', '==', 'pending')
    );
    const snapshot = await getDocs(q);
    const requests: ConnectionRequest[] = [];

    // T-301 — when server selection is on, hydrate sender names via the Admin-SDK
    // endpoint (owner-only rules forbid reading other users' docs directly).
    const hydrationMap = MATCH_CANDIDATE_API
      ? await hydrateProfiles(snapshot.docs.map(d => (d.data() as ConnectionRequest).fromUid))
      : {};

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as ConnectionRequest;
      data.id = docSnap.id;

      if (MATCH_CANDIDATE_API) {
        const hydrated = hydrationMap[data.fromUid];
        data.senderProfile = {
          uid: data.fromUid,
          nickname: hydrated?.nickname || 'Anonymous User',
        };
      } else {
        // Legacy: direct read (pre-rules-deploy).
        const senderDoc = await getDoc(doc(db, 'users', data.fromUid));
        if (senderDoc.exists()) {
          const senderData = senderDoc.data() as SeenUser;
          data.senderProfile = {
            uid: senderData.uid,
            nickname: senderData.nickname || senderData.basic?.nickname || 'Anonymous User',
            soulProfile: senderData.soulProfile,
            basic: senderData.basic
          };
        }
      }

      requests.push(data);
    }
    
    return requests.sort((a, b) => {
      const timeA = a.createdAt?.toMillis?.() || 0;
      const timeB = b.createdAt?.toMillis?.() || 0;
      return timeB - timeA;
    });
  } catch (error) {
    console.error('Error fetching inbox requests:', error);
    return [];
  }
}

export async function acceptConnectionRequest(requestId: string): Promise<boolean> {
  try {
    const reqRef = doc(db, 'connectionRequests', requestId);
    const reqSnap = await getDoc(reqRef);
    
    if (!reqSnap.exists()) return false;
    
    const reqData = reqSnap.data() as ConnectionRequest;
    if (reqData.status !== 'pending') return false;

    // Update request status
    await updateDoc(reqRef, {
      status: 'accepted',
      updatedAt: serverTimestamp()
    });

    // Create connection
    // Check if connection already exists just in case
    const existingConnections = await getDocs(
      query(
        collection(db, 'connections'),
        where(`userMap.${reqData.fromUid}`, '==', true),
        where(`userMap.${reqData.toUid}`, '==', true)
      )
    );

    if (existingConnections.empty) {
      await addDoc(collection(db, 'connections'), {
        users: [reqData.fromUid, reqData.toUid],
        userMap: {
          [reqData.fromUid]: true,
          [reqData.toUid]: true
        },
        matchReasons: reqData.matchReasons || [],
        ...(reqData.origin ? { origin: reqData.origin } : {}), // carry Connection Origin to both users
        createdAt: serverTimestamp(),
        createdFromRequestId: requestId
      });
    }

    return true;
  } catch (error) {
    console.error('Error accepting connection request:', error);
    return false;
  }
}

export async function declineConnectionRequest(requestId: string): Promise<boolean> {
  try {
    const reqRef = doc(db, 'connectionRequests', requestId);
    await updateDoc(reqRef, {
      status: 'declined',
      updatedAt: serverTimestamp()
    });
    return true;
  } catch (error) {
    console.error('Error declining connection request:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export async function getUserConnections(currentUid: string): Promise<Connection[]> {
  try {
    const q = query(
      collection(db, 'connections'),
      where(`userMap.${currentUid}`, '==', true)
    );
    const snapshot = await getDocs(q);
    const connections: Connection[] = [];

    // T-301 — batch-hydrate the other participant's name via the Admin-SDK endpoint
    // when server selection is on (owner-only rules forbid direct cross-user reads).
    const otherUids = snapshot.docs
      .map(d => (d.data() as Connection).users?.find(uid => uid !== currentUid))
      .filter((u): u is string => Boolean(u));
    const hydrationMap = MATCH_CANDIDATE_API ? await hydrateProfiles(otherUids) : {};

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as Connection;
      data.id = docSnap.id;

      const otherUid = data.users.find(uid => uid !== currentUid);
      if (otherUid) {
        if (MATCH_CANDIDATE_API) {
          const hydrated = hydrationMap[otherUid];
          data.otherUserProfile = {
            uid: otherUid,
            nickname: hydrated?.nickname || 'Anonymous User',
          };
        } else {
          // Legacy: direct read (pre-rules-deploy).
          const otherDoc = await getDoc(doc(db, 'users', otherUid));
          if (otherDoc.exists()) {
            const otherData = otherDoc.data() as SeenUser;
            data.otherUserProfile = {
              uid: otherData.uid,
              nickname: otherData.nickname || otherData.basic?.nickname || 'Anonymous User',
              soulProfile: otherData.soulProfile,
              basic: otherData.basic
            };
          }
        }
      }

      connections.push(data);
    }
    
    return connections.sort((a, b) => {
      // Sort by lastMessageAt first, then createdAt
      const timeA = a.lastMessageAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
      const timeB = b.lastMessageAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
      return timeB - timeA;
    });
  } catch (error) {
    console.error('Error fetching user connections:', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Chat Messages
// ---------------------------------------------------------------------------

export function subscribeToMessages(
  connectionId: string, 
  callback: (messages: ChatMessage[]) => void
) {
  const q = query(
    collection(db, 'connections', connectionId, 'messages'),
    orderBy('createdAt', 'asc')
  );

  return onSnapshot(q, (snapshot) => {
    const msgs: ChatMessage[] = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      msgs.push({
        id: docSnap.id,
        connectionId: data.connectionId,
        senderUid: data.senderUid,
        text: data.text,
        createdAt: data.createdAt
      });
    });
    callback(msgs);
  }, (error) => {
    console.error('Error subscribing to messages:', error);
  });
}

export async function sendMessage(connectionId: string, senderUid: string, text: string): Promise<boolean> {
  if (!text.trim()) return false;
  
  try {
    // 1. Add message to subcollection
    const messagesRef = collection(db, 'connections', connectionId, 'messages');
    await addDoc(messagesRef, {
      connectionId,
      senderUid,
      text: text.trim(),
      createdAt: serverTimestamp()
    });

    // 2. Update connection's lastMessage for the list view
    const connRef = doc(db, 'connections', connectionId);
    await updateDoc(connRef, {
      lastMessage: text.trim(),
      lastMessageAt: serverTimestamp()
    });

    return true;
  } catch (error) {
    console.error('Error sending message:', error);
    return false;
  }
}
