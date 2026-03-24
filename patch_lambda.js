const fs = require('fs');
const path = './lambda/reflect-handler.mjs';
let content = fs.readFileSync(path, 'utf8');

const extractLogic = `  // Parse body early to use in both routes
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {}

  // Route: /extract
  if (event.requestContext?.http?.path === "/reflect/extract" || event.rawPath === "/reflect/extract") {
    console.log("Handling /reflect/extract request");
    
    const conversation = body.conversation;
    if (!Array.isArray(conversation) || conversation.length === 0) {
      return httpResponse(400, { error: "conversation_required" });
    }

    const language = body.language === "en" ? "en" : "zh";
    const openAIKey = await getOpenAIKey();
    const model = process.env.OPENAI_MODEL || MODEL;

    // Format conversation for extraction
    const transcript = conversation
      .filter(msg => msg.role === 'user' || msg.role === 'ai')
      .map(msg => \`\${msg.role === 'user' ? 'User' : 'AI'}: \${msg.text}\`)
      .join('\\n');

    console.log(\`[Extract] Processing conversation with \${conversation.length} turns, language: \${language}\`);

    const extractPrompt = \`You are an expert psychological profiler and conversation analyst.
Your task is to analyze the following conversation between a User and an AI, and extract a structured 10-layer psychological profile of the USER.

RULES:
1. Analyze the USER, not the AI.
2. Use the full conversation as context.
3. Focus only on what is reasonably supported by the conversation. Do not overclaim certainty.
4. Keep each field concise but meaningful.
5. The 'summary' field should be one compact paragraph synthesizing the overall state.
6. Output language: \${language === 'zh' ? 'Chinese (Simplified)' : 'English'}.
7. Return strictly valid JSON matching the exact structure below. Do NOT wrap in markdown code blocks (\`\`\`json). Return ONLY the raw JSON object.

REQUIRED JSON STRUCTURE:
{
  "layers": {
    "contentSummary": "Brief summary of what was discussed",
    "emotion": "Primary emotional state",
    "trigger": "What triggered the user's current state or thoughts",
    "values": "Underlying values or beliefs revealed",
    "behaviorPattern": "Observed behavioral tendencies",
    "decisionModel": "How the user seems to make decisions or process choices",
    "personalityTraits": "Inferred personality characteristics",
    "relationshipNeed": "What the user seems to need in relationships or interaction",
    "motivation": "Deep underlying drive or motivation",
    "coreConflict": "The central internal or external conflict"
  },
  "summary": "One compact paragraph synthesizing the above."
}

CONVERSATION TRANSCRIPT:
\${transcript}\`;

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: \`Bearer \${openAIKey}\`,
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "system", content: extractPrompt }],
          temperature: 0.2,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Extract] OpenAI API error:", errorText);
        return httpResponse(500, { error: "openai_api_error" });
      }

      const data = await response.json();
      let rawContent = data.choices?.[0]?.message?.content || "";
      
      // Clean up potential markdown formatting
      rawContent = rawContent.trim();
      if (rawContent.startsWith('\`\`\`json')) {
        rawContent = rawContent.replace(/^\`\`\`json\\n/, '').replace(/\\n\`\`\`$/, '');
      } else if (rawContent.startsWith('\`\`\`')) {
        rawContent = rawContent.replace(/^\`\`\`\\n/, '').replace(/\\n\`\`\`$/, '');
      }

      let parsedResult;
      try {
        parsedResult = JSON.parse(rawContent);
      } catch (parseError) {
        console.error("[Extract] Failed to parse JSON:", rawContent);
        // Attempt recovery: find first { and last }
        const startIdx = rawContent.indexOf('{');
        const endIdx = rawContent.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
           try {
             parsedResult = JSON.parse(rawContent.substring(startIdx, endIdx + 1));
           } catch (e) {
             return httpResponse(500, { error: "reflect_extract_parse_failed" });
           }
        } else {
          return httpResponse(500, { error: "reflect_extract_parse_failed" });
        }
      }

      // Validate required structure
      if (!parsedResult.layers || !parsedResult.summary) {
        console.error("[Extract] Missing required top-level fields:", parsedResult);
        return httpResponse(500, { error: "reflect_extract_invalid_structure" });
      }

      console.log("[Extract] Successfully extracted 10-layer profile");

      return httpResponse(200, {
        layers: {
          contentSummary: parsedResult.layers.contentSummary || "",
          emotion: parsedResult.layers.emotion || "",
          trigger: parsedResult.layers.trigger || "",
          values: parsedResult.layers.values || "",
          behaviorPattern: parsedResult.layers.behaviorPattern || "",
          decisionModel: parsedResult.layers.decisionModel || "",
          personalityTraits: parsedResult.layers.personalityTraits || "",
          relationshipNeed: parsedResult.layers.relationshipNeed || "",
          motivation: parsedResult.layers.motivation || "",
          coreConflict: parsedResult.layers.coreConflict || ""
        },
        summary: parsedResult.summary || "",
        model: model
      });

    } catch (error) {
      console.error("[Extract] Error processing request:", error);
      return httpResponse(500, { error: "internal_server_error" });
    }
  }`;

content = content.replace(
  /  \/\/ Route: \/extract[\s\S]*?  \/\/ Parse body\n  let body = \{\};\n  try \{\n    body = JSON\.parse\(event\.body \|\| "\{\}"\);\n  \} catch \{\}/,
  extractLogic
);

fs.writeFileSync(path, content);
