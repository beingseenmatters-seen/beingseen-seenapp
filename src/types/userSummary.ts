/**
 * A lightweight summary extracted from one single conversation.
 * This is shown to the user for approval before it becomes persistent.
 */
export interface ConversationExtraction {
  summaryText: string;
  thinkingStyle: string[];
  coreQuestions: string[];
  worldview: string[];
  relationshipPhilosophy: string[];
  conversationStyle: string[];
  thinkingPath: string[];
  preferredResponseStyle?: string;

  // New 10-layer LLM extraction fields
  contentSummary?: string;
  emotion?: string;
  trigger?: string;
  values?: string;
  behaviorPattern?: string;
  decisionModel?: string;
  personalityTraits?: string;
  relationshipNeed?: string;
  motivation?: string;
  coreConflict?: string;
}

/**
 * Each approved conversation summary is stored as a Session Insight.
 * Raw chat remains deletable and is not used as long-term storage.
 */
export interface SessionInsight extends ConversationExtraction {
  id: string;
  source: 'reflect';
  approvedByUser: true;
  createdAt: number;
  approvedAt: number;
}

/**
 * Stable user understanding derived from multiple session insights.
 * Matching should prefer this model over raw chats.
 */
export interface UserUnderstandingModel {
  thinkingStyle: string[];
  coreQuestions: string[];
  worldview: string[];
  relationshipPhilosophy: string[];
  conversationStyle: string[];
  thinkingPath: string[];
  preferredResponseStyle?: string;

  // New 10-layer LLM extraction fields
  contentSummary?: string;
  emotion?: string;
  trigger?: string;
  values?: string;
  behaviorPattern?: string;
  decisionModel?: string;
  personalityTraits?: string;
  relationshipNeed?: string;
  motivation?: string;
  coreConflict?: string;

  sourceInsightCount: number;
  lastUpdated: number;
}

// Backward-compatible alias while older imports are migrated.
export type UserPersonalityModel = UserUnderstandingModel;

// ---------------------------------------------------------------------------
// TODO: Layered insight model (Spec §八 — incremental, not full-overwrite)
// ---------------------------------------------------------------------------
// Each insight entry should carry a confidence score.
// Only insights reinforced across multiple sessions should enter "stable".
// Single-session observations stay as "candidate" until verified.
//
// TODO: Add these fields to SessionInsight / UserUnderstandingModel:
//   - emotionalTone: string (per-session, dynamic — NOT long-term trait)
//   - tension: string (per-session)
//   - confidence: number per value in each dimension
//   - reinforcementCount: number
//   - firstSeen / lastReinforced timestamps
//
// TODO: Separate dynamic state (mood, energy) from stable traits.
//   - "今天很累" → dynamic state, not a personality conclusion
//   - "重视责任" with confidence > 0.75 across 3+ sessions → stable trait
//
// TODO: buildUserUnderstandingModel should diff against existing model,
//   only saving new/strengthened/corrected entries, not full-overwrite.
// ---------------------------------------------------------------------------

// TODO: Calibration prompt (Spec §九)
// After conversation end, if a high-value new insight is detected,
// show a lightweight confirmation: "这很像我" / "不太像"
// Result adjusts confidence score for that insight entry.
export interface CalibrationResult {
  insightKey: string;
  insightValue: string;
  userResponse: 'like_me' | 'not_like_me';
  timestamp: number;
}
