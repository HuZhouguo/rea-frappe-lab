# reimpl — Frappe Books 凭证草稿持久化链路复现件

零依赖（Node ≥ 22，使用内置 `node:sqlite`），复现 `app.asar` 中
「表单录入草稿 → IPC → 主进程 → SQLite」的完整链路。

对应关系与背景见上一级目录的 `REPORT.md`。

## 运行

```bash
node run.js                 # SQLite 用 :memory:
node run.js /tmp/jv.db      # 落盘
node inspect.js /tmp/jv.db  # 用独立连接 dump 各表 + JournalEntry DDL
```

`run.js` 是“主进程”（持有 `ipcMain` 与 SQLite），`renderer.js` 跑在 worker 线程里充当
“渲染进程”。两者之间是真的 `MessageChannel`，所以数据必须通过结构化克隆 —— 这正是
`fyo/core/converter.ts` 必须把 `Pesa` / `Date` / 附件压平的原因。

## 文件对应

| 文件 | 还原的原始模块 |
| --- | --- |
| `schema.js` | `schemas/schemas.ts`（`addMetaFields` / `addNameField` / `NAME_FIELD`） |
| `converter.js` | `fyo/core/converter.ts` |
| `luxon-lite.js` | 渲染包内联的 luxon（仅用到的 4 个方法） |
| `core.js` | `backend/database/core.ts` |
| `db-manager.js` | `backend/database/manager.ts`（`databaseMethodSet` 白名单） |
| `main-process.js` | `main/registerIpcMainActionListeners.ts` + `getErrorHandledReponse` |
| `preload.js` | `main/preload.ts` 的 `db` 命名空间 |
| `ipc.js` | Electron `ipcMain` / `ipcRenderer` 的最小替代 |
| `db-handler.js` | `fyo/demux/db.ts` + `fyo/core/dbHandler.ts` |
| `draft-doc.js` | `fyo/model/doc.ts` + `naming.ts` + `NumberSeries.ts` + `getDocStatus` |
| `renderer.js` | 表单侧驱动脚本 |
| `run.js` | 主进程入口 |

## 与真实实现的差异（仅限不影响语义的部分）

- `knex` + `better-sqlite3` → `node:sqlite`；SQL 语句与列类型保持等价
  （含 `Currency → text`、`Check → boolean`）。
- `luxon` 只实现 `fromISO` / `fromJSDate` / `toISODate` / `toJSDate`。
- `Pesa` 只实现 `store` / `copy` / `valueOf`。
- 省略了 `#getCreateAlterList` 迁移、patches、`SingleValue` 初始化、自定义字段。
- 复现件只注册本链路用到的 4 个通道：`db-schema` / `db-connect` / `db-call` / `db-bespoke`。
