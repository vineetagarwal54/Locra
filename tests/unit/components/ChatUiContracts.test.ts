import { readFileSync } from 'fs';
import { join } from 'path';

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

describe('chat UI contracts', () => {
  it('has no composer control or sheet for selecting another conversation', () => {
    const composer = source('src/components/chat/ChatComposer.tsx');
    const screen = source('src/screens/ChatScreen.tsx');

    expect(composer).not.toMatch(/past conversation|targetCandidates|selectedTarget|targetPicker/i);
    expect(screen).not.toMatch(/listConversationTargets|selectedTarget|targetCandidates/i);
  });

  it('submits only text and the optional current-turn image', () => {
    const composer = source('src/components/chat/ChatComposer.tsx');
    const storeInterface = source('src/types/interfaces.ts');

    expect(composer).not.toMatch(/conversationTargetId|targetNotice/);
    expect(storeInterface).not.toMatch(/conversationTargetId|targetNotice/);
  });

  it('positions an opened conversation from layout callbacks without restoring a pixel offset', () => {
    const screen = source('src/screens/ChatScreen.tsx');

    expect(screen).toMatch(/pendingInitialPositionRef/);
    expect(screen).toMatch(/onLayout={applyPendingListPosition}/);
    expect(screen).toMatch(/scrollToEnd\(\{ animated: false \}\)/);
    expect(screen).not.toMatch(/scrollToOffset|restoredScrollOffset|requestAnimationFrame/);
  });
});
