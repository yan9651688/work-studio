# AI 创作平台复刻 —— 技术架构与实施方案

> 参考站：<https://img.junliai.org/> （以下简称"参考站"）
> 所有参考网址集中列在下方「参考网站」一节；第 7 节表格也逐页标注了网址。
> 目标：前台 UI 像素级复刻，后端用 SQLite，所有上游 API 地址、Key、模型、价格、展示内容都在管理后台配置。
> 品牌相关内容（站名、Logo、联系方式、展示作品、提示词）**一律不硬编码**，全部放进 `site_settings` / `showcase` 表，由后台填写。

---

## 参考网站

**主站：<https://img.junliai.org/>**

所有复刻工作以该网站为准。打开后等"正在加载…"消失再截图、取样式。

### 前台页面（可直接访问，像素级复刻）
| 页面 | 网址 |
|---|---|
| 首页 | <https://img.junliai.org/> |
| 创作工作台 | <https://img.junliai.org/create> |
| 模型广场 | <https://img.junliai.org/model-square> |
| 文档中心 | <https://img.junliai.org/docs> |
| 模型 API 文档 | <https://img.junliai.org/docs/models> |
| 应用 API 文档 | <https://img.junliai.org/docs/apps> |
| 实时监控 | <https://img.junliai.org/status> |
| 应用中心 | <https://img.junliai.org/apps> |
| 技能中心 | <https://img.junliai.org/skills> |
| 更新日志 | <https://img.junliai.org/updates> |
| 用户中心（需登录） | <https://img.junliai.org/user> |

### 管理后台（需管理员账号，无权限时按第 7.3 节功能描述实现）
入口：<https://img.junliai.org/admin> ，各子页面网址见第 7.3 节表格。

### 公共数据接口（可直接打开看返回结构）
| 接口 | 网址 |
|---|---|
| 站点配置 | <https://img.junliai.org/admin/api/site> |
| 统计数据 | <https://img.junliai.org/admin/api/stats> |
| 模型列表 | <https://img.junliai.org/admin/api/managed-models> |
| 作品展示 | <https://img.junliai.org/admin/api/showcase> |

### 样式与脚本文件（取精确 CSS 时参考；文件名带哈希，原站重新部署后会变，失效时在首页 `<head>` 里重新找）
- <https://img.junliai.org/assets/main-BmdZIzWv.css>（全局样式、设计变量）
- <https://img.junliai.org/assets/SelectMenu-DSYpTtL6.css>
- <https://img.junliai.org/assets/ModelHealthBadge-BtE3uj7C.css>
- <https://img.junliai.org/assets/ModelGroupFilter-k9bvi6hz.css>
- <https://img.junliai.org/assets/ProviderLogo-pi0h8A0w.css>
- <https://img.junliai.org/assets/ModelCatalogView-BhgYyCQX.css>
- <https://img.junliai.org/assets/wiki-C3dEoNhx.css>
- <https://img.junliai.org/assets/StatusView-FOuxosgu.css>
- <https://img.junliai.org/assets/main-jCy6Is2D.js>（前端主包，含完整路由表）

---

## 0. 给执行 Agent 的总规则

1. 先读完本文档，再按第 9 节的任务顺序做；每个任务都有"完成标准"。
2. 像素对齐的依据：参考站实时页面 + 第 4 节设计令牌。复刻一个页面前，先用浏览器打开参考站对应路由（**页面加载较慢，等"正在加载…"消失后再截图/取样式**），在 1440×900 与 390×844 两个尺寸下截图存进 `docs/ref/<页面>/`。
3. 不得下载/搬运参考站的图片、Logo、展示作品和提示词文案；种子数据用占位内容。
4. 接口路径与返回字段尽量与参考站一致（见第 6 节），便于前端对照。
5. 全项目使用 TypeScript；提交前必须通过 `pnpm lint && pnpm typecheck && pnpm test`。

---

## 1. 参考站分析结论

| 项目 | 结论 |
|---|---|
| 前端框架 | Vue 3.5 + Vite（单入口 `assets/main-*.js`，按路由拆 chunk），组件使用 scoped CSS（`data-v-xxx`） |
| 字体 | `Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif`，开启 `font-optical-sizing: auto` |
| 图标 | 线性 1.5px 描边风格，与 lucide 一致（Sparkles、SlidersHorizontal、BookOpen、LayoutGrid、Layers、Code、Activity、PanelLeft 等） |
| 主题 | 浅色/深色两套，深色通过 `html.dark` 切换 CSS 变量 |
| 接口前缀 | 公共数据也走 `/admin/api/*`（`site`、`stats`、`managed-models`、`showcase`） |
| 后端推测 | Go（时间戳纳秒精度），本方案改用 Node，不影响前端 |
| 路由总数 | ~98 个，分前台 / 用户中心 / 团队 / 代理商 / 管理后台五大块（完整列表见附录 A） |

---

## 2. 技术栈

| 层 | 选型 | 说明 |
|---|---|---|
| 包管理 | pnpm workspace（monorepo） | |
| 前端 | Vue 3.5 + Vite 6 + TypeScript + Vue Router 4 + Pinia | 与参考站一致，利于像素对齐 |
| 前端样式 | 原生 CSS 变量 + 组件 scoped CSS（**不用 Tailwind/UI 库**） | 参考站即如此，用 UI 库反而难对齐 |
| 图标 | `lucide-vue-next` | |
| 前端请求 | 自封装 `fetch`（`src/api/http.ts`），统一处理 401、错误 toast | |
| 管理后台 UI | 同一个前端工程内的 `/admin/*` 路由，复用同一套设计令牌 | 参考站后台也在同一 SPA 内 |
| 后端 | Node 20 LTS + Fastify 5 + TypeScript | |
| 数据库 | SQLite（`better-sqlite3`，开启 WAL）+ Drizzle ORM + drizzle-kit 迁移 | |
| 校验 | zod（前后端共享 schema，放 `packages/shared`） | |
| 认证 | 用户：Session Cookie（httpOnly，存 `sessions` 表）；对外 API：`Authorization: Bearer sk-xxx` | |
| 密码 | argon2 | |
| 文件存储 | 本地磁盘 `data/uploads/`（抽象成 `StorageDriver`，预留 S3/CDN 驱动），缩略图用 `sharp` 生成 `.thumb.jpg` | 参考站有 `xxx.png.thumb.jpg` |
| 任务队列 | 进程内队列 + SQLite `generations` 表做持久化（状态机），启动时恢复未完成任务 | 单机足够 |
| 实时推送 | SSE（生成进度、监控页） | |
| 测试 | Vitest（单元/接口）、Playwright（E2E + 像素对比） | |
| 部署 | 单个 Node 进程同时托管 API 和前端静态文件；Dockerfile + docker-compose；数据目录挂载 `./data` | |

---

## 3. 目录结构

```
img/
├─ package.json / pnpm-workspace.yaml
├─ docs/
│  ├─ PLAN.md            ← 本文档
│  └─ ref/               ← 参考站截图（按页面分目录）
├─ packages/
│  └─ shared/            ← zod schema、类型、常量（模型类型、比例、分辨率枚举）
├─ apps/
│  ├─ web/               ← Vue 前端
│  │  ├─ src/
│  │  │  ├─ styles/      tokens.css（第4节变量）、base.css、utilities.css
│  │  │  ├─ layouts/     PublicShell.vue（左侧栏+内容）、AdminShell.vue、UserShell.vue
│  │  │  ├─ components/  基础组件（第5节）
│  │  │  ├─ views/
│  │  │  │  ├─ public/   Home, Create, ModelSquare, Docs, Status, Apps, Skills
│  │  │  │  ├─ user/     Overview, Orders, Recharge, ApiKeys, CreditUsage, Settings, Invite, MyLogs
│  │  │  │  └─ admin/    见第7节
│  │  │  ├─ router/      index.ts（路由守卫：登录、管理员）
│  │  │  ├─ stores/      site.ts, auth.ts, theme.ts, models.ts
│  │  │  └─ api/
│  │  └─ e2e/            Playwright 用例 + 像素对比
│  └─ server/            ← Fastify 后端
│     ├─ src/
│     │  ├─ db/          schema.ts（Drizzle）、migrations/、seed.ts
│     │  ├─ routes/      public.ts, auth.ts, user.ts, admin/*.ts, v1/*.ts（对外 API）
│     │  ├─ services/    gateway/（上游适配器）、billing.ts、storage.ts、stats.ts、moderation.ts
│     │  ├─ plugins/     auth.ts, rateLimit.ts, errorHandler.ts
│     │  └─ index.ts
│     └─ data/           ← 运行时生成：app.db、uploads/（gitignore）
└─ Dockerfile / docker-compose.yml
```

---

## 4. 设计系统（像素对齐的依据）

### 4.1 颜色令牌（直接写进 `apps/web/src/styles/tokens.css`）

**浅色（`:root`）**
```css
:root{
  font-family: var(--font-sans); font-optical-sizing: auto; color-scheme: light;
  --font-sans: Inter, "Noto Sans SC", "PingFang SC", "Microsoft YaHei", ui-sans-serif, system-ui, sans-serif;
  --tw-ring-color:#0f172a14;
  --app-bg:#fafafb; --fg:#202624; --fg-2:#4b5550; --fg-3:#65706a; --fg-faint:#65706a;
  --surface:#fff; --surface-2:#f3f4f3; --hairline:#e2e6e3; --hover:#ecefed; --menu-bg:#fff;
  --accent:#237a50; --accent-rgb:35 122 80; --accent-soft:#eaf4ee; --accent-border:#b8d7c4;
  --accent-wash:linear-gradient(115deg,var(--accent-soft),var(--surface-2));
  --accent-art:linear-gradient(140deg,#8bab96,#507d64);
  --accent-gradient:linear-gradient(115deg,#288457,#20764c);
  --brand-gradient:linear-gradient(105deg,#246a48,#288457);
  --btn-solid-bg:#237a50; --btn-solid-bg-h:#1c6542; --btn-solid-fg:#fff;
  --panel-shadow:0 2px 8px #1d231e06,0 1px 2px #1d231e06;
  --feature-bg:linear-gradient(115deg,#f7faf8,#f0f6f2 58%,#eaf4ee);
  --tone-sage:#526d56; --tone-sage-soft:#e4ebe0; --tone-blue:#526b7b; --tone-blue-soft:#e5eaec;
  --tone-clay:#885b4c; --tone-clay-soft:#eee5de; --tone-sand:#796338; --tone-sand-soft:#ebe6d9;
  --status-success:#16734d; --status-warning:#8b5a13; --status-danger:#b62f4b; --status-info:#246b91;
  --chrome:#f6f6f4; --code-bg:#f0f2f1; --code-fg:#46524b;
}
```

**深色（`html.dark`）**
```css
html.dark{
  color-scheme:dark;
  --app-bg:#111; --fg:#e2e2e2; --fg-2:#c2c2c2; --fg-3:#a0a0a0; --fg-faint:#a0a0a0;
  --surface:#1a1a1a; --surface-2:#232323; --hairline:#363636; --hover:#2b2b2b; --menu-bg:#202020;
  --accent:#a1bca5; --accent-rgb:161 188 165; --accent-soft:#19261e; --accent-border:#405c49;
  --brand-gradient:linear-gradient(105deg,#b1c5b0,#a1bca5);
  --panel-shadow:0 2px 8px #0000001a;
  --feature-bg:linear-gradient(115deg,#191919,#141414 58%,#181818);
  --tone-sage:#a1b59f; --tone-sage-soft:#1d231e; --tone-blue:#a1b2b9; --tone-blue-soft:#1d2225;
  --tone-clay:#c3a995; --tone-clay-soft:#27211d; --tone-sand:#bcb18f; --tone-sand-soft:#27241c;
  --status-success:#8bc7aa; --status-warning:#dec58e; --status-danger:#e6a1ad; --status-info:#a1c6dc;
  --chrome:#161616; --code-bg:#151515; --code-fg:#bdbdbd;
  --btn-solid-bg:#496f54; --btn-solid-bg-h:#527c5e;
  --accent-gradient:linear-gradient(115deg,#496f54,#42684d);
}
/* 创作工作台布局下的深色覆写 */
html.dark body:has(.public-shell.workspace-layout){
  --accent:#99c3a8; --accent-rgb:153 195 168; --accent-soft:#18251d; --accent-border:#3b5344;
  --btn-solid-bg:#3d7353; --btn-solid-bg-h:#45815d; --code-bg:#1d1d1d; --code-fg:#b8b8b8;
}
```

### 4.2 版式与尺寸（已从参考站实测）

| 元素 | 数值 |
|---|---|
| body 字号 / 行高 | 14px / 1.65（23.1px） |
| 左侧栏 `.public-rail` | 宽 220px，背景 `var(--chrome)`，padding `16px 10px 10px`，右侧 1px `--hairline` 分隔线，可折叠 |
| 侧栏导航项 | 高 38px，padding `8px 10px`，圆角 7px，图标与文字间距 11px，字号 14px；hover `--hover`；激活态浅绿底 + `--accent` 文字 |
| 侧栏分组标题 | "创作工具 / 模型与 API / 运行记录"，12px，`--fg-3` |
| 侧栏底部 | 账户卡片：头像 28px 圆形 + 两行文字（"登录账户 / 开始创作"）+ 上箭头，点击弹出菜单 |
| 主内容 `.public-content` | padding `0 24px 72px` |
| 首页 H1 | 48px，字重 900，行高 1.17，字距 -1.5px，颜色深绿（`--brand-gradient` 文字或 `#1f3d2b` 量色核对） |
| 首页小标题（Eyebrow） | 全大写，字距约 4px，12px，`--fg-3` |
| 首页输入胶囊 | 白底大圆角（≈36px，完全胶囊形），阴影柔和；右侧"开始创作"按钮实心 `--btn-solid-bg`，胶囊形，高约 52px |
| 通用圆角 | 按钮/输入 7px，卡片 12–16px |
| 断点 | 479 / 480 / 600 / 639 / 640 / 767 / 768 / 1023 / 1024 / 1100 / 1199 / 1200 / 1280 / 1536 / 1600；**≤1023px 侧栏变抽屉** |
| 动画 | `boot-spin`（首屏加载圈）、`navigation-progress`（顶部路由进度条）、`spin`、`pulse`（骨架屏）、下拉菜单出现动画；遵守 `prefers-reduced-motion` |

> 表中未实测的值（标"≈"的）由负责该页面的 Agent 在参考站用 DevTools `getComputedStyle` 取准后回填本表。

### 4.3 主题切换
- `stores/theme.ts`：`light | dark | system`，存 localStorage，给 `<html>` 加/去 `dark` 类。
- 首屏前在 `index.html` 内联脚本先设置主题，避免闪烁。

---

## 5. 前端基础组件清单（`components/`）

| 组件 | 用途 |
|---|---|
| `AppIcon` | lucide 包装，统一 18px / 1.5 描边 |
| `BaseButton` | variant：solid / soft / ghost / outline；size：sm/md/lg；loading |
| `BaseInput` / `BaseTextarea` / `BaseSwitch` / `BaseCheckbox` | 表单 |
| `SelectMenu` | 自定义下拉（参考站有独立 `SelectMenu` 组件和出现动画） |
| `BaseModal` / `Drawer` / `Toast` / `ConfirmDialog` | 浮层 |
| `DataTable` | 后台通用表格：分页、排序、筛选、批量操作、空状态、骨架屏 |
| `FormSchema` | 后台通用表单：传 zod schema + 字段配置自动生成 |
| `ImageUploader` | 拖拽上传、预览、多图、大小限制 |
| `ModelHealthBadge` | 模型健康状态（正常/繁忙/故障）色点 |
| `ModelGroupFilter` | 模型分组筛选胶囊 |
| `ProviderLogo` | 按 `provider_group` 显示厂商图标（图标文件由后台上传） |
| `StatCard` | 统计数字卡（首页"已启用模型/已生成作品/平均耗时"、后台概览） |
| `MasonryGrid` | 作品精选瀑布流 |
| `RouteProgress` | 顶部路由加载进度条 |
| `BootLoader` | "正在加载…"首屏 |

---

## 6. 后端设计

### 6.1 数据库表（Drizzle，SQLite）

所有表带 `id`（TEXT，nanoid 或 uuid）、`created_at`、`updated_at`（ISO 字符串）。JSON 字段用 TEXT 存，Drizzle 用 `mode: 'json'`。

**站点与内容**
| 表 | 主要字段 |
|---|---|
| `site_settings` | `key` PK, `value` JSON。键：`title`、`subtitle`、`logo`、`favicon`、`avatar`、`media_cdn_url`、`contact`（qq/qq_link/qq_group/qq_group_link/email/shop/wechat/wechat_qr/phone/hours/note）、`cdk_redeem_enabled`、`register_enabled`、`default_credits`、`home_hero`（eyebrow/标题/副标题/输入框提示）、`footer`、`seo` |
| `showcase` | `kind`（`bento`=作品精选 / `inspiration`=灵感推荐）、`title`、`subtitle`、`prompt`、`image`、`image_url`、`gradient`、`span`（瀑布流占格）、`weight`（排序，大的在前）、`enabled` |
| `home_entries` | 首页四张入口卡：`title`、`desc`、`icon`、`link`、`weight` |
| `docs_pages` | `slug`、`title`、`category`、`content_md`、`weight`、`published` |
| `announcements` / `updates` | 更新日志：`title`、`content_md`、`published_at` |
| `apps` | 应用中心：`slug`、`name`、`desc`、`icon`、`status`（online/coming_soon）、`config` JSON |
| `skills` | 技能中心：`name`、`desc`、`prompt_template`、`model_id`、`cover`、`enabled` |

**模型与网关**（核心，后台配置 API 地址就在这里）
| 表 | 主要字段 |
|---|---|
| `channels`（上游渠道） | `name`、`provider_type`（openai / openai-image / gemini / flux / midjourney / custom-http …）、`base_url`、`api_key`（AES-GCM 加密存储）、`headers` JSON、`timeout_ms`、`max_concurrency`、`weight`、`enabled`、`proxy`、`last_check_at`、`last_check_ok`、`remark` |
| `model_groups` | `name`、`slug`、`icon`、`weight` |
| `models`（对应参考站 `managed-models`） | `id`（模型对外 ID，如 `gemini-nano-banana-2.1`）、`name`、`alias`、`compat_alias`、`description`、`icon`、`type`（image/video/text）、`provider`、`provider_group`、`group_id`、`enabled`、`studio_disabled`、`weight`、`ratios` JSON、`resolutions` JSON、`image_qualities` JSON、`durations` JSON、`image_to_image`、`max_reference_images`、`reference_mode`、`image_size_constraints` JSON、`capabilities` JSON、`prices` JSON（如 `{"1K":8,"2K":8,"4K":8}`）、`text_pricing` JSON、`thinking_supported`、`thinking_price`、`video_billing_mode`（per_second/per_request）、`generation_count` |
| `model_channels` | `model_id`、`channel_id`、`upstream_model`（上游真实模型名）、`param_mapping` JSON、`priority`、`weight`、`enabled` |
| `banned_words` | `word`、`match_type`（contains/regex）、`action`（block/warn）、`enabled` |
| `banned_word_hits` | `user_id`、`word`、`prompt`、`created_at` |

**用户与计费**
| 表 | 主要字段 |
|---|---|
| `users` | `email`、`username`、`password_hash`、`role`（user/admin）、`credits`（整数，单位：积分）、`status`、`invite_code`、`invited_by`、`team_id`、`last_login_at` |
| `sessions` | `user_id`、`token_hash`、`expires_at`、`ip`、`ua` |
| `api_keys` | `user_id`、`name`、`key_prefix`、`key_hash`、`allowed_models` JSON、`quota_limit`、`used`、`enabled`、`last_used_at` |
| `credit_ledger` | `user_id`、`delta`、`balance_after`、`reason`（generate/refund/recharge/cdk/admin/invite）、`ref_id`、`remark` |
| `orders` | `user_id`、`amount_cents`、`credits`、`channel`（预留支付渠道）、`status`、`paid_at`、`out_trade_no` |
| `recharge_plans` | `name`、`price_cents`、`credits`、`bonus`、`weight`、`enabled` |
| `cdks` | `code`、`credits`、`batch`、`used_by`、`used_at`、`expires_at` |
| `invites` | `inviter_id`、`invitee_id`、`reward_credits` |

**生成与日志**
| 表 | 主要字段 |
|---|---|
| `generations` | `user_id`、`api_key_id`、`source`（studio/api）、`model_id`、`channel_id`、`type`、`prompt`、`params` JSON（比例/分辨率/时长/质量…）、`reference_assets` JSON、`status`（queued/running/succeeded/failed/refunded）、`progress`、`result_assets` JSON、`error`、`cost_credits`、`elapsed_ms`、`started_at`、`finished_at`、`is_public` |
| `assets` | `user_id`、`path`、`thumb_path`、`mime`、`size`、`width`、`height`、`sha256` |
| `request_logs` | `user_id`、`api_key_id`、`route`、`model_id`、`channel_id`、`status_code`、`latency_ms`、`ip`、`error` |
| `stats_daily` | `date`、`model_id`、`count`、`success`、`fail`、`avg_elapsed_ms`、`credits` |
| `admin_audit` | `admin_id`、`action`、`target`、`diff` JSON |

**第二期（团队/代理商，先只建表不做页面）**：`teams`、`team_members`、`team_wallet_ledger`、`agents`、`agent_sites`（独立域名 + 品牌覆写）、`agent_commissions`、`agent_settlements`、`agent_payout_requests`、`agent_applications`。

### 6.2 接口设计

响应格式统一：成功 `{"data": ...}`（与参考站一致），失败 `{"error": {"code": "...", "message": "..."}}` + 对应 HTTP 状态码。列表接口 `{"data": [...], "total": n, "page": 1, "page_size": 20}`。

**公共（无需登录，路径与参考站保持一致）**
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/api/site`（参考 <https://img.junliai.org/admin/api/site>） | 站点配置（不含敏感字段） |
| GET | `/admin/api/stats`（参考 <https://img.junliai.org/admin/api/stats>） | `{avg_elapsed_ms, avg_elapsed_ms_24h, generated_count, generated_size_bytes, recent, refreshing, updated_at}` |
| GET | `/admin/api/managed-models`（参考 <https://img.junliai.org/admin/api/managed-models>） | 已启用模型列表（字段见 `models` 表，**不含渠道信息**） |
| GET | `/admin/api/model-groups` | 模型分组 |
| GET | `/admin/api/showcase`（参考 <https://img.junliai.org/admin/api/showcase>） | `{"data":{"bento":[...],"inspiration":[...]}}` |
| GET | `/admin/api/status` | 实时监控：各模型近 1h/24h 成功率、平均耗时、健康状态 |
| GET | `/admin/api/docs`、`/admin/api/docs/:slug` | 文档 |
| GET | `/admin/api/apps`、`/admin/api/skills`、`/admin/api/updates` | |

**认证**：`POST /api/auth/register`、`/login`、`/logout`、`GET /api/auth/me`、`POST /api/auth/password`

**用户**：`/api/user/generations`（创建/列表/详情/删除/公开）、`/api/user/assets`（上传参考图）、`/api/user/api-keys`、`/api/user/credit-ledger`、`/api/user/orders`、`/api/user/recharge`、`/api/user/cdk/redeem`、`/api/user/invite`、`GET /api/user/generations/:id/stream`（SSE 进度）

**管理后台**（`role=admin`，前缀 `/admin/api/manage/*`）：每个资源提供标准 CRUD：`GET list / GET :id / POST / PUT :id / DELETE :id`，另有：
- `POST /channels/:id/test`：用指定模型发一次探测请求，返回耗时与错误
- `POST /models/:id/test`：走完整网关链路生成一张测试图
- `POST /cdks/batch`：批量生成，`GET /cdks/export` 导出 CSV
- `POST /users/:id/credits`：手动加减积分（写 `credit_ledger` 与 `admin_audit`）
- `POST /uploads`：后台上传图片（Logo、展示图、二维码）
- `GET /overview`：今日/7日生成量、收入、新用户、失败率、渠道健康
- `POST /stats/refresh`：重算统计

**对外开放 API**（给用户用 API Key 调用，OpenAI 兼容风格）：
- `POST /v1/images/generations`、`POST /v1/images/edits`
- `POST /v1/videos/generations`、`GET /v1/videos/:id`
- `POST /v1/chat/completions`（文本，支持 stream）
- `GET /v1/models`

### 6.3 网关（上游适配器）设计

```
请求 → 鉴权（session / api key）→ 参数校验（按模型能力：比例、分辨率、参考图数量…）
     → 违禁词检查 → 计算价格并预扣积分（事务）→ 写 generations(queued)
     → 选择渠道（model_channels 中 enabled，按 priority 分层、层内按 weight 加权随机，跳过并发已满/近期失败熔断的渠道）
     → Adapter.invoke() → 失败可重试下一个渠道（最多 N 次，后台可配）
     → 成功：保存结果到 storage、生成缩略图、更新状态、累计 generation_count
     → 失败：退还积分（credit_ledger reason=refund）、记录错误
```

- `services/gateway/adapters/` 每个 `provider_type` 一个文件，实现统一接口：
  ```ts
  interface ProviderAdapter {
    type: string
    buildRequest(ctx: GenContext): { url: string; init: RequestInit }   // 用 channel.base_url + 模型映射
    parseResponse(res: Response, ctx: GenContext): Promise<GenResult>     // 返回图片 URL/base64、文本或异步任务 ID
    poll?(taskId: string, ctx: GenContext): Promise<GenResult | 'pending'> // 视频/MJ 等异步任务
  }
  ```
- 必做适配器：`openai`（chat + images）、`gemini`、`custom-http`（完全由后台配置：URL 模板、请求体模板（Handlebars 变量 `{{prompt}}`、`{{size}}`…）、响应 JSONPath 提取规则）。有了 `custom-http`，大部分新上游不用写代码即可在后台接入。
- 并发控制：每个渠道一个信号量（`max_concurrency`）；用户级并发限制在 `site_settings.concurrency` 里配置。
- 熔断：渠道连续失败 ≥ X 次，冷却 Y 秒（后台可配）。
- 健康状态：近 30 分钟成功率 ≥95% 显示"正常"，≥70% 显示"繁忙"，否则"故障"，提供给 `ModelHealthBadge` 和监控页。

### 6.4 安全
- 渠道 `api_key` 用 `APP_SECRET` 派生密钥做 AES-256-GCM 加密；后台列表只显示末 4 位。
- 首次启动若无管理员，从环境变量 `ADMIN_EMAIL/ADMIN_PASSWORD` 创建，或打印一次性初始化链接。
- 登录、注册、生成接口限流（`@fastify/rate-limit`）。
- 上传文件校验 MIME 与大小，文件名用哈希，禁止路径穿越。
- 所有后台写操作写 `admin_audit`。

---

## 7. 页面清单与规格

### 7.1 前台（第一期，像素级）

| 路由 | 参考网址 | 页面 | 要点 |
|---|---|---|---|
| `/` | <https://img.junliai.org/> | 首页 | 顺序：Eyebrow（站名全大写）→ 两行大标题"让想象，/抵达眼前。"（文案来自后台）→ 副标题 → 输入胶囊（左侧 sparkle 图标 + 两行占位提示，右侧"开始创作 →"按钮，点击带着输入内容跳 `/create?prompt=`）→ 提示行"进入创作页后，可以选择模型、尺寸和参考图。"→ 四张入口卡（图片创作/视频创作/文本创作/应用中心）→ 灵感推荐（横向卡片，"使用这段描述 →"，标题右侧"查看全部 →"）→ 作品精选（瀑布流 6 张，悬停显示"查看作品"）→ 新手引导"三步，完成你的第一张作品"（01/02/03 + "查看使用指南 →"）→ 统计条（已启用模型 / 已生成作品 / 平均生成耗时，数字带千分位）→ 底部"AI 创作与 API 接入"介绍 + 三个链接卡（模型广场 / 模型 API 文档 / 应用 API 文档） |
| `/create/:id?` | <https://img.junliai.org/create> | 创作工作台 | `workspace-layout`：左侧参数面板（类型切换 图片/视频/文本、模型选择 SelectMenu 带健康徽标与价格、比例、分辨率、质量、时长、参考图上传）、中间输入框与生成结果、右侧/下方历史记录；生成中显示进度，SSE 更新；结果可下载、复制提示词、再次生成、设为公开 |
| `/model-square` | <https://img.junliai.org/model-square> | 模型广场 | 顶部标题"选择适合你的 AI 模型"+说明 + 三个链接卡；分组筛选 `ModelGroupFilter`、类型 Tab、搜索；模型卡：厂商 Logo、名称、模型 ID（可复制）、能力标签、积分价格表、健康徽标 |
| `/docs/:slug*` | <https://img.junliai.org/docs> | 文档中心 | 左侧目录、正文 Markdown（代码块用 `--code-bg`，支持复制）、右侧本页目录；`/docs/models`（<https://img.junliai.org/docs/models>）、`/docs/apps`（<https://img.junliai.org/docs/apps>）两个入口 |
| `/status` | <https://img.junliai.org/status> | 实时监控 | 各模型健康状态卡、成功率、平均耗时、最近 24h 小时柱状图 |
| `/apps`、`/apps/:slug` | <https://img.junliai.org/apps><br><https://img.junliai.org/apps/image-to-prompt>（示例应用页） | 应用中心 | 卡片网格；未上线显示 coming-soon |
| `/skills` | <https://img.junliai.org/skills> | 技能中心 | 卡片网格，点击带模板跳创作页 |
| `/updates` | <https://img.junliai.org/updates> | 更新日志 | 时间线 |

### 7.2 用户中心（第一期，样式沿用设计系统，不强求像素级）
`/user`（概览：余额、近期作品，参考 <https://img.junliai.org/user>）、`/orders`、`/recharge`、`/api-keys`、`/credit-usage`、`/mylogs`、`/invite`、`/settings`、登录/注册弹窗或页面。
参考网址：<https://img.junliai.org/orders>、<https://img.junliai.org/recharge>、<https://img.junliai.org/api-keys>、<https://img.junliai.org/credit-usage>、<https://img.junliai.org/mylogs>、<https://img.junliai.org/invite>、<https://img.junliai.org/settings>（需登录后查看）。

### 7.3 管理后台 `/admin/*`

第一期（必须）：
| 路由 | 参考网址 | 功能 |
|---|---|---|
| `/admin/overview` | <https://img.junliai.org/admin/overview> | 数据概览：今日生成、成功率、收入、新用户、渠道健康、近 7 日折线图 |
| `/admin/config` | <https://img.junliai.org/admin/config> | 站点配置：标题、副标题、Logo、Favicon、CDN 地址、首页文案、联系方式、二维码、注册开关、新用户赠送积分、并发限制、重试/熔断参数 |
| `/admin/gateway` | <https://img.junliai.org/admin/gateway> | **上游渠道管理**：增删改、Base URL、API Key、类型、超时、并发、权重、启用、测试连通性 |
| `/admin/models` | <https://img.junliai.org/admin/models> | 模型管理：所有字段可视化编辑（比例/分辨率多选、价格按分辨率填写、能力 JSON 高级编辑）、绑定渠道及上游模型名、拖拽排序、单模型测试 |
| `/admin/showcase` | <https://img.junliai.org/admin/showcase> | 作品精选 / 灵感推荐管理：上传图片、标题、提示词、排序、启用；支持从生成记录一键加入 |
| `/admin/users` | <https://img.junliai.org/admin/users> | 用户列表、搜索、封禁、加减积分、重置密码 |
| `/admin/images` | <https://img.junliai.org/admin/images> | 全站生成记录：筛选、查看大图、删除、设为展示 |
| `/admin/logs` | <https://img.junliai.org/admin/logs> | 请求日志：按用户/模型/渠道/状态码筛选 |
| `/admin/billing` + `/admin/credit-usage` | <https://img.junliai.org/admin/billing><br><https://img.junliai.org/admin/credit-usage> | 充值套餐配置、积分流水 |
| `/admin/orders` | <https://img.junliai.org/admin/orders> | 订单列表 |
| `/admin/cdks` | <https://img.junliai.org/admin/cdks> | CDK 批量生成、导出、作废 |
| `/admin/banned-words` + `/admin/banned-word-hits` | <https://img.junliai.org/admin/banned-words><br><https://img.junliai.org/admin/banned-word-hits> | 违禁词与命中记录 |
| `/admin/docs/:id?` | <https://img.junliai.org/admin/docs> | 文档编辑（Markdown 编辑 + 预览） |
| `/admin/app-center`、`/admin/skills`、`/admin/updates` | <https://img.junliai.org/admin/app-center><br><https://img.junliai.org/admin/skills><br><https://img.junliai.org/admin/updates> | 内容管理 |
| `/admin/admin-key` | <https://img.junliai.org/admin/admin-key> | 管理员 API Key |

第二期：`/admin/concurrency`、`/admin/accounts`、`/admin/invites`、`/admin/agents`、`/admin/support`、`/admin/memory`、`/admin/tools`、`/admin/apps/*`，以及 `/team/*`、`/agent/*` 全部页面。

> 后台页面需管理员登录才能访问参考站；无权限时按本表功能描述自行设计，样式沿用设计系统。

后台布局：左侧分组菜单（概览 / 站点 / 模型与网关 / 用户与计费 / 内容 / 日志），顶部面包屑 + 主题切换 + 返回前台。

---

## 8. 像素级验收方法

1. `apps/web/e2e/visual/`：对每个第一期前台页面，用 Playwright 在 1440×900、1024×768、390×844 三个视口截图。
2. 参考图由 Agent 从参考站截取后存入 `docs/ref/`（只用于本地对比，**不提交、不使用其中的图片素材**）；对比时把展示图区域用纯色遮罩（`mask` 选项），只比较布局、字体、颜色、间距。
3. 用 `pixelmatch` 比较，非遮罩区域差异像素 ≤ 0.5% 视为通过；不通过时输出 diff 图到 `e2e/__diff__/`。
4. 同时用脚本比较关键元素的 `getComputedStyle`（字号、字重、行高、内边距、圆角、颜色），输出差异表。
5. 深色模式单独再跑一遍。

---

## 9. 任务拆分（按顺序，可并行的已标注）

| # | 任务 | 参考网址 | 依赖 | 可并行 | 完成标准 |
|---|---|---|---|---|---|
| T1 | Monorepo 脚手架：pnpm workspace、TS、ESLint/Prettier、Vitest、Playwright、Dockerfile | — | — | — | `pnpm dev` 同时起前后端；`pnpm build` 产出单进程可运行包 |
| T2 | 数据库：Drizzle schema（第 6.1 节全部第一期表）、迁移、seed（管理员、占位站点配置、3 个示例渠道、5 个示例模型、6 条占位展示） | — | T1 | 与 T3 并行 | `pnpm db:migrate && pnpm db:seed` 成功，单测覆盖 |
| T3 | 设计系统：tokens.css、base.css、第 5 节基础组件、主题切换、PublicShell 侧栏布局（含折叠、移动端抽屉、底部账户菜单） | <https://img.junliai.org/>（侧栏） | T1 | 与 T2 并行 | 组件演示页 `/dev/components`；侧栏与参考站像素对比通过 |
| T4 | 后端基础：Fastify 插件（错误处理、session 认证、限流、上传、静态托管）+ 认证接口 + 公共接口（6.2 公共部分） | <https://img.junliai.org/admin/api/site> 等 4 个接口 | T2 | 与 T5 并行 | 接口测试通过；返回字段与参考站 `site/stats/managed-models/showcase` 同名同结构 |
| T5 | 首页像素级复刻 | <https://img.junliai.org/> | T3（数据接口可先 mock） | 与 T4 并行 | 第 8 节视觉对比通过（三视口 + 深色） |
| T6 | 管理后台框架 + 站点配置 + 渠道管理 + 模型管理 + 展示管理 | <https://img.junliai.org/admin/config><br><https://img.junliai.org/admin/gateway><br><https://img.junliai.org/admin/models><br><https://img.junliai.org/admin/showcase> | T4, T3 | — | 后台改配置后前台实时生效；渠道测试按钮可用 |
| T7 | 网关：适配器接口、openai / gemini / custom-http 三个适配器、渠道选择、并发、熔断、重试、计费预扣与退款、SSE 进度 | — | T4 | 与 T6 并行 | 用本地 mock 上游（`apps/server/test/mock-upstream`）跑通成功、失败重试、全部失败退款三种场景 |
| T8 | 创作工作台 `/create` | <https://img.junliai.org/create> | T5, T7 | — | 能选模型、传参考图、生成、看历史；视觉对比通过 |
| T9 | 模型广场、文档中心、实时监控、应用中心、技能中心、更新日志 | <https://img.junliai.org/model-square><br><https://img.junliai.org/docs><br><https://img.junliai.org/status><br><https://img.junliai.org/apps><br><https://img.junliai.org/skills><br><https://img.junliai.org/updates> | T4, T3 | 各页面可互相并行 | 每页视觉对比通过 |
| T10 | 用户中心：概览、API Key、积分明细、订单、充值（支付先留接口，后台手动确认）、CDK 兑换、邀请、设置 | <https://img.junliai.org/user> | T4 | 与 T9 并行 | E2E 覆盖注册→兑换 CDK→生成→查看流水 |
| T11 | 对外 API `/v1/*` + 文档页里的调用示例 | <https://img.junliai.org/docs/models> | T7, T10 | — | 用 curl 和 OpenAI SDK 调通 |
| T12 | 后台其余第一期页面：用户、生成记录、日志、计费、订单、CDK、违禁词、文档/应用/技能/更新内容管理、概览 | 见第 7.3 节 | T6 | 各页可并行 | 每页 CRUD 的 E2E |
| T13 | 收尾：Docker 部署、备份脚本（SQLite `.backup` 定时）、README、性能检查（首屏 JS ≤ 200KB gzip、Lighthouse ≥ 90） | — | 全部 | — | `docker compose up` 一键可用 |
| T14（二期） | 团队、代理商分站、支付渠道接入 | — | T13 | — | 另出方案 |

---

## 10. 环境变量

```
PORT=3000
APP_SECRET=            # 32 字节以上，用于加密渠道 Key 与 session
DATA_DIR=./data        # SQLite 文件和上传目录
ADMIN_EMAIL=
ADMIN_PASSWORD=
PUBLIC_BASE_URL=       # 生成结果的外链前缀，可被后台 media_cdn_url 覆盖
```

---

## 附录 A：参考站完整路由（用于对照，不要求全部实现）

以下路由均以 `https://img.junliai.org` 为前缀，例如 `/model-square` → <https://img.junliai.org/model-square>。

前台：`/`、`/home`、`/create/:id?`、`/skills`、`/apps`、`/apps/{chatgpt-recharge,chatgpt-refund,text-repair,image-to-prompt,midjourney,coming-soon}`、`/model-square`、`/models`、`/video-models`、`/docs/:slug*`、`/status`、`/updates`、`/about`、`/playground`、`/integrations/infinite-canvas`、`/canvas-legacy`、`/desktop/authorize`

用户：`/user`、`/overview`、`/orders`、`/recharge`、`/api-keys`、`/credit-usage`、`/logs`、`/mylogs`、`/invite`、`/memory`、`/settings`、`/files`、`/agent-apply`、`/novel-account`、`/pose-costume-account`、`/canvas-account`

团队：`/team`、`/team/{overview,members,wallet,billing,activity,settings}`、`/team/join/:id`、`/team/handover/:id`、`/team-invitation`

代理商：`/agent`、`/agent/{site,domains,overview,downlines,customers,promotion,wallet,commissions,settlements,resources,payout-requests,applications}`

管理后台：`/admin`、`/admin/{overview,gateway,billing,credit-usage,models,accounts,users,concurrency,banned-words,banned-word-hits,orders,cdks,invites,agents,images,showcase,logs,updates,support,memory,admin-key,config,app-center,skills,tools}`、`/admin/docs/:id?`、`/admin/apps/{chatgpt-recharge,chatgpt-refund,novel,text-repair}`

## 附录 B：参考站 `managed-models` 单条示例结构（字段对齐用）

来源：<https://img.junliai.org/admin/api/managed-models>

```json
{
  "id": "gemini-nano-banana-2.1",
  "name": "gemini-nano-banana-2.1",
  "alias": "", "compat_alias": "", "description": "…", "icon": "",
  "type": "image", "provider": "custom", "provider_group": "gemini",
  "group_id": "uuid", "enabled": true, "studio_disabled": false, "weight": 40,
  "ratios": ["1:1","16:9","9:16","3:2","3:4","21:9"],
  "resolutions": ["1K","2K","4K"], "image_qualities": [], "durations": [],
  "image_to_image": true, "max_reference_images": 10, "reference_mode": "asset",
  "image_size_constraints": null,
  "capabilities": {},
  "prices": {"1K": 8, "2K": 8, "4K": 8},
  "text_pricing": {}, "thinking_supported": false, "thinking_price": 0,
  "video_billing_mode": "per_second",
  "generation_count": 0,
  "created_at": "…", "updated_at": "…"
}
```

视频模型的 `capabilities` 示例字段：`asset_image_field`、`audio_field`、`audio_requires_visual`、`duration_control`（slider）、`max_reference_audio_bytes`、`max_reference_audio_total_seconds`、`max_reference_audios`、`max_reference_image_bytes`、`max_reference_images`、`max_reference_videos`、`output_audio`、`reference_modes`。
