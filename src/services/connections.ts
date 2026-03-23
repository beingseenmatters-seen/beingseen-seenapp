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
  or
} from 'firebase/firestore';
import { db } from './firebase';
import type { SeenUser } from '../auth/providers/types';

export interface ConnectionRequest {
  id?: string;
  fromUid: string;
  toUid: string;
  status: 'pending' | 'accepted' | 'declined';
  reason: string;
  matchScore: number | null;
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
  // Hydrated fields for UI
  otherUserProfile?: CandidateProfile;
}

export interface CandidateProfile {
  uid: string;
  nickname?: string;
  soulProfile?: any;
  basic?: any;
}

// ---------------------------------------------------------------------------
// Candidate Selection
// ---------------------------------------------------------------------------

export async function getResonateCandidate(currentUid: string): Promise<CandidateProfile | null> {
  if (!currentUid) return null;

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

    let candidates: CandidateProfile[] = [];
    
    snapshot.forEach(docSnap => {
      const data = docSnap.data() as SeenUser;
      if (data.uid !== currentUid) {
        candidates.push({
          uid: data.uid,
          nickname: data.nickname || data.basic?.nickname || 'Anonymous User',
          soulProfile: data.soulProfile,
          basic: data.basic
        });
      }
    });

    console.log('[getResonateCandidate] Candidates after filtering self:', candidates.length);

    // Filter out users we already have a connection or pending request with
    const existingRequests = await getDocs(
      query(
        collection(db, 'connectionRequests'),
        or(
          where('fromUid', '==', currentUid),
          where('toUid', '==', currentUid)
        )
      )
    );
    
    const excludedUids = new Set<string>();
    existingRequests.forEach(docSnap => {
      const req = docSnap.data() as ConnectionRequest;
      if (req.status !== 'declined') { // If declined, maybe we don't show again, but let's exclude all for now
        excludedUids.add(req.fromUid);
        excludedUids.add(req.toUid);
      }
    });

    candidates = candidates.filter(c => !excludedUids.has(c.uid));
    console.log('[getResonateCandidate] Candidates after filtering existing requests/connections:', candidates.length);

    // Prefer candidates with reflectModel
    candidates.sort((a, b) => {
      const aHasModel = a.soulProfile?.reflectModel ? 1 : 0;
      const bHasModel = b.soulProfile?.reflectModel ? 1 : 0;
      return bHasModel - aHasModel;
    });

    if (candidates.length > 0) {
      console.log('[getResonateCandidate] Selected candidate:', candidates[0].uid);
      return candidates[0];
    }

    console.log('[getResonateCandidate] No candidates found.');
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
  matchScore: number | null = null
): Promise<boolean> {
  console.log('[sendConnectionRequest] Called with:', { fromUid, toUid, reason, matchScore });
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
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as ConnectionRequest;
      data.id = docSnap.id;
      
      // Hydrate sender profile
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
    
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() as Connection;
      data.id = docSnap.id;
      
      // Hydrate other user profile
      const otherUid = data.users.find(uid => uid !== currentUid);
      if (otherUid) {
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
      
      connections.push(data);
    }
    
    return connections.sort((a, b) => {
      const timeA = a.createdAt?.toMillis?.() || 0;
      const timeB = b.createdAt?.toMillis?.() || 0;
      return timeB - timeA;
    });
  } catch (error) {
    console.error('Error fetching user connections:', error);
    return [];
  }
}
