/**
 * Phase 2B — UI wiring guards for recent-conversation restore and the 完成 flow.
 *
 * The project has no DOM test environment (no jsdom/testing-library), so
 * behavioral state logic is covered in the service tests
 * (recentConversations.statusFlow, userSummary.extract, reflectExtractContract).
 * These source-level assertions pin the component wiring those tests rely on.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reflectSource = readFileSync(resolve(__dirname, './Reflect.tsx'), 'utf-8');
const sidebarSource = readFileSync(
  resolve(__dirname, '../components/Sidebar.tsx'),
  'utf-8'
);
const drawerSource = readFileSync(
  resolve(__dirname, '../components/ReflectHistoryDrawer.tsx'),
  'utf-8'
);

describe('recent conversation selection (route-based)', () => {
  it('Reflect watches ?conversation=<id> changes, not only mount', () => {
    // The old bug: the restore effect ran with [] deps, so clicking a recent
    // item while already on Reflect did nothing.
    expect(reflectSource).toContain("searchParams.get('conversation')");
    expect(reflectSource).toMatch(/\}, \[searchParams\]\);/);
  });

  it('Sidebar rows are accessible buttons that navigate to the conversation route', () => {
    expect(sidebarSource).toContain('navigate(`/?conversation=${c.id}`)');
    expect(sidebarSource).toContain('aria-label={');
    expect(sidebarSource).toContain('focus-visible:ring');
    expect(sidebarSource).toContain("type=\"button\"");
  });

  it('Sidebar indicates the selected item and distinguishes ended conversations', () => {
    expect(sidebarSource).toContain("searchParams.get('conversation')");
    expect(sidebarSource).toContain('aria-current={isSelected');
    expect(sidebarSource).toContain("c.status === 'completed'");
  });

  it('the mobile drawer selects through the same route mechanism', () => {
    expect(reflectSource).toContain('setSearchParams({ conversation: id })');
    expect(drawerSource).toContain("conversation.status === 'completed'");
  });

  it('a stale entry shows the quiet notice instead of a blank screen', () => {
    expect(reflectSource).toContain('这段对话已不再保留。');
    expect(reflectSource).toContain('setStaleConversationNotice(true)');
  });
});

describe('完成 completion flow wiring', () => {
  it('完成 uses the strict backend extraction (no silent local fake)', () => {
    expect(reflectSource).toContain('extractSummaryFromBackend(messages, options)');
  });

  it('the extraction gate no longer silently skips short conversations', () => {
    expect(reflectSource).toContain('hasExtractableContent()');
  });

  it('duplicate completion clicks are blocked while extracting', () => {
    expect(reflectSource).toContain("if (isExtractingSummary) return 'shown'");
    expect(reflectSource).toContain('disabled={isExtractingSummary}');
  });

  it('extraction failure shows the retryable error with both actions', () => {
    expect(reflectSource).toContain('暂时没能整理出这段对话。你的内容还在，可以再试一次。');
    expect(reflectSource).toContain('再试一次');
    expect(reflectSource).toContain('返回对话');
    expect(reflectSource).toContain('handleRetryExtraction');
  });

  it('留下 / 放下 are protected against duplicate clicks', () => {
    expect(reflectSource).toContain('if (isSavingDecision) return;');
    expect(reflectSource).toContain('disabled={isSavingDecision}');
  });

  it('a failed 留下 save keeps the sentence and shows a retryable error', () => {
    expect(reflectSource).toContain('setDecisionError(true)');
    expect(reflectSource).toContain('没能保存这句话');
  });

  it('completed conversations render read-only with a new-conversation action', () => {
    expect(reflectSource).toContain("conversationStatus === 'completed'");
    expect(reflectSource).toContain('已结束');
    expect(reflectSource).toContain('这段对话已结束。');
    expect(reflectSource).toContain('开启新对话');
  });

  it('awaiting-decision restore reuses the saved sentence without re-extracting', () => {
    expect(reflectSource).toContain('hasRestorableExtraction');
    expect(reflectSource).toContain("setPendingInsightAction('finish')");
  });

  it('end-flow state persists in the saved session schema', () => {
    expect(reflectSource).toContain('status: conversationStatus');
    expect(reflectSource).toContain('pendingExtraction:');
  });
});

describe('retention control remains unchanged', () => {
  it('the three retention options still render from the same i18n keys', () => {
    expect(reflectSource).toContain("t('reflect.retention_3days')");
    expect(reflectSource).toContain("t('reflect.retention_7days')");
    expect(reflectSource).toContain("t('reflect.retention_none')");
  });
});
