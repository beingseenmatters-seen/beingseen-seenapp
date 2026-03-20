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
  sourceInsightCount: number;
  lastUpdated: number;
}

// Backward-compatible alias while older imports are migrated.
export type UserPersonalityModel = UserUnderstandingModel;
