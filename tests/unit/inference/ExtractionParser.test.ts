import {
  formatExtractionAnswer,
  parseExtractionResponse,
  parseExtractionWithRetry,
} from '../../../src/inference/ExtractionParser';

const validExtraction = JSON.stringify({
  subjectObject: 'black notebook',
  visibleObjects: ['black notebook'],
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
    expect(result.findings.visibleObjects).toEqual(['black notebook']);
    expect(result.findings.visibleFeatures).toEqual(['rectangular', 'matte cover']);
    expect(result.findings.visibleText).toEqual(['Locra']);
    expect(result.findings.visibleCondition).toBe('closed on a desk');
    expect(result.findings.uncertainty).toEqual(['background text is not legible']);
    expect(formatExtractionAnswer(result.findings)).toContain('Subject/object: black notebook');
  });

  it('parses wrapped JSON locally without a model retry', async () => {
    const retry = jest.fn(() => Promise.resolve(validExtraction));

    const result = await parseExtractionWithRetry(
      `Here are the findings:\n\`\`\`json\n${validExtraction}\n\`\`\``,
      retry,
      'What is it?',
      '/photo.jpg',
    );

    expect(retry).not.toHaveBeenCalled();
    expect(result.pinnedExtraction).toContain('Subject/object: black notebook');
    expect(result.visibleAnswer).toContain('Visible features: rectangular, matte cover');
    expect(result.hiddenEvidence?.imagePath).toBe('/photo.jpg');
    expect(result.hiddenEvidence?.sourceQuestion).toBe('What is it?');
  });

  it('does not spend another generation on opaque malformed output', async () => {
    const retry = jest.fn(() => Promise.resolve('still plain prose'));

    const result = await parseExtractionWithRetry('plain prose', retry, 'What is it?');

    expect(retry).not.toHaveBeenCalled();
    expect(result.pinnedExtraction).toMatch(/visual evidence unavailable/i);
    expect(result.visibleAnswer).toMatch(/couldn't extract reliable visual evidence/i);
    expect(result.hiddenEvidence).toBeNull();
  });

  it('deduplicates bounded object and OCR arrays without mixing their contents', () => {
    const result = parseExtractionResponse(JSON.stringify({
      subjectObject: 'produce display',
      visibleObjects: [
        'apple', 'Apple', 'banana', 'carrot', 'orange', 'pear', 'lettuce',
        'tomato', 'cucumber', 'pepper', 'onion', 'potato',
      ],
      visibleFeatures: ['stacked', 'Stacked', 'colorful'],
      visibleText: ['SALE $3.99', 'sale $3.99', 'AISLE 4'],
      visibleCondition: 'well lit',
      uncertainty: ['small labels unreadable', 'Small labels unreadable'],
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings.visibleObjects).toHaveLength(11);
    expect(result.findings.visibleObjects[0]).toBe('apple');
    expect(result.findings.visibleText).toEqual(['SALE $3.99', 'AISLE 4']);
    expect(result.findings.visibleText).not.toContain('apple');
    expect(result.findings.visibleFeatures).toEqual(['stacked', 'colorful']);
  });

  it('rejects oversized or repetitive extraction instead of truncating it', () => {
    const oversized = parseExtractionResponse(JSON.stringify({
      subjectObject: 'produce display',
      visibleObjects: [
        'apple', 'banana', 'carrot', 'orange', 'pear', 'lettuce', 'tomato',
        'cucumber', 'pepper', 'onion', 'potato', 'melon', 'extra object',
      ],
      visibleFeatures: [],
      visibleText: [],
      visibleCondition: 'well lit',
      uncertainty: [],
    }));
    const repetitive = parseExtractionResponse(JSON.stringify({
      subjectObject: 'produce display',
      visibleObjects: ['apple'],
      visibleFeatures: [
        'red', 'red', 'red', 'red', 'red', 'red', 'red', 'red',
      ],
      visibleText: [],
      visibleCondition: 'well lit',
      uncertainty: [],
    }));

    expect(oversized.ok).toBe(false);
    expect(repetitive.ok).toBe(false);
  });

  it('does not retry an unchanged strategy after deterministic repetitive output', async () => {
    const repetitive = JSON.stringify({
      subjectObject: 'produce display',
      visibleObjects: ['apple'],
      visibleFeatures: ['red', 'red', 'red', 'red', 'red', 'red', 'red', 'red'],
      visibleText: [],
      visibleCondition: 'well lit',
      uncertainty: [],
    });
    const retry = jest.fn(() => Promise.resolve(validExtraction));

    const result = await parseExtractionWithRetry(
      repetitive,
      retry,
      'What is visible?',
      '/photo.jpg',
    );

    expect(retry).not.toHaveBeenCalled();
    expect(result.hiddenEvidence).toBeNull();
  });

  it('rejects truncated JSON without attempting a formatting repair', async () => {
    const retry = jest.fn(() => Promise.resolve(validExtraction));
    const truncated = validExtraction.slice(0, -1);

    const result = await parseExtractionWithRetry(
      truncated,
      retry,
      'List the visible items.',
      '/photo.jpg',
    );

    expect(retry).not.toHaveBeenCalled();
    expect(result.hiddenEvidence).toBeNull();
  });

  it('does not treat an object label as OCR text', () => {
    const result = parseExtractionResponse(JSON.stringify({
      subjectObject: 'bedroom',
      visibleObjects: ['electrical outlet', 'mattress'],
      visibleFeatures: ['white mattress'],
      visibleText: ['outlet', 'ROOM 12'],
      visibleCondition: 'well lit',
      uncertainty: [],
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.findings.visibleObjects).toContain('electrical outlet');
    expect(result.findings.visibleText).toEqual(['ROOM 12']);
  });
});
