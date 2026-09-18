---
changelogVersion: 1
plugin: "typesafe"
version: "1.1.0"
locale: "en"
---
# Changelog

## [1.1.0]

### Added

- Vercel AI Gateway support: channels whose Base URL host is `ai-gateway.vercel.sh` (or whose path ends with `/v4/ai`) now call the gateway evaluation endpoint `POST {baseUrl}/v4/ai/evaluation-model` instead of the native `/v1/systemone`, using the AI SDK evaluation wire contract (`ai-model-id` header, `ai-evaluation-model-specification-version: 4`).
- Automatic protocol translation both ways while the client keeps speaking native System One: question `noul` becomes gateway `boolean`, gateway answer `boolean.probability` becomes `noul.noul`, and `usage.inputTokens/outputTokens` become `input_tokens/output_tokens`; `choice` and `score` pass through unchanged. Gateway-only response fields (`warnings`, `rounding`, `providerMetadata`) are not exposed to clients.
- No price reconfiguration is required for existing native channels: their requests, responses, and billing facts are unchanged. New gateway channels should map model names to the gateway spelling via Model Mapping (for example `jev-latest -> typesafe-ai/jev`) and can price input tokens with `tier("base", u("input_tokens") * 0.04 / 1000000)` for the gateway's listed rate; no other settings change.
