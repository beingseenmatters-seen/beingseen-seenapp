import type { RetentionOption } from '../types/insight';
import { RETENTION_TTL_DAYS } from '../types/insight';

export interface ConversationMessage {
  role: 'user' | 'ai' | 'system';
  text: string;
}

export interface RetainedConversation {
  id: string;
  title?: string;
  messages: ConversationMessage[];
  retention: RetentionOption;
  retentionDays: number;
  createdAt: number;
  expiresAt: number;
  deletedAt?: number;
  sessionStyle?: string;
  selectedMode?: number | null;
}

const STORAGE_KEY = 'seen_retained_conversations';

function readAll(): RetainedConversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as RetainedConversation[];
  } catch {
    return [];
  }
}

function writeAll(convos: RetainedConversation[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(convos));
}

function generateTitle(messages: ConversationMessage[], language: string): string {
  const userMsgs = messages.filter(m => m.role === 'user' && m.text.trim());
  if (userMsgs.length === 0) return language === 'zh' ? '新对话' : 'New conversation';

  const allUserText = userMsgs.map(m => m.text).join(' ');
  const text = allUserText.trim();

  const topicPatterns: { pattern: RegExp; zh: string; en: string }[] = [
    { pattern: /责任|义务|担当/i, zh: '关于责任', en: 'On responsibility' },
    { pattern: /自由|选择|独立/i, zh: '关于自由与选择', en: 'On freedom and choice' },
    { pattern: /关系|亲密|伴侣|朋友|家人/i, zh: '关于那段关系', en: 'About a relationship' },
    { pattern: /情绪|焦虑|压力|不安|烦|累|难过/i, zh: '最近的情绪', en: 'Recent emotions' },
    { pattern: /工作|职业|事业|公司/i, zh: '关于工作', en: 'About work' },
    { pattern: /未来|方向|迷茫|不确定/i, zh: '关于未来的方向', en: 'On future direction' },
    { pattern: /自我|自己|认识自己|我是谁/i, zh: '关于自我认识', en: 'On self-understanding' },
    { pattern: /信任|忠诚|背叛/i, zh: '关于信任', en: 'On trust' },
    { pattern: /孤独|一个人|独处/i, zh: '关于独处', en: 'On solitude' },
    { pattern: /meaning|purpose|life/i, zh: '关于人生意义', en: 'On meaning' },
    { pattern: /relationship|partner|friend|family/i, zh: '关于关系', en: 'About a relationship' },
    { pattern: /anxiety|stress|pressure|tired|overwhelm/i, zh: '关于压力', en: 'On stress' },
    { pattern: /work|career|job/i, zh: '关于工作', en: 'About work' },
    { pattern: /future|direction|lost|uncertain/i, zh: '关于方向', en: 'On direction' },
    { pattern: /trust|loyalty|betray/i, zh: '关于信任', en: 'On trust' },
    { pattern: /lonely|alone|solitude/i, zh: '关于独处', en: 'On solitude' },
  ];

  for (const { pattern, zh, en } of topicPatterns) {
    if (pattern.test(text)) {
      return language === 'zh' ? zh : en;
    }
  }

  const first = userMsgs[0].text.trim();
  const maxLen = language === 'zh' ? 12 : 30;
  if (first.length <= maxLen) return first;
  return first.slice(0, maxLen) + '…';
}

export function getVisibleConversations(): RetainedConversation[] {
  const now = Date.now();
  return readAll().filter(c => !c.deletedAt && c.expiresAt > now && c.retentionDays > 0);
}

export function saveConversation(
  id: string,
  messages: ConversationMessage[],
  retention: RetentionOption,
  language: string,
  opts?: { sessionStyle?: string; selectedMode?: number | null; title?: string }
): RetainedConversation | null {
  const days = RETENTION_TTL_DAYS[retention];
  if (!days || days <= 0) return null;

  const userMsgs = messages.filter(m => m.role === 'user' && m.text.trim());
  if (userMsgs.length === 0) return null;

  const now = Date.now();
  const convo: RetainedConversation = {
    id,
    title: opts?.title || generateTitle(messages, language),
    messages: messages.filter(m => m.role !== 'system'),
    retention,
    retentionDays: days,
    createdAt: now,
    expiresAt: now + days * 24 * 60 * 60 * 1000,
    sessionStyle: opts?.sessionStyle,
    selectedMode: opts?.selectedMode,
  };

  const all = readAll().filter(c => c.id !== id);
  all.unshift(convo);
  writeAll(all);
  return convo;
}

export function deleteConversation(id: string): void {
  const all = readAll().map(c =>
    c.id === id ? { ...c, deletedAt: Date.now(), messages: [] } : c
  );
  writeAll(all);
}

export function getConversationById(id: string): RetainedConversation | null {
  const now = Date.now();
  const c = readAll().find(c => c.id === id);
  if (!c || c.deletedAt || c.expiresAt <= now) return null;
  return c;
}

export function purgeExpired(): number {
  const now = Date.now();
  const all = readAll();
  const kept = all.filter(c => c.expiresAt > now && !c.deletedAt);
  const removed = all.length - kept.length;
  if (removed > 0) writeAll(kept);
  return removed;
}

export function formatRelativeTime(timestamp: number, language: string): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (language === 'zh') {
    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    if (diffHr < 24) return `${diffHr} 小时前`;
    if (diffDay === 1) return '昨天';
    return `${diffDay} 天前`;
  }
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  return `${diffDay}d ago`;
}
