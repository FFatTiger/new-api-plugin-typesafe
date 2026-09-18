---
changelogVersion: 1
plugin: "typesafe"
version: "1.1.1"
locale: "en"
---
# Changelog

## [1.1.1]

### Fixed

- Vercel AI Gateway requests now send the required gateway headers `ai-gateway-protocol-version: 0.0.1` and `ai-gateway-auth-method: api-key`; without them the gateway rejected every evaluation with `Unsupported gateway protocol version`.
- Gateway-reported per-question confidence (`providerMetadata.typesafe.confidence`) is merged back onto `choice` and `score` answers as the native `confidence` field. No pricing or configuration impact; existing channels need no changes.
