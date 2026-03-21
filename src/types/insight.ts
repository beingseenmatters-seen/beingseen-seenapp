export type RetentionOption = '3days' | '5days' | '7days' | 'none';

export const RETENTION_OPTIONS: RetentionOption[] = ['3days', '5days', '7days', 'none'];

export const RETENTION_TTL_DAYS: Record<RetentionOption, number> = {
  '3days': 3,
  '5days': 5,
  '7days': 7,
  'none': 0,
};

// ---------------------------------------------------------------------------
// Layered Insight Model
// TODO: Implement backend persistence + TTL-based auto-deletion
// TODO: Integrate with existing userSummary service
// ---------------------------------------------------------------------------

export interface SessionSummary {
  sessionId: string;
  createdAt: number;
  topic: string;
  emotionalTone: string;
  keywords: string[];
  tension?: string;
}

export interface InsightEntry {
  key: string;
  value: string;
  confidence: number;
  firstSeen: number;
  lastReinforced: number;
  reinforcementCount: number;
}

export interface StableInsights {
  traits: InsightEntry[];
}

export interface CandidateInsights {
  candidates: InsightEntry[];
}

export interface DynamicState {
  mood?: string;
  energy?: string;
  updatedAt: number;
}

// TODO: Confidence threshold for promoting candidate → stable
export const CONFIDENCE_PROMOTION_THRESHOLD = 0.75;

// TODO: Calibration prompt type
export interface CalibrationPrompt {
  insightKey: string;
  insightValue: string;
  confidence: number;
  promptText: string;
}
