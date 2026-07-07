# Contract: Evaluation Case

Evaluation cases are fixed local project artifacts stored under `quality-eval/cases/`.

## Required Fields

```json
{
  "caseId": "pan-001",
  "category": "practicalAdvice",
  "title": "Worn cooking pan advice",
  "imageSource": {
    "type": "repoAsset",
    "path": "quality-eval/images/pan-001.jpg",
    "licenseOrOrigin": "project-created sample"
  },
  "question": "How do I fix this?",
  "followUps": [],
  "expectedCriteria": [
    "Answers the repair/use question directly",
    "Grounds visible claims in the pan condition",
    "Avoids unsupported certainty about coating/material"
  ],
  "tags": ["first-turn", "grounded-advice"],
  "officialDeviceRequired": true
}
```

## Rules

- `caseId` is stable once baseline results exist.
- `category` must be one of `visibleFacts`, `textReading`, `visualReasoning`, `practicalAdvice`, `activeFollowUpContext`, or `resumedConversationContext`.
- `imageSource.type` must be `repoAsset` or `manualDeviceCapture`.
- `repoAsset` cases must include a project-relative `path`.
- `manualDeviceCapture` cases must include precise `instructions`.
- The case set must include at least 18 cases and at least 3 cases per category.
- At least 80% of cases must use `repoAsset` images.
