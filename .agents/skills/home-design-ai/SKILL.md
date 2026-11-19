---
name: home-design-ai
description: 项目级 AI 开发规范，适用于家居设计平台的功能开发、缺陷修复、接口联调、2D 画布编辑和数据存储迁移。强制先读代码和契约，禁止臆造接口、字段、依赖或数据结构。
---

# 家居设计平台 AI 开发技能

## 适用范围

本技能用于修改或扩展本项目的前端、后端、2D 画布、接口、数据模型、JSON 数据迁移、测试和工程配置。

本项目是家居设计平台。核心风险包括：

- 画布中的世界坐标、屏幕坐标、缩放和旋转互相混用。
- 前端根据猜测拼接接口，导致字段、状态码或错误处理不一致。
- 家具、墙体、房间等设计数据缺少稳定 ID 和版本，导致保存后无法可靠恢复。
- 把 MySQL JSON 文档列当作无版本、无校验的任意对象，导致并发覆盖、元数据不一致、无法查询和无法迁移。
- 改动局部功能时破坏已有数据、路由、认证或画布交互。

## 已确认的项目事实

以下内容来自当前仓库的实际文件，后续 AI 不应重新猜测或另起一套约定：

- 根目录是 npm workspaces，包含 `apps/web`、`apps/api` 和 `packages/plan-schema`。
- 前端是 Vue 3 + TypeScript + Vite + Pinia + Vue Router + Element Plus。
- 2D 编辑器使用 Konva.js 和 `vue-konva`，主要入口是 `apps/web/src/components/FloorplanCanvas.vue`。
- 画布几何和吸附辅助函数主要在 `apps/web/src/editor/geometry.ts`，已有几何测试 `apps/web/src/editor/geometry.test.mjs`。
- 后端是 NestJS + TypeORM，数据库是 MySQL 8.x；数据库配置在 `apps/api/src/app.module.ts` 和 `apps/api/src/database/data-source.ts`。
- 共享方案模型在 `packages/plan-schema/src/index.ts`，使用 Zod 和 TypeScript 类型。不能在前端或后端复制一套不一致的 PlanDocument 类型。
- API 前缀是 `/api/v1`，Swagger UI 是 `/api/docs`，OpenAPI JSON 是 `/api/docs-json`。
- 前端统一客户端是 `apps/web/src/api/client.ts`，默认 base URL 是 `/api/v1`，超时 15 秒，并由拦截器处理 JWT、401、429 和服务器错误。
- API 成功和失败响应都遵循 `{ code, message, data, requestId }` 包装格式。不要返回或消费另一种顶层格式。
- 方案实体是 `apps/api/src/plans/plan.entity.ts`，方案主体存储在 MySQL 的 `document_json` JSON 列，同时有 `schema_version`、`revision`、软删除和公开状态字段。
- 方案保存使用 `expectedRevision` 做乐观锁；版本冲突返回 `409 PLAN_VERSION_CONFLICT`。
- 本地草稿使用 `apps/web/src/editor/drafts.ts` 的 `localStorage` 键格式，不能把本地草稿误认为服务端持久化。
- 3D 预览是只读的。2D 编辑器是修改墙体、房间、门窗和家具的唯一入口。
- 「导入」有两条路径：`apps/web/src/views/EditorView.vue` 的**参考底图**（纯垫图描摹，存 `localStorage`，键 `zhujing:bg:${planId}`），以及**识别户型图**（顶视黑白线稿 → 自动生成墙体/房间/门洞）。识别引擎是 `apps/web/src/editor/plan-recognition.ts`（纯计算、不碰 DOM，可 `node --test` 单测），浏览器采样层是 `apps/web/src/editor/plan-recognition-image.ts`（唯一用 Canvas 读像素的地方），UI 是 `apps/web/src/components/PlanImportDialog.vue`，写回走 `applyRecognizedFloorplan(document, result, 'replace' | 'append')`。
- 识别只能在浏览器里做像素处理，**不调用任何云端 AI/视觉接口**：`.env` 里没有任何 AI Key，不要为了这个功能新增联网依赖或收费 API。
- 注意 `需求文档.md` 3.4 节把「房间闭合区域的自动识别」和「AI 生成设计图」列为不做。识别户型图是之后用户明确追加的扩展，且是**本地几何/像素算法而不是 AI 生成**，不违反该约束；不要因为文档里写着 ❌ 就把它删掉或判定为越界。

如果上述文件未来发生变化，必须先以代码和测试为准，并同步更新本技能。

## 绝对规则

### 1. 先取证，再设计

开始任何改动前必须完成以下检查：

1. 使用文件检索工具（`glob` 找文件、`grep` 搜内容）或 `git ls-files` / `Get-ChildItem -Recurse` 查看项目结构。**本机没有安装 `rg`，不要假设它有。**
2. 找到并阅读 `package.json`、构建配置、环境变量示例、入口文件和测试脚本。
3. 找到前端路由、后端路由、控制器、服务层、数据访问层和类型定义。
4. 搜索目标功能的真实调用点：接口 URL、HTTP 方法、请求字段、响应字段、错误处理和调用方。
5. 检查仓库是否已有 `AGENTS.md`、`README`、数据库迁移、OpenAPI、Swagger 或 schema 文件。

如果某个接口、字段、文件或依赖在仓库中找不到，必须标记为“未知”，不能自行补全为看似合理的名称。需要猜测时先向用户说明假设；不能因为 TypeScript 类型或接口名称看起来合理，就把它当成后端真实契约。

### 2. 不猜接口

接口修改必须以真实代码或契约为依据，并同时确认：

- HTTP 方法和完整路径。
- path、query、header 和 body 参数的位置。
- 字段名称、类型、可选性、默认值和空值语义。
- 成功状态码和错误状态码。
- 错误响应格式。
- 认证、权限、租户或用户作用域。
- 分页、排序、幂等和并发更新规则。

前后端都要复用同一份类型或 schema。不能只改前端请求对象而假设后端会兼容，也不能把接口错误静默转换成空数据。

### 3. 不猜数据

写入设计数据前，必须确认：

- 实体的稳定 ID 由谁生成。
- 对象之间使用 ID 引用还是嵌套对象。
- 坐标单位和角度单位。
- 是否允许缺省字段、空数组和 `null`。
- 删除是软删除还是物理删除。
- 保存是否覆盖整份设计，还是使用增量更新。
- 旧版本数据如何读取和迁移。

不允许把“当前示例 JSON”直接当成永久数据库 schema。

### 4. 最小范围修改

只修改完成任务所需的模块。除非用户明确要求，不进行大规模重构、改名、换框架或批量格式化。发现无关问题时记录下来，不顺手改变行为。

### 5. 每次修改都要验证

完成后至少执行项目已有的 lint、typecheck、unit test 或 build 命令中的适用部分。涉及接口时增加请求级验证；涉及持久化时执行保存、重新读取、迁移和并发失败场景验证。

如果命令无法运行，必须说明具体命令和阻塞原因，不能把“代码看起来正确”当作验证通过。

## 省 token 和省时间的协作规则

本项目历史上一次功能改造（识别户型图导入）消耗了约 578 万输入 token、1 小时 40 分钟，其中真正未命中缓存的只有 158K，其余全是重复读取和调试循环的放大。下面 5 条是踩过坑后总结的硬规则，**每次任务都要遵守**：

### 1. 拆任务，一个会话只做一件事

把“写核心算法 / 接 UI / 修测试回归”拆成独立会话或明确阶段。上下文从 80K 降到 20K，输入量和压缩成本会砍掉一大半。不要在一个会话里既做新功能又反复修历史测试。

### 2. 调试循环外包给 subagent

“跑脚本 → 看输出 → 改一行 → 再跑”这类循环交给 `subagent`，只让它回传结论和关键数字，**不要把 20 份完整 JSON / 日志 / 截图堆进主上下文**。主会话只保留判断依据。

### 3. 不要整文件读大组件

`FloorplanCanvas.vue` 2,781 行、`EditorView.vue` 1,344 行、`styles.css`/`theme.css` 各约 2,000 行。先用 `grep` 定位到函数名或关键字拿行号，再用 `read` 的 `offset`/`limit` 读目标 ±50 行。一次整读 26K tok，定点读约 1K tok。同理，不要反复 `git show HEAD:<大文件>` 重读全文。

### 4. 测试先跑单场景

`tests/editor-interactions.mjs` 有 12 个场景，全跑一次 1–2 分钟。定位阶段只跑失败的那一个场景（临时改 `scenario` 过滤或写最小复现脚本），确认修好后再全量跑一遍。

### 5. 调试脚本复用，别每错一次新建一个

不要建 `dbg1.mjs`、`dbg2.mjs`……`dbg19.mjs`。写**一个脚本 + 命令行参数**（例如 `<file> <shot-prefix>`），复用它完成“导入→识别→截图→打印 stats”的全流程。临时脚本放在 `scratch/`，任务结束前删掉自己创建的那些（`scratch/` 里可能有别人的既有文件，别误删）。

## 标准工作流

### 第一步：任务边界

先把用户需求拆成：

- 要改变的用户行为。
- 涉及的页面、路由、接口和数据实体。
- 不应改变的现有行为。
- 需要迁移或兼容的旧数据。
- 验收条件。

如果需求同时涉及画布和后端，先确定数据契约，再分别修改 UI 和持久化实现。

### 第二步：仓库侦察

优先搜索（本机没有 `rg`，用 `git ls-files` 或检索工具代替）：

```powershell
git ls-files
git grep -n "fetch|axios|/api/|router|controller|service|repository|localStorage|konva|snap"
```

将发现的证据分为三类：

- 已确认：源代码、测试或文档直接证明。
- 推断：从调用关系推测，但还没有契约证明。
- 未知：仓库中没有证据。

实现方案只能依赖“已确认”和明确声明的“推断”。“未知”必须通过进一步搜索、运行项目或向用户提问解决。

### 第三步：先写契约再写实现

对于新接口或改接口，先写一份简短契约：

```text
名称：
方法和路径：
认证和作用域：
请求：
成功响应：
错误响应：
幂等和并发规则：
兼容旧客户端的策略：
```

如果项目已有 OpenAPI、zod、class-validator、JSON Schema 或类似 schema，必须复用，不要另写一套只存在于注释中的契约。

本项目的接口修改至少要同时检查：

- `apps/web/src/api/*.ts` 的请求封装。
- 对应的 NestJS controller、DTO 和 service。
- `apps/web/src/types/api.ts` 的响应类型。
- `apps/api/src/common/api-response.interceptor.ts` 和 `api-exception.filter.ts` 的响应/错误包装。
- `tests/smoke.mjs` 以及对应 service spec。

新增接口前优先更新 DTO 的 Swagger 装饰器和 OpenAPI，再实现前端调用。不要只凭 `api.ts` 中的 TypeScript 类型推断服务器行为。

## 后端和 JSON 数据规则

### 现状判断

本项目当前不是把方案写进服务器 JSON 文件，而是使用 MySQL 的 `plans.document_json` JSON 列。这个方向可以保留，但必须把 JSON 文档当作“版本化、受 schema 约束的文档列”，而不是任意对象或无约束数据库。常见风险是：

- 并发保存互相覆盖。
- JSON 文档和关系型元数据不一致。
- 无法可靠查询某个用户、项目或设计版本。
- 没有事务、唯一约束和外键约束。
- 数据结构升级时没有迁移历史。
- 大文档读写和全量保存会增加请求成本。
- 直接把用户输入写回数据库会绕过 schema、素材权限和所有权校验。

禁止在没有迁移设计和用户确认的情况下，把 `document_json` 改成文件、MongoDB、SQLite 或拆成多张表。当前仓库已经有 MySQL、TypeORM migrations、Zod 校验和 revision 乐观锁，优先修复治理和一致性问题，不要为了“JSON 有问题”而凭空更换数据库。

### 演进原则

不要直接删除当前 `document_json` 或一次性改成另一种结构。采用分阶段迁移：

1. 盘点当前 `PlanDocumentSchema` 和数据库里的真实文档，记录字段、缺省值、重复 ID 和异常数据。
2. 通过 `schemaVersion` 增加新的文档版本；当前版本是字面量 `1`，不能直接把旧文档当成新版本。
3. 保持 `PlansService.parseDocument()` 作为服务端校验边界；前端校验只能改善体验，不能替代后端校验。
4. 数据结构升级时增加可重复执行的迁移函数或 migration，并为每个旧版本写迁移测试。
5. 迁移后做数量校验、ID 校验、关联关系校验和抽样比对。
6. 在切换前保留原始文件备份和回滚方案。
7. 通过 feature flag 或配置逐步切换读路径，再切换写路径。
8. 稳定后再移除旧读写路径，不要先删除旧数据。

本项目保存方案时必须保持以下不变量：

- `document_json.schemaVersion === plans.schema_version`，不一致时拒绝继续编辑。
- 服务端从经过 `PlanDocumentSchema.safeParse` 的文档写入 `schema_version`，不能接受客户端分别提交的第二个版本号。
- `document_json` 中的家具 `assetId` 必须经过素材启用状态校验。
- 保存必须带 `expectedRevision`，并用条件更新保证旧页面不会覆盖新版本。
- 方案列表只返回元数据，详情接口才返回完整 `document_json`。
- 删除使用现有软删除语义，不得用物理删除替代。

### 推荐的数据边界

至少区分以下概念，不要把所有内容塞进一份无结构 JSON：

- 用户和权限。
- 项目或户型设计。
- 房间和墙体。
- 家具/素材实例。
- 设计版本或草稿。
- 操作记录或审计信息。

设计内容可以暂时以一个版本化 JSON 文档存储在数据库字段中，但仍需要：

- 数据库中的设计 ID、用户 ID、版本号、更新时间和乐观锁版本。
- 后端 schema 校验。
- 服务端生成或校验稳定 ID。
- 保存时的版本冲突检测。
- 受控的导入导出接口。

### 如果未来增加导入/导出 JSON

导入/导出文件是用户可控输入，不等同于数据库存储。必须复用 `PlanDocumentSchema`，限制请求体大小，重新校验家具素材 ID、关联墙体和门窗范围，并由服务端生成方案 ID 和所有权。导出时不能包含 JWT、用户密码、内部数据库字段或其他用户数据。

### 如果短期必须继续使用 JSON 文件

至少实现：

- 写入临时文件后原子替换。
- 文件锁或单写队列，避免并发覆盖。
- schema 校验和未知字段策略。
- `schemaVersion` 和迁移函数。
- 设计 ID、更新时间和版本号。
- 备份、恢复和损坏文件处理。
- 禁止客户端传入路径，所有路径由服务端根据用户和设计 ID 生成。

## 接口联调规则

### 请求层

- 所有请求集中在已有的 API client/request 层，不在组件里散落 `fetch`。
- 统一处理 base URL、认证、超时、取消请求和错误格式。
- 不要把 HTTP 200 的业务错误当成成功数据。
- 保存操作要防止重复提交，并处理请求过期或版本冲突。
- 不要在前端把异常响应直接替换成空数组，除非产品契约明确要求。

### 响应层

- 前端渲染前校验关键字段，避免后端缺字段造成画布崩溃。
- 对未知字段保持向前兼容，但对缺少 ID、类型或坐标单位等关键字段要明确报错。
- 保留后端错误码和可定位信息；给用户看的文案与开发日志分离。
- 接口返回的设计数据必须经过归一化，再交给画布状态。

### 修改接口时的检查表

- 是否还有旧客户端调用？
- 是否需要兼容旧字段？
- 是否同步修改前端类型、后端 schema、测试和文档？
- 是否检查空数据、重复提交、权限不足、资源不存在和版本冲突？
- 是否验证真实响应，而不是只验证 mock？

## 2D 画布专项规则

### 当前代码入口和已有行为

- `geometry.ts` 已提供 `screenToLogical`、`logicalToScreen`、`snapToGrid`、墙体端点/墙体中心线吸附、正交约束和角度约束。
- 当前吸附优先级大致是墙体几何 > 角度 > 网格；修改时要先补测试再扩展，不要重写已有函数并丢失现有行为。
- `FloorplanCanvas.vue` 当前绘制 `snapHint`、水平/垂直 `guides`、墙体端点、房间顶点和家具拖拽/缩放手柄。
- 当前 `snapHint` 是单个 Konva 圆形提示；如果要改善“小圆点”，应扩展 hint 的类型和 overlay 反馈，不要把视觉标记写入 `PlanDocument`。
- 现有几何测试已经覆盖端点优先、墙体中心线、屏幕像素阈值（`SNAP_ENTER_PX = 8`、`SNAP_RELEASE_PX = 14`）、缩放、网格和角度。任何吸附改动必须保留这些断言并增加回归测试。`SNAP_PRIORITY` 的完整顺序在 `apps/web/src/editor/geometry.ts`，改前先读，不要凭记忆。

### 数据模型

画布对象必须遵循共享 `PlanDocument` 的现有字段，而不是自行发明另一份后端模型。当前字段包括：

```text
walls[].id / start / end / thickness / height
rooms[].id / name / polygon
openings[].id / wallId / type / offset / width / height / sillHeight
furniture[].id / assetId / position / rotation / width / depth / height / locked / zIndex
```

当前 `PlanDocument.unit` 是 `cm`，点坐标范围为 0 到 10000；角度是 0 到小于 360 的度数；画布逻辑坐标不能为负。坐标单位、旋转方向、旋转中心和原点必须沿用 `packages/plan-schema/src/index.ts` 与 `geometry.ts`，禁止在不同组件中分别约定一套单位。

### 吸附

吸附距离使用屏幕像素定义，再依据 zoom 换算为世界坐标。必须区分进入阈值和释放阈值，避免吸附抖动。候选对象至少包括网格、墙体端点、房间角点、家具角点、中心点、边中点和对齐线。

吸附算法输出不应只有一个点，还应包含：

```text
targetId
targetKind
delta
guideLines
label
priority
```

视觉反馈应在独立 overlay 层绘制，不要把辅助线和吸附标记写入设计数据。

吸附改动的最小安全范围通常是 `geometry.ts`、`geometry.test.mjs` 和 `FloorplanCanvas.vue`，除非接口需要持久化用户设置，否则不要改 `PlanDocumentSchema`。如果新增 `snapEnabled`、网格尺寸或吸附模式，必须同步共享 schema、默认文档、编辑器状态、保存恢复和迁移。

### 画布变更保护

- 拖动过程不要直接修改后端数据；拖动结束或明确保存时提交。
- 保存前将画布状态归一化并校验 schema。
- 需要撤销/重做时保存可序列化的命令或快照，不能保存渲染对象引用。
- 后端保存失败时保留本地草稿，并明确提示用户，不要静默丢失。

### 画布交互、写回与测试约定（实测）

- **写回方案文档的标准模式**（参考 `EditorView.vue` 的 `addRoomTemplate`）：`const document = cloneReactive(plan.value.documentJson)` → 修改副本 → `recordHistory()` → `plan.value.documentJson = document` → 更新选中态 → `ElMessage`。不要直接改 `plan.value.documentJson` 的嵌套字段（会绕过撤销栈）。
- **外部生成的文档先过 `PlanDocumentSchema.safeParse`**（例如识别导入），失败就 `ElMessage.error` 并放弃，不要写入未校验的数据。
- **快捷键守卫不要用 `document.querySelector('[role="dialog"]')`**：Element Plus 的 `el-dialog` 关闭后仍留在 DOM（`display:none`、`getClientRects().length === 0`），会导致 Delete/Ctrl+Z 等全局快捷键被永久屏蔽。用 `Array.from(document.querySelectorAll('[role="dialog"]')).some((n) => n instanceof HTMLElement && n.getClientRects().length > 0)` 判断是否真有可见对话框。
- `FloorplanCanvas.vue` 的 `defineExpose` 目前包含 `locateDesign`（自动把视野框到当前 document）、`clearInteraction`、`deleteSelected`、`duplicateSelected`、`exportPng`、`addFurnitureAtCenter` 和各 `selected*Id`。导入或批量替换文档后要 `setTimeout(() => canvas.value?.locateDesign(), 0)`，等新 document 渲染完再定位。
- **家具/墙体的渲染会随"选中态"变化**（`isFurnitureSelected` 会加粗描边、在标签里追加 ` · 高 85`）。写截图比对的测试时，要先点一下把基线定在"已选中"状态，否则截图差异来自选中高亮而不是位置变化。
- **测试里算画布坐标不要手推公式**：`clampViewportToNonNegative` 会把 `x`/`y` 夹到 `Math.min(视口值, 80)`，而 `fitDocumentViewport` 的上下留白不对称，手推的 `center` 公式会偏几十像素导致点空。运行时从 Konva 读真实变换：`const layer = window.Konva.stages[0].getLayers()[0]; { x: layer.x(), y: layer.y(), zoom: layer.scaleX() }`，再用 `屏幕 = bounds + layer偏移 + 逻辑坐标 * zoom` 换算。
- 工具栏按钮变多时要注意窄屏横向溢出：`.editor-toolbar` 与 `.toolbar-actions` 需要 `flex-wrap: wrap`，否则 1024/820px 下 `scrollWidth > innerWidth`。

## 防幻觉规则

以下行为禁止：

- 编造项目不存在的接口、路由、数据库表、环境变量或组件。
- 只凭文件名猜测数据结构。
- 把示例数据、mock 数据或 TypeScript interface 当成后端真实契约。
- 为了让页面不报错，偷偷给关键字段填随机 ID、默认坐标或空数据。
- 发现接口不存在时直接新增同名接口，绕过现有服务层。
- 未确认影响范围就改认证、数据库、构建配置或删除数据。
- 未运行测试就声称“已验证”或“接口已联通”。

遇到不确定信息时使用以下格式：

```text
已确认：来自 <文件/函数/测试> 的证据。
推断：基于 <调用关系> 的暂时判断。
未知：仓库中没有找到 <信息>，需要搜索/运行/询问后才能修改。
```

## 测试和验收

### 本项目验证命令

优先使用仓库已有命令：

```powershell
npm run typecheck
npm run test
npm run build
npm run test:editor
npm run test:smoke
npm run migration:run
```

不需要每次都运行全部命令，但必须根据改动范围选择并记录适用命令：共享 schema 变更至少跑 schema build/test；画布几何变更至少跑 `npm run test:editor` 和 geometry 测试；接口或持久化变更至少跑 API tests、typecheck 和真实 smoke 测试。

### 本机 Windows 环境注意事项（实测）

- **在 PowerShell 里一律用 `npm.cmd`，不要用 `npm`**（`npm` 解析到 `C:\WINDOWS\system32\npm`，会报「无法在管道中间运行文档」）。
- **判断真实退出码用 `| Out-Null; $LASTEXITCODE`**，不要用 `2>&1 | Select-Object`——后者会把 stderr 变成 `[exit code: 1]` 假失败。
- **`npm run build` 前把 `$env:TEMP` 和 `$env:TMP` 指到工作区内**（例如 `D:\code\zhujing-home-design\.tmp-build`），否则 esbuild 在 `C:\Users\...\AppData\Local\Temp` 删临时文件时报 `Access is denied`，这是 ACL 问题不是代码问题。
- **`npm run test:editor` 需要 web 服务已在 http://localhost:5173 运行**（脚本用 Playwright 驱动本机 Chrome 打开真实页面）；跑之前先确认 dev server 在跑。
- 用 `Get-Content` 看 UTF-8 无 BOM 文件时中文可能显示成乱码（`项目绾?AI 寮€鍙戣`），**这是控制台 GBK 解码造成的假象，文件本身没坏**；要用 `read` 工具或 `[System.Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($p))` 确认。
- `apps/web/package.json` 的 test 脚本是 `node --experimental-strip-types --test src/editor/*.test.mjs`：只匹配 `.test.mjs`，且该模式下 **import 必须写 `.ts` 后缀**（如 `from './geometry.ts'`）。`packages/plan-schema` 是 CommonJS 包，`.mjs` 测试里要 `const require = createRequire(import.meta.url)` 再 `require('@home-design/plan-schema')`，直接 `import { EMPTY_PLAN_DOCUMENT }` 会报 `SyntaxError: Named export ... not found`。

### 最低验证集

- 前端类型检查或构建。
- 后端类型检查、单元测试或启动检查。
- 真实接口的成功和失败响应。
- 新建设计、保存设计、重新打开设计。
- 刷新页面后数据仍能恢复。
- 旧 JSON 数据导入或迁移。
- 保存冲突、权限不足、资源不存在和损坏数据场景。
- 画布缩放到 25%、100%、400% 时拖动和吸附一致。

### 吸附专项验收

- 墙角优先于网格。
- 家具角点、中心点、边中点可吸附。
- 临界阈值附近不会抖动。
- 旋转对象的吸附点正确。
- 关闭吸附后可自由移动。
- 目标高亮、辅助线和提示文字与实际吸附目标一致。
- 大量对象下拖动不会明显卡顿。

## 输出格式

完成任务时，最终报告必须包含：

1. 修改了哪些文件，以及每个文件的职责。
2. 使用了哪些已确认的接口、字段和数据结构证据。
3. 是否有迁移、兼容或回滚风险。
4. 执行过的验证命令和结果。
5. 未能验证的部分及原因。
6. 建议的后续工作。

不要只说“已完成”“已修复”或“接口正常”。必须给出可复核的文件、命令、响应或测试证据。

## 推荐的任务计划模板

```text
目标：
已确认的代码入口：
真实接口契约：
涉及的数据实体：
当前 JSON/数据库风险：
计划修改：
兼容策略：
验证方式：
未知和风险：
```
