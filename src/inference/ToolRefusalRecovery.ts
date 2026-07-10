import type { ModelRequestMessage } from './ContextBuilder';

export const TOOL_REFUSAL_RECOVERY_INSTRUCTION =
  "The previous answer was unnecessarily unhelpful. Answer the user's actual question now using your knowledge, reasoning, and conversation context. Give practical guidance directly. If something is uncertain, state the uncertainty briefly and continue with the most useful answer you can provide.";

const FALSE_TOOL_REFUSAL_PATTERNS: ReadonlyArray<RegExp> = [
  /\bi\s+(?:lack|do not have|don't have)(?:\s+access\s+to)?\s+(?:(?:the|a|an|any)\s+)?(?:(?:required|necessary|needed|appropriate|external|specific)\s+)?(?:tools?|calculator|search engine|web browser|browser|web|internet|api|capabilit(?:y|ies))\b/i,
  /\b(?:i\s+(?:cannot|can't|am unable to)|i'm\s+unable\s+to)\s+(?:access|use)\s+(?:(?:the|a|an|any)\s+)?(?:(?:required|necessary|needed|appropriate|external|specific)\s+)?(?:tools?|calculator|search engine|web browser|browser|web|internet|api|capabilit(?:y|ies))\b/i,
  /\bi\s+(?:would\s+)?need(?:\s+access\s+to)?\s+(?:(?:the|a|an|any)\s+)?(?:(?:required|necessary|needed|specific|external)\s+)?(?:tools?|calculator|search engine|web browser|browser|web|internet|api|capabilit(?:y|ies))\b.{0,80}\b(?:answer|solve|calculate|determine|help)\b/i,
  /\bwithout\s+(?:access\s+to\s+)?(?:(?:the|a|an|any)\s+)?(?:tools?|calculator|search engine|web browser|browser|web|internet|api)\b.{0,80}\b(?:cannot|can't|unable to)\b.{0,60}\b(?:answer|solve|calculate|determine|help)\b/i,
  /\b(?:cannot|can't|unable to)\s+(?:answer|solve|calculate|determine|help)\b.{0,80}\b(?:without|because)\b.{0,80}\b(?:tools?|calculator|search engine|web browser|browser|web|internet|api)\b/i,
  /\b(?:this|that|the question|the task)\s+(?:requires|would require)\s+(?:(?:the|a|an)\s+)?(?:tools?|calculator|search engine|web browser|browser|web|internet|api)\b/i,
];

const EXPLICIT_EXTERNAL_ACTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:can|could|would|will)\s+you\b.{0,80}\b(?:browse|search\s+(?:the\s+)?(?:web|internet)|look\s+up|open|access|download|upload|control|operate|launch|turn\s+(?:on|off)|call|text|message|email)\b/i,
  /\bdo\s+you\s+(?:have|support|use)\b.{0,60}\b(?:web|internet|browser|external tools?|apis?|device control|file access)\b/i,
  /^\s*(?:please\s+)?(?:browse|search\s+the\s+(?:web|internet)|look\s+up\s+online|open|access|download|upload|control|operate|launch|turn\s+(?:on|off)|call|text|message|email)\b/i,
];

const LIVE_INFORMATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:live|latest|current|real[- ]time|right now|today(?:'s)?|up[- ]to[- ]date)\b.{0,60}\b(?:weather|forecast|news|score|traffic|stock price|share price|exchange rate|flight status|election results?)\b/i,
  /\b(?:weather|forecast|news|score|traffic|stock price|share price|exchange rate|flight status|election results?)\b.{0,60}\b(?:live|latest|current|real[- ]time|right now|today(?:'s)?|up[- ]to[- ]date)\b/i,
  /\b(?:what(?:'s| is)|check|give me|tell me)\b.{0,40}\bthe\s+(?:weather|forecast|score|traffic|stock price|share price|exchange rate|flight status)\b/i,
];

const HOW_TO_ADVICE_PATTERN =
  /\b(?:how\s+(?:do|can|should)\s+i|explain\s+how\s+to|tell\s+me\s+how\s+to|show\s+me\s+how\s+to|steps\s+to)\b/i;

export function shouldRetryToolRefusal(response: string, userQuestion: string): boolean {
  const normalizedResponse = response.replace(/\u2019/g, "'");
  if (!FALSE_TOOL_REFUSAL_PATTERNS.some((pattern) => pattern.test(normalizedResponse))) {
    return false;
  }
  return !isGenuineUnavailableCapabilityRequest(userQuestion);
}

export function buildToolRefusalRecoveryMessages(
  messages: ModelRequestMessage[],
): ModelRequestMessage[] {
  const systemIndex = messages.findIndex((message) => message.role === 'system');
  if (systemIndex < 0) {
    return [
      { role: 'system', content: TOOL_REFUSAL_RECOVERY_INSTRUCTION },
      ...messages,
    ];
  }

  return messages.map((message, index) =>
    index === systemIndex
      ? {
          ...message,
          content: `${message.content}\n\n${TOOL_REFUSAL_RECOVERY_INSTRUCTION}`,
        }
      : message,
  );
}

function isGenuineUnavailableCapabilityRequest(question: string): boolean {
  if (HOW_TO_ADVICE_PATTERN.test(question)) {
    return false;
  }
  return (
    EXPLICIT_EXTERNAL_ACTION_PATTERNS.some((pattern) => pattern.test(question)) ||
    LIVE_INFORMATION_PATTERNS.some((pattern) => pattern.test(question))
  );
}
