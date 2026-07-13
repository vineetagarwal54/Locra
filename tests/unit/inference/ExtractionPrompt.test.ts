import {
  buildExtractionRetryPrompt,
  buildStructuredExtractionPrompt,
} from '../../../src/inference/ExtractionPrompt';

describe('structured extraction prompt', () => {
  it('asks for labeled visible findings needed for pinned image context', () => {
    const prompt = buildStructuredExtractionPrompt('What is on the table?');

    expect(prompt).toContain('What is on the table?');
    expect(prompt).toMatch(/subject\/object/i);
    expect(prompt).toMatch(/visible features/i);
    expect(prompt).toMatch(/visible text/i);
    expect(prompt).toMatch(/visible condition/i);
    expect(prompt).toMatch(/json/i);
  });

  it('builds a corrective retry prompt from the same extraction contract', () => {
    const prompt = buildExtractionRetryPrompt('not json', 'What is on the table?');

    expect(prompt).toContain('not json');
    expect(prompt).toContain('What is on the table?');
    expect(prompt).toMatch(/valid json/i);
    expect(prompt).toMatch(/subject\/object/i);
  });
});
