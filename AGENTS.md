# 项目级 AI 开发规则

这是一个家居设计平台项目。任何 AI 在阅读、修改或新增代码前，必须先阅读：

`.agents/skills/home-design-ai/SKILL.md`

该技能是本项目的强制开发规范，尤其适用于：

- 2D 画布、墙体、房间、家具和吸附逻辑。
- 前后端接口新增或修改。
- JSON 设计数据、数据库迁移和持久化。
- 设计数据导入、导出、保存和版本恢复。

核心要求：先从仓库证据确认接口和字段，不得臆造；不直接把 JSON 文件当作无版本数据库；涉及持久化、接口和画布的改动必须有对应的验证结果。

当前项目事实：前端使用 Vue 3 + Konva/vue-konva，后端使用 NestJS + TypeORM + MySQL，方案文档存储在 `plans.document_json`（MySQL JSON 列），共享校验在 `packages/plan-schema`。接口前缀为 `/api/v1`，响应包装为 `{ code, message, data, requestId }`，方案保存依赖 `expectedRevision` 乐观锁。画布吸附入口主要是 `apps/web/src/editor/geometry.ts` 和 `apps/web/src/components/FloorplanCanvas.vue`。

常用验证命令：`npm run typecheck`、`npm run test`、`npm run build`、`npm run test:editor`、`npm run test:smoke`。修改接口或数据结构时，优先查看 `README.md`、`需求文档.md`、`项目提示词与需求评审.md` 和现有 migrations。
