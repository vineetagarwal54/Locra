# Evaluation Helpers

This directory contains developer/tester-only helpers for Feature 002 quality evaluation.

Production screens, navigation, normal history, and production inference behavior must not depend on this module. Production inference may expose production-owned result DTOs; evaluation helpers may consume those DTOs for local JSONL artifacts.

Removing this directory must not break the Locra app.
