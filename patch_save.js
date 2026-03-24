const fs = require('fs');
const path = './src/services/userSummary.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `export function saveApprovedSummary(extraction: ConversationExtraction): {`,
  `import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export async function saveApprovedSummary(
  extraction: ConversationExtraction,
  uid?: string,
  sessionId?: string
): Promise<{
  insight: SessionInsight;
  model: UserUnderstandingModel | null;
  insightCount: number;
}> {`
);

content = content.replace(
  `  let model: UserUnderstandingModel | null = null;
  if (insights.length >= MIN_INSIGHTS_FOR_MODEL) {
    model = buildUserUnderstandingModel(insights);
    saveUserUnderstandingModel(model);
  }`,
  `  let model: UserUnderstandingModel | null = null;
  if (insights.length >= MIN_INSIGHTS_FOR_MODEL) {
    model = buildUserUnderstandingModel(insights);
    saveUserUnderstandingModel(model);
  }

  // Persist to Firestore if authenticated
  if (uid && sessionId) {
    try {
      const insightRef = doc(db, 'users', uid, 'reflectInsights', sessionId);
      await setDoc(insightRef, {
        ...insight,
        updatedAt: serverTimestamp()
      }, { merge: true });

      if (model) {
        const userRef = doc(db, 'users', uid);
        await setDoc(userRef, {
          soulProfile: {
            reflectModel: {
              ...model,
              updatedAt: serverTimestamp()
            }
          }
        }, { merge: true });
      }
      console.log('[UserSummary] Persisted to Firestore successfully');
    } catch (error) {
      console.error('[UserSummary] Failed to persist to Firestore:', error);
    }
  }`
);

fs.writeFileSync(path, content);
