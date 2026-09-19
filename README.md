# JSON 契约工坊（JSON Contract Studio）

把零散的 JSON 样本整理成接口契约：粘贴多份 JSON，系统递归归纳出 **JSON Schema 2020-12**，
自动处理字段缺失、`null`、异构数组与类型冲突，并在树形视图中标注每条规则对应的样本路径；
支持一键复制 Schema、校验新样本并按 **JSON Pointer** 展示错误；
还可把归纳结果设为基线，对比新旧两版 Schema 的**契约演进**（破坏性/兼容判定），
并通过**发布门禁**结合基线/目标 SemVer 给出允许或阻止发布的结论与可复制报告。

技术栈：Node.js · Express · React（Vite）· Ajv（draft 2020-12）

## 快速开始（Docker，单条命令）

```bash
docker compose up --build
```

启动后访问：**http://localhost:8080**

> 依赖安装、前端构建、后端运行全部包含在该命令内，无需任何本地环境（除 Docker）。
> 不使用 Compose 时亦可：`docker build -t json-contract-studio . && docker run -p 8080:8080 json-contract-studio`

停止：`docker compose down`。

## 功能与归纳规则

| 场景 | 归纳结果 |
| --- | --- |
| 字段在部分样本中缺失 | 该字段不进入 `required`（即可选） |
| 字段出现 `null` | `type` 变为联合类型，如 `["null", "string"]` |
| 整数与浮点混排 | 放宽为 `"number"` |
| 异构数组（如 `["a", 1, null]`） | 所有元素折叠为单个 `items`，类型取并集 |
| 对象与标量冲突 | `type` 并集，如 `["string", "object"]`，`properties` 仅约束对象实例 |
| 全为空数组 | 不生成 `items` 约束（任何元素均可） |

- **树形视图**：每个节点显示类型徽章、必填/可选/可空/多类型标记；点击「n 处样本」展开
  贡献该规则的样本路径（`#/<样本序号>/<路径>`，RFC 6901 转义）。
- **复制 Schema**：一键复制完整 Schema JSON 到剪贴板。
- **校验新样本**：基于 Ajv（`allErrors`），错误按 JSON Pointer（如 `/tags/0`）展示，
  并附带关键字、信息与对应规则路径。
- **契约演进对比**：把当前归纳结果设为基线，修改样本后归纳新版 Schema，比较器递归处理
  对象属性、`required`、类型联合与数组 `items`，在结果区按 JSON Pointer 分组展示变更清单；
  每条变更给出旧/新规则与判定原因，可一键筛选破坏性项。
- **发布门禁**：在演进页填写基线版本（当前 SemVer）与目标版本（新版 SemVer），门禁复用当前
  `/api/diff` 差异汇总即时给出「允许/阻止发布」结论，展示实际升级类型、触发结论的变更数量与
  原因，并可复制包含版本、视角、汇总与结论的 JSON 报告；切换视角或修改版本号都会即时重算。

## 契约演进：操作说明

1. 粘贴样本并点击「归纳 Schema」，在「② 契约 Schema」页点「设为基线」（或到「④ 契约演进」页设置）。
2. 修改左侧样本，再次点击「归纳 Schema」，结果区自动切到「④ 契约演进」并展示与基线的差异。
3. 选择视角、按需勾选「仅显示破坏性变更」；可随时「将当前结果设为基线」或「清除基线」。
4. 在「发布门禁」卡片填写基线版本与目标版本（SemVer），即时得到放行结论，需要时可复制门禁报告。

基线仅保存在当前浏览器会话（`sessionStorage`）：刷新页面仍在，关闭标签页即失效，不会上传到服务器持久化。
门禁填写的两个版本号同样仅保存在当前浏览器会话。

判定规则（其余变更标为「兼容」或「提示」）：

| 视角 | 破坏性变更 | 示例 |
| --- | --- | --- |
| 请求体（客户端 → 服务端） | 新版新增必填字段；收窄可接受类型 | 可选变必填、`["null","string"]` → `"string"` |
| 响应体（服务端 → 客户端） | 新版删除必填输出；放宽输出类型 | 必填字段被移除、`"integer"` → `"number"` |

## 发布门禁：判定规则

门禁完全在浏览器内基于当前 `/api/diff` 结果计算，不发起额外请求：

| 契约差异（当前视角） | 放行条件 |
| --- | --- |
| 存在破坏性变更 | 仅**主版本**提升可放行（如 `1.2.3` → `2.0.0`，含 `2.0.0-alpha.1`） |
| 仅有兼容/提示级变更 | 至少**次版本**提升（如 `1.2.3` → `1.3.0`） |
| 无契约变化 | **补丁级**发布即可（含同数值版本的预发布递进，如 `1.2.3-alpha` → `1.2.3`） |
| 目标版本 ≤ 基线版本 | 降级或同版本**一律阻止** |

版本解析遵循 SemVer 2.0.0：支持可选 `v` 前缀（`v1.2.3`）与预发布标识（`1.0.0-alpha.1`），
比较时先比主/次/补丁数值，再按预发布优先级（预发布 < 正式版，数字标识符按数值、字母标识符按
ASCII 比较）；构建元数据（`+build`）可解析但不参与比较。结论区展示实际升级类型、门禁要求、
触发结论的变更数量与原因；「复制门禁报告」生成包含版本、视角、差异汇总与结论的 JSON。

## 本地开发

```bash
npm run setup        # 安装 server 与 client 依赖
npm run dev:server   # 后端 http://localhost:8080（--watch 热重载）
npm run dev:client   # 前端 http://localhost:5173（/api 代理到 8080）
```

生产模式本地运行：`npm run build && npm start`，访问 http://localhost:8080。

## 测试

```bash
npm test             # node:test，覆盖归纳引擎、契约比较器、HTTP API 与发布门禁（51 项）
```

## API

| 方法 | 路径 | 请求体 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/health` | — | `{ "status": "ok" }` |
| POST | `/api/infer` | `{ "samples": [<any>, ...] }` | `{ schema, paths, sampleCount }` |
| POST | `/api/validate` | `{ "schema": {...}, "sample": <any> }` | `{ valid, errors: [{ path, pointer, schemaPath, keyword, message, params }] }` |
| POST | `/api/diff` | `{ "oldSchema": {...}, "newSchema": {...}, "perspective": "request" \| "response" }` | `{ perspective, changes: [{ pointer, kind, field?, severity, oldRule, newRule, reason }], summary: { breaking, compatible, info } }` |

示例：

```bash
curl -X POST http://localhost:8080/api/infer \
  -H 'Content-Type: application/json' \
  -d '{"samples":[{"id":1,"phone":null},{"id":2,"phone":"123"}]}'
```

## 目录结构

```
├── Dockerfile              # 多阶段：构建前端 → 安装后端依赖 → 精简运行时（非 root）
├── docker-compose.yml      # 单服务，映射 8080
├── package.json            # 根编排脚本（setup/dev/build/start/test）
├── server/
│   ├── infer.js            # 递归归纳引擎（类型并集、required、items 折叠、路径映射）
│   ├── diff.js             # 契约演进比较器（递归对比属性/required/类型联合/items，按视角定级）
│   ├── app.js              # Express 应用（/api/infer、/api/validate、/api/diff、静态托管）
│   ├── index.js            # 入口：监听 PORT（默认 8080）
│   └── test/               # node:test 单元与 API 测试
└── client/
    ├── test/               # 发布门禁（SemVer 解析/比较/判定）单元测试
    └── src/
        ├── App.jsx                 # 双栏布局、样本管理、归纳/校验/演进流程、基线（sessionStorage）
        ├── gate.js                 # 发布门禁：SemVer 2.0.0 解析/比较 + 放行判定（纯函数）
        ├── components/SchemaTree.jsx   # 树形视图 + 样本路径标注
        ├── components/ValidatePanel.jsx # 校验面板，JSON Pointer 错误列表
        ├── components/DiffPanel.jsx     # 契约演进面板：视角切换、破坏性筛选、按 Pointer 分组
        ├── components/ReleaseGate.jsx   # 发布门禁卡片：版本输入、放行结论、报告复制
        └── components/SampleEditor.jsx  # 样本编辑器（实时 JSON 校验）
```

环境变量：`PORT`（默认 `8080`）。
