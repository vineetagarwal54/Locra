import {
  formatExtractionAnswer,
  parseExtractionResponse,
  parseExtractionWithRetry,
} from '../../../src/inference/ExtractionParser';

const validExtraction = JSON.stringify({
  subjectObject: 'black notebook',
  visibleFeatures: ['rectangular', 'matte cover'],
  visibleText: ['Locra'],
  visibleCondition: 'closed on a desk',
  uncertainty: ['background text is not legible'],
});

describe('extraction parser', () => {
  it('parses well-formed JSON into labeled findings', () => {
    const result = parseExtractionResponse(validExtraction);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings.subjectObject).toBe('black notebook');
    expect(result.findings.visibleFeatures).toEqual(['rectangular', 'matte cover']);
    expect(result.findings.visibleText).toEqual(['Locra']);
    expect(result.findings.visibleCondition).toBe('closed on a desk');
    expect(result.findings.uncertainty).toEqual(['background text is not legible']);
    expect(formatExtractionAnswer(result.findings)).toContain('Subject/object: black notebook');
  });

  it('retries malformed JSON exactly once with a corrective extraction prompt', async () => {
    const retry = jest.fn(() => Promise.resolve(validExtraction));

    const result = await parseExtractionWithRetry('plain prose', retry, 'What is it?', '/photo.jpg');

    expect(retry).toHaveBeenCalledTimes(1);
    const retryPrompt = retry.mock.calls.at(0)?.at(0);
    expect(retryPrompt).toMatch(/valid json/i);
    expect(result.pinnedExtraction).toContain('Subject/object: black notebook');
    expect(result.visibleAnswer).toContain('Visible features: rectangular, matte cover');
    expect(result.hiddenEvidence?.imagePath).toBe('/photo.jpg');
    expect(result.hiddenEvidence?.sourceQuestion).toBe('What is it?');
  });

  it('falls back to the raw text after a second parse failure', async () => {
    const retry = jest.fn(() => Promise.resolve('still plain prose'));

    const result = await parseExtractionWithRetry('plain prose', retry, 'What is it?');

    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.pinnedExtraction).toMatch(/visual evidence unavailable/i);
    expect(result.visibleAnswer).toMatch(/couldn't extract reliable visual evidence/i);
    expect(result.hiddenEvidence).toBeNull();
  });
});
