import { readFileSync } from 'fs';
import { join } from 'path';

const LFM_MODEL = { modelName: 'lfm2.5-vl-1.6b-quantized' };
const GEMMA_MODEL = { modelName: 'gemma4-e2b-multimodal' };

describe('useInferenceEngine', () => {
  it('passes the default LFM model constant to useLLM', () => {
    const useLLM = callUseInferenceEngineWithActiveModel(LFM_MODEL);

    expect(useLLM).toHaveBeenCalledWith({ model: LFM_MODEL });
  });

  it('passes the resolved Gemma model constant to useLLM', () => {
    const useLLM = callUseInferenceEngineWithActiveModel(GEMMA_MODEL);

    expect(useLLM).toHaveBeenCalledWith({ model: GEMMA_MODEL });
  });

  it('does not pass custom runtime sampling overrides or chat history config', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8',
    );

    expect(source).not.toContain('configure({');
    expect(source).not.toContain('chatConfig');
    expect(source).not.toMatch(/generationConfig\s*:/);
    expect(source).not.toContain('LOCRA_GENERATION_CONFIG');
  });

  it('uses stateless generate and clears managed history defensively', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/inference/useInferenceEngine.ts'),
      'utf8',
    );

    expect(source).toContain('generate(messages');
    expect(source).toContain('deleteMessage(0)');
    expect(source).not.toMatch(/sendMessage\(/);
  });
});

function callUseInferenceEngineWithActiveModel(modelConstant: { modelName: string }): jest.Mock {
  const useLLM = jest.fn(() => createLLMStub());
  jest.resetModules();
  jest.doMock('react', () => ({
    useEffect(effect: () => void): void {
      effect();
    },
    useRef<T>(value: T): { current: T } {
      return { current: value };
    },
  }));
  jest.doMock('react-native-executorch', () => ({
    LFM2_5_VL_1_6B_QUANTIZED: LFM_MODEL,
    useLLM,
  }));
  jest.doMock('../../../src/model/ActiveModel', () => ({
    activeModel: { modelConstant },
  }));

  const { useInferenceEngine } = require('../../../src/inference/useInferenceEngine') as typeof import('../../../src/inference/useInferenceEngine');
  useInferenceEngine();
  return useLLM;
}

function createLLMStub() {
  return {
    deleteMessage: jest.fn(),
    error: null,
    generate: jest.fn(),
    getGeneratedTokenCount: jest.fn(() => 0),
    getPromptTokenCount: jest.fn(() => 0),
    getTotalTokenCount: jest.fn(() => 0),
    interrupt: jest.fn(),
    isGenerating: false,
    isReady: true,
    messageHistory: [],
    response: '',
    token: '',
  };
}
