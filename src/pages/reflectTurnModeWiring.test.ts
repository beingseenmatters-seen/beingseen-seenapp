/**
 * Phase 2C — UI wiring guards for turn-level response-mode switching.
 *
 * The project has no DOM test environment (no jsdom/testing-library), so the
 * request-pipeline behaviour is covered in reflectTurnModes.test.ts and the
 * persistence behaviour in recentConversations.turnModes.test.ts. These
 * source-level assertions pin the component wiring those tests rely on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reflectSource = readFileSync(resolve(__dirname, './Reflect.tsx'), 'utf-8');
const userSummarySource = readFileSync(
  resolve(__dirname, '../services/userSummary.ts'),
  'utf-8'
);

describe('turn-level selector availability', () => {
  it('the whole-session lock is gone', () => {
    expect(reflectSource).not.toContain('responseModeLocked');
    expect(reflectSource).not.toContain('sessionResponseMode');
    expect(reflectSource).not.toContain('draftResponseMode');
  });

  it('selection is allowed only while active and nothing is in flight', () => {
    expect(reflectSource).toMatch(
      /const modeSelectorDisabled =\s*\n\s*isLoading \|\|\s*\n\s*isExtractingSummary \|\|\s*\n\s*isSavingDecision \|\|\s*\n\s*showSummaryConfirmation \|\|\s*\n\s*summaryError \|\|\s*\n\s*conversationStatus !== 'active';/
    );
  });

  it('the dropdown cannot open while the selector is disabled', () => {
    expect(reflectSource).toContain('roleDropdownOpen && !modeSelectorDisabled');
  });

  it('a disabled selector renders as a non-interactive element', () => {
    expect(reflectSource).toContain('aria-disabled="true"');
    // Both viewports render the disabled state as a div, not a button.
    expect(reflectSource).toMatch(/modeSelectorDisabled \? \(\s*\n\s*<div/);
  });

  it('only one selector exists per viewport (desktop composer / mobile header)', () => {
    // Desktop: composer footer; the mobile footer branch keeps retention only.
    expect(reflectSource).toContain('the composer footer keeps just the retention control');
    // Mobile: header control behind a !isDesktop guard.
    expect(reflectSource).toMatch(/\{!isDesktop && \(\s*\n\s*<div className="relative shrink-0">/);
  });
});

describe('per-turn snapshot and metadata', () => {
  it('both send paths snapshot the mode for the turn before the request', () => {
    const snapshots = reflectSource.match(/const modeForTurn = currentResponseMode;/g);
    expect(snapshots).toHaveLength(2);
  });

  it('AI replies store requested and effective mode with the turn', () => {
    expect(reflectSource).toContain('requestedMode: response.requestedMode');
    expect(reflectSource).toContain('effectiveMode: response.effectiveMode');
  });

  it('per-turn metadata persists with retained conversations', () => {
    expect(reflectSource).toContain('requestedMode: m.requestedMode');
    expect(reflectSource).toContain('effectiveMode: m.effectiveMode');
  });

  it('changing the current mode never rewrites earlier messages', () => {
    // The only setMessages calls append/replace whole turns; the mode
    // selection handler itself never touches messages.
    const handler = reflectSource.slice(
      reflectSource.indexOf('const handleSelectMode'),
      reflectSource.indexOf('const roleDropdownMenu')
    );
    expect(handler).toContain('setCurrentResponseMode(mode)');
    expect(handler).not.toContain('setMessages');
  });
});

describe('last-used mode updates only on an accepted send', () => {
  it('saveLastUsedResponseMode is called exactly in the two send paths', () => {
    const calls = reflectSource.match(/saveLastUsedResponseMode\(/g);
    expect(calls).toHaveLength(2);
    expect(reflectSource).toContain('saveLastUsedResponseMode(uid, modeForTurn)');
  });

  it('opening or using the dropdown never writes last-used', () => {
    const handler = reflectSource.slice(
      reflectSource.indexOf('const handleSelectMode'),
      reflectSource.indexOf('const roleDropdownMenu')
    );
    expect(handler).not.toContain('saveLastUsedResponseMode');
  });

  it('a new conversation initialises from the last actually-used mode', () => {
    expect(reflectSource).toContain('setCurrentResponseMode(loadLastUsedResponseMode(uid))');
  });
});

describe('restore and migration', () => {
  it('a restored conversation uses its own current mode, not the global last-used', () => {
    expect(reflectSource).toContain('setCurrentResponseMode(restoredMode)');
  });

  it('old whole-session fields migrate deterministically to currentResponseMode', () => {
    expect(reflectSource).toContain('tryNormalizeResponseMode(session.currentResponseMode) ??');
    expect(reflectSource).toContain('tryNormalizeResponseMode(session.responseMode) ??');
    expect(reflectSource).toContain('resolveLegacySessionResponseMode({');
  });

  it('the saved session dual-writes currentResponseMode and legacy fields', () => {
    expect(reflectSource).toContain('currentResponseMode,');
    expect(reflectSource).toContain('responseMode: currentResponseMode,');
    expect(reflectSource).toContain('sessionStyle: legacyStyle,');
  });

  it('restored messages carry per-turn metadata where present', () => {
    expect(reflectSource).toContain('tryNormalizeResponseMode(m.requestedMode) ?? undefined');
    expect(reflectSource).toContain('tryNormalizeResponseMode(m.effectiveMode) ?? undefined');
  });
});

describe('mode-change notice stays out of the conversation', () => {
  it('the transient notice is rendered from state, never appended as a message', () => {
    expect(reflectSource).toContain('下一次回复将使用「');
    expect(reflectSource).not.toMatch(/setMessages\([^)]*modeChangeNotice/);
  });
});

describe('mode metadata is a tool preference, never profile evidence', () => {
  it('extraction receives text-only messages', () => {
    expect(reflectSource).toContain(
      'const extractionMessages = messages.map(m => ({ role: m.role, text: m.text }));'
    );
  });

  it('the summary/trait pipeline has no knowledge of mode metadata', () => {
    expect(userSummarySource).not.toContain('requestedMode');
    expect(userSummarySource).not.toContain('effectiveMode');
  });
});
