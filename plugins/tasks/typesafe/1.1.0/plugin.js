// TypeSafe AI System One evaluation plugin (Jev).
//
// Jev is a synchronous evaluation model: the client sends `state` plus typed
// `questions` and receives typed `answers` with probabilities in one round
// trip. The native route mirrors the upstream protocol verbatim so callers
// only swap the host and API key:
//
//   POST /v1/systemone  {model, state, questions}  ->  {model, answers, usage}
//
// Upstream docs: https://docs.typesafe.ai (POST /v1/systemone). The three
// question primitives are noul (probability of yes), choice (one option plus
// the full probability distribution) and score (probability-weighted level).
//
// Two upstream flavors are served, selected automatically from the channel
// Base URL:
//
//   - TypeSafe native:  {baseUrl}/v1/systemone, model in the body.
//   - Vercel AI Gateway: {baseUrl}/v4/ai/evaluation-model with the model in
//     the `ai-model-id` header (AI SDK evaluation contract, spec version 4).
//     The gateway speaks `boolean` where System One speaks `noul` and reports
//     usage as inputTokens/outputTokens; the plugin translates both ways so
//     the client still sends and receives the native System One shape. Map
//     model names to the gateway spelling (for example jev -> typesafe-ai/jev)
//     through channel Model Mapping.
//
// Billing is token-based. Submit-time facts are reported as zero because the
// request has not been evaluated yet; the upstream `usage` object settles the
// actual cost via extractUsageOnComplete. Price with a task expression such
// as `tier("base", u("input_tokens") * 42 / 1000000)` ($/1M input tokens).
export const meta = {
  apiVersion: 1,
  key: "typesafe",
  name: "TypeSafe AI",
  description: {
    en: "TypeSafe System One evaluation (Jev): typed questions about a state, answered with probabilities",
    zh: "TypeSafe System One 评估（Jev）：对 state 提出类型化问题，返回带概率的结构化答案",
  },
  version: "1.1.0",
  author: { name: "QuantumNous" },
  baseUrl: "https://api.typesafe.ai",
  models: ["jev-latest", "jev-preview", "jev-1.13.0", "jev"],
  fetchMode: "per_task",
  routes: [
    { method: "POST", path: "/v1/systemone", type: "submit", decode: "evaluate", render: "evaluated" },
  ],
  usageSchema: {
    // Upstream input tokens (usage.input_tokens), reported on completion.
    input_tokens: {
      type: "number",
      unit: "token",
      description: { en: "Input token unit price", zh: "输入 Token 单价" },
    },
    // Upstream output tokens (usage.output_tokens), reported on completion.
    output_tokens: {
      type: "number",
      unit: "token",
      description: { en: "Output token unit price", zh: "输出 Token 单价" },
    },
  },
  usageExamples: [
    { label: "jev · 312 in / 48 out", facts: { input_tokens: 312, output_tokens: 48 } },
    { label: "jev · 8k in / 96 out", facts: { input_tokens: 8192, output_tokens: 96 } },
  ],
};

function trimmed(value) {
  return String(value || "").trim();
}

// TypeSafe accepts JSON structure (string, object or array) for state,
// instructions, criteria and score levels. `null`, booleans and numbers are
// not valid at those positions.
function isStructuredText(value) {
  if (value === null || value === undefined) return false;
  return typeof value === "string" || typeof value === "object";
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

// The Vercel AI Gateway evaluation endpoint (AI SDK contract): a bare
// ai-gateway.vercel.sh base URL (or any base ending in /v4/ai) selects the
// gateway flavor and resolves to its evaluation-model URL. Anything else is
// native System One.
function vercelEvaluationUrl(baseUrl) {
  const raw = String(baseUrl || "").replace(/\/+$/, "");
  if (!raw) return null;
  let hostWithPort = raw;
  let path = "";
  const schemeCut = raw.indexOf("://");
  if (schemeCut >= 0) hostWithPort = raw.slice(schemeCut + 3);
  const slash = hostWithPort.indexOf("/");
  if (slash >= 0) {
    path = hostWithPort.slice(slash);
    hostWithPort = hostWithPort.slice(0, slash);
  }
  const host = hostWithPort.split("@").pop().split(":")[0].toLowerCase();
  const lowered = path.toLowerCase();
  if (host !== "ai-gateway.vercel.sh" && lowered !== "/v4/ai" && !lowered.endsWith("/v4/ai")) return null;
  return (path ? raw : raw + "/v4/ai") + "/evaluation-model";
}

// System One `noul` is the gateway's `boolean`; the rest of the question
// shape (instructions, criteria) is identical.
function vercelQuestion(question) {
  if (question.type === "noul") return Object.assign({}, question, { type: "boolean" });
  return question;
}

// Translates a gateway answer back to the System One shape the client speaks.
function nativeAnswer(answer) {
  if (isPlainObject(answer) && answer.type === "boolean" && typeof answer.probability === "number")
    return { type: "noul", noul: answer.probability };
  return answer;
}

// Validates one question in place (the request is forwarded verbatim, so
// validation only rejects; it never rewrites values). Explicit zero, false,
// null and "" inside state/instructions/criteria survive untouched.
function validateQuestion(name, question) {
  const where = 'question "' + name + '"';
  if (!isPlainObject(question)) throw new Error(where + " must be an object");
  const type = question.type;
  if (!has(question, "instructions") || !isStructuredText(question.instructions))
    throw new Error(where + " is missing string or structured instructions");
  if (type === "noul") {
    if (has(question, "criteria") && !isPlainObject(question.criteria))
      throw new Error(where + " criteria must be an object with optional true/false descriptions");
    return;
  }
  if (type === "choice") {
    const criteria = question.criteria;
    if (!isPlainObject(criteria) || Object.keys(criteria).length === 0)
      throw new Error(where + " requires choice criteria: an object mapping each option to a description or null");
    return;
  }
  if (type === "score") {
    const criteria = question.criteria;
    if (!Array.isArray(criteria) || criteria.length < 2)
      throw new Error(where + " requires score criteria: an array of at least two ordered levels");
    for (let index = 0; index < criteria.length; index++) {
      if (!isStructuredText(criteria[index]))
        throw new Error(where + " score level " + index + " must be a string or structured value");
    }
    return;
  }
  throw new Error(where + ' has unsupported type "' + trimmed(type) + '" (expected noul, choice, or score)');
}

export const native = {
  evaluate: function (ctx) {
    if (!ctx.body || ctx.body.kind !== "json") throw new Error("JSON body required");
    const body = ctx.body.value;
    if (!isPlainObject(body)) throw new Error("request body must be a JSON object");
    if (typeof body.model !== "string" || !trimmed(body.model)) throw new Error("model is required");
    const model = trimmed(body.model);
    if (!has(body, "state")) throw new Error("state is required");
    if (!isStructuredText(body.state)) throw new Error("state must be a string, object, or array");
    if (!has(body, "questions")) throw new Error("questions is required");
    const questions = body.questions;
    if (!isPlainObject(questions)) throw new Error("questions must be an object keyed by question id");
    const names = Object.keys(questions);
    if (names.length === 0) throw new Error("questions must contain at least one question");
    for (let index = 0; index < names.length; index++) validateQuestion(names[index], questions[names[index]]);
    // Forward exactly the documented request fields; state and questions are
    // passed by reference and the host deep-clones them losslessly.
    return { kind: "submit", model: model, requestBody: { model: model, state: body.state, questions: questions } };
  },
  evaluated: function (ctx, task) {
    if (task.status === "FAILURE")
      return { error: { message: task.fail_reason || "evaluation failed", type: "typesafe_error" } };
    const data = task.data;
    if (!isPlainObject(data)) throw new Error("evaluation result is unavailable");
    return data;
  },
  error: function (ctx, error) {
    return { error: { message: error.message, type: "typesafe_error", code: error.code } };
  },
};

export function buildSubmitRequest(ctx) {
  const request = isPlainObject(ctx.requestBody) ? ctx.requestBody : {};
  const model = trimmed(ctx.upstreamModel || ctx.model || request.model);
  const vercelUrl = vercelEvaluationUrl(ctx.baseUrl);
  if (vercelUrl) {
    const questions = {};
    const source = isPlainObject(request.questions) ? request.questions : {};
    for (const key of Object.keys(source)) questions[key] = vercelQuestion(source[key]);
    return {
      url: vercelUrl,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer " + ctx.apiKey,
        "ai-evaluation-model-specification-version": "4",
        "ai-model-id": model,
      },
      body: { state: request.state, questions: questions },
    };
  }
  return {
    url: ctx.baseUrl + "/v1/systemone",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + ctx.apiKey,
    },
    body: {
      model: model,
      state: request.state,
      questions: request.questions,
    },
  };
}

export function parseSubmitResponse(ctx, resp) {
  const body = resp.body;
  if (!isPlainObject(body)) throw new Error("invalid TypeSafe response: expected a JSON object");
  if (!isPlainObject(body.answers)) throw new Error("invalid TypeSafe response: missing answers object");
  if (resp.statusCode >= 400) throw new Error("TypeSafe evaluation failed with status " + resp.statusCode);
  // System One is synchronous: a 200 with answers is a complete result, so
  // the submission completes immediately and is never polled. taskData keeps
  // the response in the native System One shape for the presenter; gateway
  // answers and usage are translated on the way in.
  if (vercelEvaluationUrl(ctx.baseUrl)) {
    const answers = {};
    for (const key of Object.keys(body.answers)) answers[key] = nativeAnswer(body.answers[key]);
    const taskData = { model: trimmed(ctx.upstreamModel || ctx.model), answers: answers };
    if (isPlainObject(body.usage)) {
      const usage = {};
      if (typeof body.usage.inputTokens === "number") usage.input_tokens = body.usage.inputTokens;
      if (typeof body.usage.outputTokens === "number") usage.output_tokens = body.usage.outputTokens;
      if (Object.keys(usage).length > 0) taskData.usage = usage;
    }
    return {
      taskId: utils.uuid(),
      taskData: taskData,
      immediate: { status: "SUCCESS", progress: "100%" },
    };
  }
  return {
    taskId: utils.uuid(),
    taskData: body,
    immediate: { status: "SUCCESS", progress: "100%" },
  };
}

export function extractUsage(ctx) {
  // Token counts are unknown before the upstream call; completion overlays
  // the measured usage. Legacy per-call pricing needs no ratio multipliers.
  if (ctx.usagePurpose === "billing_ratios") return null;
  return { input_tokens: 0, output_tokens: 0 };
}

export function extractUsageOnComplete(task, taskResult, body) {
  if (!taskResult || taskResult.status !== "SUCCESS") return {};
  const usage = isPlainObject(body) && isPlainObject(body.usage) ? body.usage : {};
  const facts = {};
  const input = Number(usage.input_tokens);
  const output = Number(usage.output_tokens);
  if (Number.isFinite(input) && input >= 0) facts.input_tokens = input;
  if (Number.isFinite(output) && output >= 0) facts.output_tokens = output;
  return facts;
}

// A synchronous evaluation has nothing to poll; the required v1 hooks reject
// instead of guessing so any unexpected poll surfaces loudly.
export function buildQueryRequest() {
  throw new Error("System One evaluations complete synchronously and are never polled");
}

export function parseTaskResult() {
  return { status: "UNKNOWN", reason: "System One evaluations complete synchronously" };
}
