import { LOCRA_SYSTEM_PROMPT } from '../../../src/inference/SystemPrompt';

describe('SystemPrompt', () => {
  it('uses a short positive-first offline assistant prompt', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/helpful offline assistant/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/most useful answer/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/knowledge, reasoning, conversation context/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/available image evidence/i);
  });

  it('requires direct best-effort answers and practical how-to guidance', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/knowledge, reasoning, coding, math/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/answer directly/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/reasonable best effort/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/practical steps/i);
  });

  it('handles image uncertainty and live information without becoming unhelpful', () => {
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/visual evidence is incomplete/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/uncertain/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/useful general guidance/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/live or changing information/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/current value cannot be confirmed/i);
    expect(LOCRA_SYSTEM_PROMPT).toMatch(/explain how the user can verify/i);
  });

  it('drops the older personality-heavy companion framing', () => {
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/endlessly resourceful companion/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/trusted friend/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/speak freely/i);
    expect(LOCRA_SYSTEM_PROMPT).not.toMatch(/match their energy/i);
  });
});
