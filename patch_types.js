const fs = require('fs');
const path = './src/types/userSummary.ts';
let content = fs.readFileSync(path, 'utf8');

const newFields = `  // New 10-layer LLM extraction fields
  contentSummary?: string;
  emotion?: string;
  trigger?: string;
  values?: string;
  behaviorPattern?: string;
  decisionModel?: string;
  personalityTraits?: string;
  relationshipNeed?: string;
  motivation?: string;
  coreConflict?: string;`;

content = content.replace(
  '  preferredResponseStyle?: string;\n}',
  `  preferredResponseStyle?: string;\n\n${newFields}\n}`
);

content = content.replace(
  '  preferredResponseStyle?: string;\n  sourceInsightCount: number;',
  `  preferredResponseStyle?: string;\n\n${newFields}\n\n  sourceInsightCount: number;`
);

fs.writeFileSync(path, content);
