# Research: Runtime Model Choice

- React Native ExecuTorch 0.9.2 exposes both required multimodal constants. No dependency upgrade is needed.
- MMKV synchronous reads are suitable for bootstrap and preserve the project's single-store rule.
- ExecuTorch resource filenames differ between LFM and Gemma, enabling deterministic lifecycle isolation.
- The existing `useLLM` host can accept a runtime descriptor prop; keying it by selected ID guarantees replacement rather than coexistence.
- A pending-selection state provides a React commit in which the old host is absent before MMKV selection changes.
