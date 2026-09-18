# new-api-plugin-typesafe

[TypeSafe AI](https://docs.typesafe.ai) **System One / Jev** task plugin for [QuantumNous/new-api](https://github.com/QuantumNous/new-api).

Jev 是一个同步评估模型，不是聊天模型：发送 `state` + 类型化 `questions`，一次请求直接拿到带概率的类型化 `answers`，程序里可以直接 `if` / `switch`：

```
client → NewAPI（鉴权 / 渠道路由 / 模型映射 / 计费 / 日志）
       → POST {baseUrl}/v1/systemone
       ← { model, answers, usage }（TypeSafe 原生响应，原样返回）
```

插件走 **TypeSafe 原生协议**，不提供也不伪装 `/v1/chat/completions`、`/v1/responses` 兼容；同时支持两种上游（按渠道 Base URL 自动识别）：

| 上游 | Base URL | 说明 |
| --- | --- | --- |
| TypeSafe 原生 | `https://api.typesafe.ai` | 需要 TypeSafe key（console.typesafe.ai） |
| Vercel AI Gateway | `https://ai-gateway.vercel.sh` | 用你现有的 `vck_` key，见下方「Vercel 渠道」 |

两种上游下，客户端始终发送/接收 System One 原生格式，插件自动做 noul↔boolean、usage 命名等翻译。

## 安装（二选一）

### 方式 A：Marketplace 源（推荐）

1. NewAPI 控制台 → **Task Plugins（任务插件）** → Marketplace Sources → 添加：

   ```
   Name: FFatTiger Plugins
   Index URL: https://raw.githubusercontent.com/FFatTiger/new-api-plugin-typesafe/main/index.json
   ```

2. 在 Marketplace 列表找到 **TypeSafe AI** → Install。

安装时会校验 `index.json` 里的 sha256 并重新编译校验插件。

### 方式 B：手动上传

控制台 → **Task Plugins** → Upload，上传
`plugins/tasks/typesafe/1.0.0/plugin.js`（图标 `plugins/tasks/typesafe/icon.svg` 一并在上传对话框选择）。

> 注意：new-api 主仓库已内置同名 factory 插件时无需再装；本仓库用于独立安装、更新和向上游提交新版本。

## 配置渠道

1. **控制台 → 渠道 → 添加渠道**
2. 类型：**Task Plugin（61）**，插件选 **TypeSafe AI**
3. Base URL：`https://api.typesafe.ai`（留空会自动带出；可指向任何 System One 兼容服务）
4. API Key：TypeSafe 的 key（`console.typesafe.ai` 获取）
5. 模型：`jev-latest`（可加 `jev-preview`、`jev-1.13.0`、`jev`）

**模型映射**（可选）：客户端想用短名 `jev` 时，渠道模型列表加 `jev`，Model Mapping 填：

```json
{ "jev": "jev-latest" }
```

新版本 Jev 发布时改 mapping 即可（如 `jev-latest -> jev-2.0.0`），无需改插件。

## Vercel 渠道

用 Vercel AI Gateway 的 `vck_` key：

1. 类型 **Task Plugin (61)** / 插件 **TypeSafe AI**，Base URL `https://ai-gateway.vercel.sh`，Key 填 `vck_…`
2. **Model Mapping**（必须，网关要自己的模型名）：

   ```json
   { "jev-latest": "typesafe-ai/jev", "jev-preview": "typesafe-ai/jev", "jev-1.13.0": "typesafe-ai/jev", "jev": "typesafe-ai/jev" }
   ```

3. 价格：网关标价 $0.04/Mtok 输入 —— `tier("base", u("input_tokens") * 0.04 / 1000000)`

客户端调用方式完全不变（同样的 `/v1/systemone` 请求和响应）。

## 计费

Token 计费，字段为 `input_tokens` / `output_tokens`（unit: token）。给 `jev-latest` 配 usage 表达式，例如官方价 $42/Mtok 输入（输出免费）：

```
tier("base", u("input_tokens") * 42 / 1000000)
```

提交时按 0 预留，响应返回前用上游 `usage` 结算真实 token；不配表达式则回退按次计价。上游缺 usage 时不上报虚构数字。

## 调用

```bash
curl https://your-newapi.example.com/v1/systemone \
  -H "Authorization: Bearer sk-NEWAPI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "jev-latest",
    "state": {"page": "checkout", "hasDialog": true},
    "questions": {
      "shouldCloseDialog": {"type": "noul", "instructions": "Should the dialog be closed?"},
      "nextAction": {"type": "choice", "instructions": "What next?",
        "criteria": {"retry": "Retry payment", "stop": "Abort", "ask": "Ask the user"}},
      "risk": {"type": "score", "instructions": "How risky?",
        "criteria": ["low", "medium", "high"]}
    }
  }'
```

响应（原生格式，含概率）：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "shouldCloseDialog": {"type": "noul", "noul": 0.94},
    "nextAction": {"type": "choice", "choice": "retry",
      "probabilities": {"retry": 0.88, "stop": 0.05, "ask": 0.07}, "confidence": 0.86},
    "risk": {"type": "score", "score": 1.2,
      "legend": {"0": "low", "1": "medium", "2": "high"},
      "probabilities": {"0": 0.55, "1": 0.35, "2": 0.1}, "confidence": 0.8}
  },
  "usage": {"input_tokens": 312, "output_tokens": 48}
}
```

JS：

```js
const result = await (await fetch("https://your-newapi.example.com/v1/systemone", {
  method: "POST",
  headers: { Authorization: `Bearer ${NEWAPI_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "jev-latest",
    state: { page: "login", hasDialog: true },
    questions: { shouldCloseDialog: { type: "noul", instructions: "Close the dialog?" } },
  }),
})).json();

if (result.answers.shouldCloseDialog.noul > 0.9) closeDialog();
```

同步语义：一次请求一次响应，无 task_id、无轮询。完整协议细节、错误行为和限制见 [plugins/tasks/typesafe/1.0.0/README.md](plugins/tasks/typesafe/1.0.0/README.md)。

## 仓库结构 / 发版

```
plugins/tasks/typesafe/1.0.0/plugin.js      插件（单一文件）
plugins/tasks/typesafe/1.0.0/CHANGELOG.md    发版说明（marketplace 规范格式）
plugins/tasks/typesafe/icon.svg              图标
index.json                                   由 tools/pluginindex 生成，勿手改
tools/pluginindex/                           索引生成器（vendored 自官方插件仓库）
```

new-api 源码与本项目同级放置时（`../new-api`），重新生成索引：

```bash
cd tools/pluginindex
PLUGININDEX_NAME="FFatTiger Plugins" go run . generate ../..
PLUGININDEX_NAME="FFatTiger Plugins" go run . check ../..
```

已发布版本目录不可变；改动以新版本号 + 新 CHANGELOG 发布。

## License

Apache-2.0（与官方插件仓库一致）。
