const fs = require('fs');
const path = './src/services/userSummary.ts';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `export function extractSummaryFromConversation(
  messages: ConversationMessage[],
  options: { preferredResponseStyle?: string; language?: InsightLanguage } = {}
): ConversationExtraction {`,
  `import { extractReflectSummary } from './seenApi';

export async function extractSummaryFromConversation(
  messages: ConversationMessage[],
  options: { preferredResponseStyle?: string; language?: InsightLanguage; uid?: string; sessionId?: string } = {}
): Promise<ConversationExtraction> {`
);

const newBody = `
  const language = options.language ?? 'zh';
  const uid = options.uid || 'anonymous';
  const sessionId = options.sessionId || 'unknown';

  try {
    const response = await extractReflectSummary({
      uid,
      sessionId,
      conversation: messages,
      module: 'reflect',
      language
    });

    const extraction: ConversationExtraction = {
      summaryText: response.summary || '',
      thinkingStyle: [],
      coreQuestions: [],
      worldview: [],
      relationshipPhilosophy: [],
      conversationStyle: [],
      thinkingPath: [],
      preferredResponseStyle: options.preferredResponseStyle,
      contentSummary: response.layers?.contentSummary,
      emotion: response.layers?.emotion,
      trigger: response.layers?.trigger,
      values: response.layers?.values,
      behaviorPattern: response.layers?.behaviorPattern,
      decisionModel: response.layers?.decisionModel,
      personalityTraits: response.layers?.personalityTraits,
      relationshipNeed: response.layers?.relationshipNeed,
      motivation: response.layers?.motivation,
      coreConflict: response.layers?.coreConflict,
    };

    // Fallback to local logic if summaryText is empty
    if (!extraction.summaryText) {
      throw new Error('Empty summary from backend');
    }

    return extraction;
  } catch (error) {
    console.error('[UserSummary] Backend extraction failed, falling back to local:', error);
    
    const userMessages = messages.filter(message => message.role === 'user' && message.text.trim());
    const allMessages = messages.filter(message => message.role !== 'system' && message.text.trim());
    const userText = userMessages.map(message => message.text).join('\\n');
    const userTextLower = userText.toLowerCase();
    const allTextLower = allMessages.map(message => message.text).join('\\n').toLowerCase();

    const thinkingPath = extractThinkingPath(userMessages);
    const thinkingStyle = inferThinkingStyle(userTextLower, thinkingPath);
    const coreQuestions = inferCoreQuestions(userMessages, userTextLower, language);
    const worldview = inferWorldview(userTextLower, allTextLower);
    const relationshipPhilosophy = inferRelationshipPhilosophy(userTextLower);
    const conversationStyle = inferConversationStyle(userMessages, userTextLower, thinkingPath);

    const extraction: ConversationExtraction = {
      summaryText: '',
      thinkingStyle: thinkingStyle.slice(0, 4),
      coreQuestions: coreQuestions.slice(0, 4),
      worldview: worldview.slice(0, 4),
      relationshipPhilosophy: relationshipPhilosophy.slice(0, 4),
      conversationStyle: conversationStyle.slice(0, 4),
      thinkingPath: thinkingPath.slice(0, 6),
      preferredResponseStyle: options.preferredResponseStyle,
    };

    extraction.summaryText = buildSummaryText(extraction, language);
    return extraction;
  }
}
`;

content = content.replace(
  /const language = options\.language \?\? 'zh';[\s\S]*?return extraction;\n}/,
  newBody.trim() + '\n}'
);

fs.writeFileSync(path, content);
