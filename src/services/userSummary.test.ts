import { describe, expect, it } from 'vitest';
import { extractSummaryFromConversation } from './userSummary';

describe('extractSummaryFromConversation', () => {
  it('extracts cognitive understanding instead of personality labels', async () => {
    const extraction = await extractSummaryFromConversation(
      [
        {
          role: 'user',
          text: '我最近一直在想，忠诚到底能不能被验证。人心其实很难测量，所以关系也会随着时间和环境变化。',
        },
        {
          role: 'ai',
          text: '你像是在从忠诚，推到人心，再推到关系变化。',
        },
        {
          role: 'user',
          text: '对，而且我觉得人会不断聚合成部落、宗教、国家，但聚合之后又会因为熵和权力财富结构重新分散。',
        },
      ],
      { language: 'zh', preferredResponseStyle: 'Mirror' }
    );

    expect(extraction.thinkingStyle).toEqual(
      expect.arrayContaining(['philosophical_reasoning', 'systems_thinking', 'pattern_mapping'])
    );
    expect(extraction.coreQuestions).toEqual(
      expect.arrayContaining(['can_loyalty_be_measured', 'what_drives_human_aggregation'])
    );
    expect(extraction.worldview).toEqual(
      expect.arrayContaining(['aggregation_tends_toward_dispersion', 'power_and_wealth_shape_collective_order'])
    );
    expect(extraction.relationshipPhilosophy).toEqual(
      expect.arrayContaining(['trust_cannot_be_forced', 'relationships_change_with_context'])
    );
    expect(extraction.conversationStyle).toEqual(
      expect.arrayContaining(['concept_driven_dialogue', 'chain_reasoning'])
    );
    expect(extraction.thinkingPath).toEqual(
      expect.arrayContaining(['loyalty', 'measure_of_the_heart', 'relationship_impermanence', 'human_aggregation', 'entropy'])
    );
    expect(extraction.summaryText).toContain('思考方式');
  });

  it('keeps explicit user questions when they carry the core inquiry', async () => {
    const extraction = await extractSummaryFromConversation(
      [
        { role: 'user', text: '如果聚合最后一定会走向分散，那个体关系在里面到底还能留下什么？' },
        { role: 'user', text: '什么才算真实信任？' },
      ],
      { language: 'zh' }
    );

    expect(extraction.coreQuestions.length).toBeGreaterThan(0);
    expect(extraction.coreQuestions.join(' ')).toMatch(/信任|trust|聚合|分散/);
  });
});
