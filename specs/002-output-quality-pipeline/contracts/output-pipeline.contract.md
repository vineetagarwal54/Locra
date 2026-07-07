# Contract: Output Quality Pipeline

## First Image Turn

1. Acquire the existing single-flight inference queue before preprocessing.
2. Normalize/preserve the image and enforce the final 512x512 ceiling before model input.
3. Run hidden visual evidence gathering for the image.
4. Generate the visible answer from the original user question plus hidden evidence.
5. Produce a complete production-owned objective inference result record containing answer text, model id, generation config id, pipeline variant id, perception latency, answer TTFT, answer-generation latency, total end-to-end latency, generated token count, prompt token count when available, looping status, truncation status, timestamp, and device/build metadata.
6. Persist the visible answer and hidden evidence separately.
7. Do not show raw structured extraction unless the user explicitly asked for extraction/list-style output.

## Active Live Follow-Up

1. Confirm the managed engine context is valid for the active conversation.
2. Send only the new user follow-up message through `sendMessage`.
3. Do not embed the entire prior transcript into the prompt.
4. Persist the completed follow-up once.

## Resumed Conversation Follow-Up

1. Load persisted hidden visual evidence and recent turns.
2. If live engine history is unavailable, send one reconstruction prompt containing required visual evidence and recent context.
3. Mark the session as reconstructed for the current engine lifetime.
4. Later follow-ups must not repeatedly embed the full transcript.
5. Missing/corrupt persisted context must degrade gracefully.

## Objective Result Consumption

1. Production inference exposes the completed objective result record through a neutral production-owned DTO.
2. Evaluation code may consume that DTO only after the result is complete.
3. Production inference must not import evaluation modules to create or expose the DTO.

## Image Preservation

1. Orientation normalization is allowed.
2. Aspect-ratio-only center cropping is not allowed for tall/wide, screenshot-like, receipt-like, document-like, code-like, or chat-like images.
3. Cropping is allowed only when an explicit subject region is available.
4. The hard 512x512 model-input ceiling remains mandatory.

## New Image Conversation

1. Clear managed conversation history before the new image thread starts.
2. Clear pinned visual evidence.
3. Clear active session context.
4. The new image conversation must not inherit evidence from the previous image.
