import { copyText, shareText, type MessageActionDependencies } from '../../../src/components/chat/MessageActions';

describe('message actions', () => {
  it('copies the exact visible message or code text', async () => {
    const deps: MessageActionDependencies = {
      setClipboardText: jest.fn(async () => undefined),
      share: jest.fn(async () => undefined),
    };

    await copyText('const value = 1;', deps);

    expect(deps.setClipboardText).toHaveBeenCalledWith('const value = 1;');
    expect(deps.share).not.toHaveBeenCalled();
  });

  it('shares through the platform share sheet without changing content', async () => {
    const deps: MessageActionDependencies = {
      setClipboardText: jest.fn(async () => undefined),
      share: jest.fn(async () => undefined),
    };

    await shareText('Visible answer', deps);

    expect(deps.share).toHaveBeenCalledWith('Visible answer');
    expect(deps.setClipboardText).not.toHaveBeenCalled();
  });
});
