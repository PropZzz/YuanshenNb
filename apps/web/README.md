# `apps/web` — React 19 + TypeScript 工作台

## 技术栈与锁定版本

- **Node.js**：`>= 20`（实测 `v24.15.0` / `npm 11.12.1`）
- **构建与框架**：`Vite 6`（`^6.4.6`）+ `React 19`（`^19.1.0`）+ `TypeScript`（`^5.8.3`）+ `React Router v7`
- **样式与组件**：`Tailwind CSS v4`（`@tailwindcss/vite ^4.1.0`）+ [src/styles/tokens.css](src/styles/tokens.css) + [src/styles/index.css](src/styles/index.css)（后续按需安装 `shadcn/ui` 组件）
- **状态与契约**：`TanStack Query v5`（`^5.74.0`）+ `Zustand v5`（`^5.0.3`）+ `openapi-typescript ^7.13.0` / `openapi-fetch ^0.17.0`
- **测试**：`Vitest`（`^3.2.7`）+ `jsdom`

## 起步与常用命令

```powershell
cd apps/web
npm install

# 根据 ../../contracts/openapi.json 重新生成强类型 schema.d.ts
npm run gen:api

# 启动本地开发服务器（默认 5173，代理 /api -> VITE_API_BASE_URL）
npm run dev

# 验收门禁（PR 合并前必跑）
npm run typecheck
npm run build
npm test
```

## 已保留的 V1 视觉资产

- `public/brand-logo.png` — 品牌 Logo
- `public/favicon.png` — 浏览器图标
- `src/styles/tokens.css` — 浅/深色品牌语义令牌与日历时间线样式

设计规范与 V1→V2 页面精简映射见 [docs/06-design-system-v2.md](../../docs/06-design-system-v2.md)，Web 模块架构见 [docs/05-client-web-and-android.md](../../docs/05-client-web-and-android.md)。
