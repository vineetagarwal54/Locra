# Quality Evaluation Rubric

Use the same rubric for baseline and candidate runs.

## Pass/Fail Fields

- `directAnswer`: pass when the answer addresses the user's actual question instead of only describing the image.
- `coreCorrectness`: pass when the central answer is correct for the visible evidence and reasonable general knowledge.
- `hallucination`: yes when the answer includes unsupported image-specific claims.
- `looping`: yes when the answer repeats the same content enough to reduce usefulness.
- `truncated`: yes when the answer is cut off before it becomes usable.

## Usefulness 1-5

1. Not useful: misses the question, fabricates important details, or cannot guide action.
2. Weak: partly related but vague, incomplete, or hard to act on.
3. Adequate: answers the question with some useful detail but has gaps or minor uncertainty handling problems.
4. Good: directly answers, stays grounded, gives useful detail or steps, and avoids unsupported visual claims.
5. Excellent: concise, grounded, actionable, and clearly separates visible facts from general knowledge where needed.

## Notes

Use `notes` for brief evaluator comments. Keep notes focused on quality, grounding, repetition, truncation, and usefulness.
