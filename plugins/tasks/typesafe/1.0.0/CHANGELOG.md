---
changelogVersion: 1
plugin: "typesafe"
version: "1.0.0"
locale: "en"
---
# Changelog

## [1.0.0]

### Added

- Initial release: TypeSafe AI System One evaluation task plugin serving the native `POST /v1/systemone` route with synchronous immediate completion (no task polling).
- Declares models `jev-latest`, `jev-preview`, `jev-1.13.0` and `jev`, so channels can serve client aliases and pin versions through Model Mapping.
- Forwards `state` (string, object, or array) and `questions` losslessly, preserving explicit `0`, `false`, `null`, and `""` values; only `model`, `state`, and `questions` are sent upstream.
- Validates all three question primitives (`noul`, `choice`, `score`) with user-readable 400 errors, including instructions/criteria shape checks.
- Token-based usage schema (`input_tokens`, `output_tokens`, unit `token`) with completion-time settlement from the upstream `usage` object; submit-time facts are reported as zero and the measured usage is overlaid before settlement. No prices are hardcoded.
- Default channel Base URL `https://api.typesafe.ai`; any System One-compatible server can be configured per channel.
- Presents the upstream response (`model`, `answers`, `usage`) verbatim to the client and never wraps it in chat-completion shapes.
