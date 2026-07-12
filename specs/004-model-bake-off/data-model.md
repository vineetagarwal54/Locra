# Data Model: Runtime Model Choice

## ModelCandidate

Static descriptor containing stable ID, developer selector, native model constant,
friendly name/description, generation configuration ID, integrity config endpoint,
expected hash, and expected byte size. Exactly two descriptors exist.

## ModelSelection

- `selectedModelId`: effective persisted or developer-overridden candidate ID
- `developerOverrideId`: optional build/development override
- `pendingModelId`: target waiting for the current host to unmount
- `bootstrapped`: whether MMKV/environment selection has been resolved

The persisted key is stored in the existing Locra MMKV instance. No second store exists.

## Selected Lifecycle

One `ModelDownloadManager` instance scoped to the effective descriptor. Its sources,
expected `.pte` filename, integrity configuration, and size are never shared across
candidates. Reinitialization resets only in-memory lifecycle state and does not delete
either model's files.
