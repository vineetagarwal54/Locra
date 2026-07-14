# Hybrid context manual scoring rubric

Score each quality dimension from 0 to 2. Record measurements rather than scoring exact
model wording.

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Factual continuity | Required fact missing or wrong | Partially correct or hedged | Required fact correct |
| Context precision | Unrelated context materially affects answer | Minor irrelevant detail | Only relevant context used |
| Image evidence | Wrong image/evidence or unsafe substitution | Correct source with uncertainty | Correct persisted evidence and lifecycle behavior |
| Retry integrity | Prior attempt overwritten or leaks into context | Prior attempt preserved with presentation issue | New attempt created; canonical context uses only active completion |
| Responsiveness | Interaction becomes unusable | Noticeable delay but usable | Meets recorded target for device/profile |
| Memory stability | Crash/OOM or unbounded growth | Recovers after material pressure | Stable bounded usage throughout case |

For every run record: device model, RAM class, response mode, model artifact version,
first-token latency, total latency, peak resident memory, result state, and notes. Run the
same case twice when checking deterministic context selection.

