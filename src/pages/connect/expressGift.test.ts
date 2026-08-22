import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SRC = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf-8');
const zh = JSON.parse(read('i18n/zh.json'));
const en = JSON.parse(read('i18n/en.json'));
const gift = read('pages/connect/ExpressGift.tsx');
const app = read('App.tsx');
const inbox = read('pages/Inbox.tsx');

describe('Seen Connect → embedded Gift.Seen Send catalogue', () => {
  it('the Connect entry still exists and opens the embedded surface', () => {
    expect(inbox.includes("navigate('/connect/express')")).toBe(true);
    expect(inbox.includes("t('express.title')")).toBe(true); // 有句话，想送给 TA entry kept verbatim
    expect(app.includes('path="/connect/express"') && app.includes('<ExpressGift')).toBe(true);
  });

  it('the embedded page uses the CURRENT Gift.Seen title + supporting copy', () => {
    expect(gift.includes("P('catalogue_title')") && gift.includes("P('catalogue_subtitle')")).toBe(true);
    expect(zh.express.catalogue_title).toBe('今天，你想对 TA 说什么？');
    expect(zh.express.catalogue_subtitle).toBe('选一类心意，把心里的话，做成一枚只有 TA 能打开的心意。');
    expect(en.express.catalogue_title).toBe('What do you want to tell them today?');
  });

  it('renders EXACTLY the four Send families, routed into the CURRENT Gift.Seen product', () => {
    const keys = [...gift.matchAll(/key: '([a-z]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(['love', 'wishes', 'care', 'write']);
    expect(gift.includes("GIFT_HOME = 'https://gift.beingseenmatters.com'")).toBe(true);
    expect(gift.includes('`${GIFT_HOME}/c/love`')).toBe(true);
    expect(gift.includes('`${GIFT_HOME}/c/wishes`')).toBe(true);
    expect(gift.includes('`${GIFT_HOME}/c/care`')).toBe(true);
    expect(gift.includes('`${GIFT_HOME}/compose/custom`')).toBe(true);
  });

  it('does NOT pull Events / Live Interaction / Seen.Tag into Seen Connect', () => {
    expect(/\/e\/|\/live\/|\/tag\/|EVENT_FAMILIES|LIVE_INTERACTIONS|TAG_PRODUCTS/.test(gift)).toBe(false);
  });

  it('Seen Matters → main site; GIFT.SEEN → full Gift.Seen product (a real link, not decor)', () => {
    expect(gift.includes("SEEN_MATTERS_HOME = 'https://www.beingseenmatters.com'")).toBe(true);
    expect(gift.includes('href={SEEN_MATTERS_HOME}') && gift.includes('data-seen-matters-home')).toBe(true);
    expect(gift.includes('href={GIFT_HOME}') && gift.includes('data-open-full-gift')).toBe(true);
    expect(zh.express.seen_matters_home).toBe('返回 Seen Matters 首页');
    expect(zh.express.open_full_gift).toBe('打开完整 Gift.Seen');
    expect(en.express.seen_matters_home).toBe('Back to Seen Matters home');
    expect(en.express.open_full_gift).toBe('Open full Gift.Seen');
  });

  it('retires the legacy composer — no seal / draft / second Gift engine on this surface', () => {
    expect(/createGift|draftExpressions|generateHeartKey|handleSeal|composeSituation|shareQrImage|QRCode/.test(gift)).toBe(false);
    expect(gift.includes('data-send-catalogue')).toBe(true); // a catalogue of links, not a composer
  });

  it('preserves the compact 2-column card layout (mobile)', () => {
    expect(gift.includes('grid grid-cols-2')).toBe(true);
  });

  it('keeps zh/en express namespaces key-aligned (no cross-language leak)', () => {
    expect(Object.keys(en.express).sort()).toEqual(Object.keys(zh.express).sort());
  });
});
