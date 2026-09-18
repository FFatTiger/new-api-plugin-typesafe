# TypeSafe AI (System One / Jev)

A NewAPI task plugin for [TypeSafe AI](https://docs.typesafe.ai) System One evaluation models, starting with **Jev**.

Jev is not a generative chat model. You send a `state` plus typed `questions`, and it answers with typed, calibrated results your code can branch on directly — no prose to parse:

```
state + typed questions → Jev → typed answers + probabilities
```

```js
if (result.answers.shouldCloseDialog.noul > 0.9) {
  closeDialog();
}
```

The plugin exposes the **native System One protocol verbatim**. It does not claim `/v1/chat/completions`, `/v1/responses`, or any other host protocol, and it never wraps answers into chat-completion shapes.

```
client → NewAPI (auth / routing / billing / logs)
       → POST {baseUrl}/v1/systemone
       ← { model, answers, usage }  (upstream response, unchanged)
```

## Install

The plugin ships with NewAPI as a built-in factory task plugin (`key: typesafe`), so a current gateway needs no separate installation. On older builds, upload `plugin.js` from this directory via **Console → Task Plugins → Upload** (or publish it through a marketplace index).

## Create a channel

1. **Console → Channels → Add Channel**
2. Type: **Task Plugin** (61), plugin: **TypeSafe AI**
3. Base URL: `https://api.typesafe.ai` (or any System One-compatible server; the plugin's default fills this in automatically when left empty)
4. API Key: your TypeSafe API key (from `console.typesafe.ai`)
5. Models: `jev-latest` (add `jev-preview`, `jev-1.13.0`, or `jev` as needed — all four are declared by the plugin)

Self-hosted / Open Jev compatible servers work by pointing Base URL at your server. Requests are only ever sent to the channel's Base URL host; the request body cannot influence the upstream host or credentials.

## Model mapping

Channel **Model Mapping** works as usual. Example: clients call `jev`, upstream receives `jev-latest`:

```json
{ "jev": "jev-latest" }
```

- The client-facing name still has to be one of the plugin's declared models (`jev-latest`, `jev-preview`, `jev-1.13.0`, `jev`), so add it to the channel's model list too.
- Future Jev releases need no plugin change: map an existing name to the new version (for example `jev-latest -> jev-2.0.0`) or pin a versioned ID.
- Logs record both identities: client model (`jev`) and `upstream_model_name` (`jev-latest`).

## Pricing

Billing is token-based via the plugin usage schema (`input_tokens`, `output_tokens`, unit `token`). Configure it per model under tiered/usage pricing, e.g. the published jev-latest rate ($42 per 1M input tokens, output free):

```
tier("base", u("input_tokens") * 42 / 1000000)
```

- Submit-time facts are reported as `0` (tokens are unknown before the call); the upstream `usage` object settles the real amount through immediate completion — before the response is returned.
- Without an expression, the model falls back to fixed per-call pricing (`Model Price`), charging one configured price per request.
- When usage is missing upstream, the plugin reports no facts rather than inventing token counts (the call then settles at the expression's zero-fact cost).
- Client aliases resolve pricing through the mapped target: price `jev-latest` and map `jev -> jev-latest`, or save a provider override `typesafe::jev`.

## Call it

```bash
curl https://your-newapi.example.com/v1/systemone \
  -H "Authorization: Bearer sk-NEWAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jev-latest",
    "state": {
      "page": "checkout",
      "hasDialog": true,
      "dialogText": "Are you sure you want to leave?"
    },
    "questions": {
      "shouldCloseDialog": {
        "type": "noul",
        "instructions": "Should the current dialog be closed before proceeding?"
      },
      "nextAction": {
        "type": "choice",
        "instructions": "What should the agent do next?",
        "criteria": {
          "retry": "Retry the payment",
          "stop": "Abort the checkout",
          "ask": "Ask the user"
        }
      },
      "risk": {
        "type": "score",
        "instructions": "How risky is continuing automatically?",
        "criteria": ["low", "medium", "high"]
      }
    }
  }'
```

Response (TypeSafe native shape, unchanged):

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "shouldCloseDialog": { "type": "noul", "noul": 0.94 },
    "nextAction": {
      "type": "choice",
      "choice": "retry",
      "probabilities": { "retry": 0.88, "stop": 0.05, "ask": 0.07 },
      "confidence": 0.86
    },
    "risk": {
      "type": "score",
      "score": 1.2,
      "legend": { "0": "low", "1": "medium", "2": "high" },
      "probabilities": { "0": 0.55, "1": 0.35, "2": 0.1 },
      "confidence": 0.8
    }
  },
  "usage": { "input_tokens": 312, "output_tokens": 48 }
}
```

JavaScript:

```js
const response = await fetch("https://your-newapi.example.com/v1/systemone", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${NEWAPI_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "jev-latest",
    state: { page: "login", hasDialog: true },
    questions: {
      shouldCloseDialog: {
        type: "noul",
        instructions: "Should the current dialog be closed?",
      },
    },
  }),
});

const result = await response.json();

if (result.answers.shouldCloseDialog.noul > 0.9) {
  // close dialog
}

switch (result.answers.nextAction?.choice) {
  case "retry": retry(); break;
  case "stop": stop(); break;
}
```

The call is synchronous: one request, one response — no task id, no polling.

## Protocol notes

- `state` accepts string, object, or array and is forwarded losslessly; explicit `0`, `false`, `null`, and `""` values survive everywhere (in `state`, `instructions`, and `criteria`).
- All three primitives (`choice`, `score`, `noul`) are validated with user-readable errors (`unsupported question type "..." (expected noul, choice, or score)`, `score criteria: an array of at least two ordered levels`, …) and returned as `400`.
- Only `model`, `state`, and `questions` are forwarded upstream; any other client field is dropped.
- The response's `model` is the upstream-reported resolved version (for example `jev-1.13.0` when you called `jev-latest`).

## Errors

| Situation | Behavior |
| --- | --- |
| Missing/invalid NewAPI token | `401` from the gateway before any upstream call |
| Malformed questions/state | `400` with the plugin's validation message |
| Upstream `401/422/429/5xx` | Same status code, upstream error body surfaced; never billed, no task/log rows |
| Non-JSON or answer-less upstream `200` | `502 plugin_submit_response_failed` |
| Rate limiting / retries | Host-managed channel retry only; the plugin never re-calls upstream (evaluation is billed per call) |

The upstream API key never appears in responses, logs, or error messages.

## Limitations

- The `/v1/systemone` route is exclusive to this plugin and registered only when the plugin is enabled.
- The client-facing model name must be one of the plugin's declared models (`jev-latest`, `jev-preview`, `jev-1.13.0`, `jev`); serve brand-new upstream names through Model Mapping until the plugin declares them.
- Host quirk: the gateway pre-validates request fields whose names collide with the plugin usage schema. A `state` object that contains a non-numeric string under a key named `input_tokens` / `output_tokens` is rejected with 400 before the plugin runs (the same applies to other token-billing plugins such as doubao).
- Vercel AI SDK `experimental_evaluate` compatibility is **not** provided; Evaluation models are a separate client-side provider concern (a possible future `@ai-sdk` provider package pointing at this endpoint).
- Upstream usage fields other than `input_tokens`/`output_tokens` are not metered; extend the usage schema if TypeSafe adds billable units.
