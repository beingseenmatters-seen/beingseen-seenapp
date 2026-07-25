/**
 * Type declarations for lambda/reflectModes.mjs so frontend Vitest contract
 * tests can import the shared prompt/normalisation module.
 */

export const REFLECT_MODE_PROMPT_VERSION: string;
export const CANONICAL_MODES: string[];

export function isCanonicalMode(value: unknown): boolean;
export function normalizeResponseMode(value: unknown): string;
export function resolveRequestMode(body?: Record<string, unknown>): string;
export function toLegacyModeField(mode: string): string;

export interface LambdaUserState {
  prefersDirectMode: boolean;
  needsDirectAnswer: boolean;
  isDistressed: boolean;
}

export function analyzeUserText(text: string): LambdaUserState;

export function buildModeInstructions(
  mode: string,
  language: string,
  userState?: Partial<LambdaUserState>
): string;

// End-of-conversation extraction (/reflect/extract) — Phase 2B shared path.

export interface ExtractConversationMessage {
  role: string;
  text: string;
}

export interface ExtractResponsePayload {
  layers: Record<string, string>;
  reflection: string;
  summary: string;
  model: string;
}

export function formatExtractTranscript(
  conversation: ExtractConversationMessage[] | unknown
): string;

export function buildExtractPrompt(language: string, transcript: string): string;

export function parseExtractionContent(rawContent: string): Record<string, unknown> | null;

export function toExtractResponsePayload(
  parsed: unknown,
  model: string
): ExtractResponsePayload | null;
