import { LOCRA_SYSTEM_PROMPT } from '../../../src/inference/SystemPrompt';

describe('SystemPrompt', () => {
  it('prioritizes direct answers, visible grounding, general knowledge, uncertainty, and action', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/answer the user's actual question/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/visible evidence/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/general knowledge/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/concise/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/uncertaint/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/actionable/i);
  });

  it('drops the older personality-heavy companion framing', () => {
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/endlessly resourceful companion/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/trusted friend/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/speak freely/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/match their energy/i);
  });
});
