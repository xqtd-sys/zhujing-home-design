# 家居设计平台

这是一个“2D 可编辑、3D 只读预览”的在线家居设计平台。

项目目录：`D:\\code\\zhujing-home-design`

## 技术栈

- 前端：Vue 3 + TypeScript + Vite + Pinia + Vue Router + Element Plus
- 2D 编辑器：Konva.js
- 3D 预览：Three.js（只读）
- 后端：Node.js + NestJS + TypeScript
- 数据库：MySQL 8.x
- 共享模型：Zod + TypeScript
- 接口文档：NestJS Swagger

## 目录

```text
apps/web              Vue 前端
apps/api              NestJS API
packages/plan-schema  PlanDocument 的 Zod 校验与共享类型
```

## 启动

环境要求：Node.js 22+、npm 10+、Docker Desktop（用于 MySQL）。

```powershell
Copy-Item .env.example .env
npm install
docker compose up -d mysql
npm run migration:run
npm run build
```

开发模式需要打开两个终端：

```powershell
npm run dev:api
npm run dev:web
```

- 前端：http://localhost:5173
- API：http://localhost:3000/api/v1/health
- Swagger：http://localhost:3000/api/docs
- OpenAPI JSON：http://localhost:3000/api/docs-json

当前已实现用户和方案管理、家具素材目录、Konva 2D 编辑器、Three.js 只读预览、Zod 深层校验、revision 乐观锁和 Swagger。

## 自动化冒烟测试

先启动 MySQL、API 和前端，再运行：

```powershell
npm run test:smoke
```

测试使用系统 Chrome 或 Edge，覆盖注册登录、素材目录、完整方案保存恢复、revision 冲突、资源权限隔离、浏览器编辑器恢复、3D 预览和软删除。测试账号使用唯一前缀并在结束时自动从开发数据库清理。可通过 `SMOKE_API_URL`、`SMOKE_WEB_URL` 和 `PLAYWRIGHT_CHROME_PATH` 覆盖默认地址或浏览器路径。

编辑器交互回归可单独运行（先构建共享模型并启动前端）：

```powershell
npm run build -w @home-design/plan-schema
npm run test:editor
```

此测试使用隔离浏览器及模拟 API，不写入真实账户或方案。覆盖输入框快捷键、空格/中键平移、单一对象删除、低墙门窗校验、草稿恢复及 2D/3D 工具状态同步。完整冒烟测试另覆盖真实数据库中的重命名与保存并发、权限及软删除隔离。

另覆盖缩短墙体时保留门窗、撤销/重做后的选中状态、房间名称长度限制，以及小屏素材/属性面板的展开和收起。当前 12 组交互场景还验证坐标从原点 0 开始、拖动后对象不会进入负坐标、拒绝拖动后恢复图形位置、画布外松键/窗口失焦取消未完成墙体。测试会在 `.smoke-artifacts` 输出 `refined-editor-desktop.png` 和 `refined-editor-mobile.png`，供布局检查。

## 数据库初始化

推荐使用项目自带的 MySQL 容器，主机端口为 `3307`，不会占用常见的本机 `3306`：

```powershell
docker compose up -d mysql
npm run migration:run
```

如果使用已有 MySQL，请先创建 `home_design` 数据库和具有该数据库权限的用户，然后修改根目录 `.env` 中的 `DB_HOST`、`DB_PORT`、`DB_USERNAME` 和 `DB_PASSWORD`。

## 首个业务闭环

启动数据库并执行 migration 后：

1. 打开注册页创建账户。
2. 登录后进入“我的设计”。
3. 新建空白方案并进入编辑页。
4. 点击保存，revision 会从 1 增加为 2。
5. 使用旧 revision 保存时，API 返回 `409 PLAN_VERSION_CONFLICT`。

## 产品边界

2D 视图负责绘制墙体、门窗、房间和家具。3D 视图只根据同一份 `PlanDocument` 生成预览，用户不能在 3D 中拖动家具、修改墙体或编辑方案。
