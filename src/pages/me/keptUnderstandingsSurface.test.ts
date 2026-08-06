import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(__dirname, '../..');

function read(rel: string): string {
  return readFileSync(resolve(SRC, rel), 'utf8');
}

describe('Reflect kept understandings Me surface', () => {
  it('Me links to /me/reflect-understandings under Seen 眼中的你', () => {
    const me = read('pages/Me.tsx');
    expect(me).toContain("navigate('/me/reflect-understandings')");
    expect(me).toContain('useKeptReflections');
    expect(me).toContain('kept_understandings_title');
    expect(me).toContain('section_seen');
  });

  it('reserves Current Understanding placeholder first under Seen 眼中的你 without implementing CU', () => {
    const me = read('pages/Me.tsx');
    const cuIdx = me.indexOf('current_understanding_title');
    const momentsIdx = me.indexOf('moments_empty_title');
    const keptIdx = me.indexOf('kept_understandings_title');
    expect(cuIdx).toBeGreaterThan(-1);
    expect(cuIdx).toBeLessThan(momentsIdx);
    expect(momentsIdx).toBeLessThan(keptIdx);
    expect(me).toContain('Placeholder only');
    expect(me).not.toMatch(/from ['"].*currentUnderstanding['"]/);
    const zh = JSON.parse(read('i18n/zh.json'));
    const en = JSON.parse(read('i18n/en.json'));
    expect(zh.me.current_understanding_title).toBe('Seen 对你的理解');
    expect(zh.me.current_understanding_cta).toBe('继续了解我');
    expect(en.me.current_understanding_title).toBe('Current Understanding');
    expect(en.me.current_understanding_cta).toBe('Keep Exploring');
  });

  it('App registers the history route without wiring Evidence or soulProfile', () => {
    const app = read('App.tsx');
    expect(app).toContain('path="/me/reflect-understandings"');
    expect(app).toContain('ReflectionHistory');
    expect(app).not.toMatch(/currentUnderstanding|reflectEvidence|soulProfile\.reflectModel/);
  });

  it('history page reads kept reflections only and does not expose delete', () => {
    const page = read('pages/settings/ReflectionHistory.tsx');
    expect(page).toContain('useKeptReflections');
    expect(page).toContain('r.text');
    expect(page).toContain('createdAt');
    expect(page).not.toContain('remove(');
    expect(page).not.toContain('deleteKeptReflection');
    expect(page).not.toMatch(/soulProfile|reflectModel|emergentTraits|confidence/);
  });

  it('Reflect keep writes kept reflections; reject does not', () => {
    const reflect = read('pages/Reflect.tsx');
    expect(reflect).toContain('saveKeptReflection');
    const rejectBlock = reflect.slice(
      reflect.indexOf('const handleRejectSummary'),
      reflect.indexOf('const handleRejectSummary') + 800,
    );
    expect(rejectBlock).not.toContain('saveKeptReflection');
    expect(rejectBlock).not.toContain('saveApprovedSummary');
  });

  it('records frozen Reflect retention principle: Updates long-term, not chat history', () => {
    const recent = read('services/recentConversations.ts');
    const history = read('pages/settings/ReflectionHistory.tsx');
    const reflect = read('pages/Reflect.tsx');
    expect(recent).toContain('Founder Architecture Decision — FROZEN (2026-08-06)');
    expect(recent).toContain('not a messaging app');
    expect(recent).toContain('Understanding Update');
    expect(recent).toContain('我留下的理解');
    expect(history).toContain('only long-term user-facing artifact of Reflect');
    expect(reflect).toContain('Founder Architecture Decision — FROZEN (2026-08-06)');
    expect(reflect).toContain('permanent user-facing history');
  });

  it('kept store is uid-scoped, logout detaches, hydrate replaces without merge', () => {
    const store = read('services/keptReflections.ts');
    expect(store).toContain('seen_kept_reflections_v2_');
    expect(store).toContain('detachKeptReflectionsOnLogout');
    expect(store).toMatch(/REPLACE|Replace/);
    expect(store).not.toMatch(/cacheOnly/);
    expect(store).not.toMatch(/Migrate cache-only/);
    const auth = read('auth/AuthContext.tsx');
    expect(auth).toContain('detachAllUserLocalStorage');
    const scoped = read('services/userScopedStorage.ts');
    expect(scoped).toContain('seen_retained_conversations_v2_');
    expect(scoped).toContain('seen_reflect_session_v2_');
  });

  it('bilingual Me copy exists and avoids Sketch / Current Understanding labels', () => {
    const zh = JSON.parse(read('i18n/zh.json'));
    const en = JSON.parse(read('i18n/en.json'));
    expect(zh.me.kept_understandings_title).toBe('我留下的理解');
    expect(en.me.kept_understandings_title).toBe('Understandings I Kept');
    expect(zh.me.reflections.page_title).toBe('我留下的理解');
    expect(en.me.reflections.page_title).toBe('Understandings I Kept');
    const blob = JSON.stringify(zh.me.reflections) + JSON.stringify(en.me.reflections);
    expect(blob.toLowerCase()).not.toContain('sketch');
    expect(blob.toLowerCase()).not.toContain('current understanding');
    expect(blob).not.toContain('速写');
  });
});
