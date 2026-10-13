# Frappe Books 逆向工程实验：凭证草稿持久化链路

> 一份静态逆向实验：从 Electron 打包产物 `app.asar` 出发，完整还原「会计凭证草稿 → SQLite 持久化」链路，并通过独立重实现验证逆向结论。

---

## 这是什么

本项目是对 [Frappe Books](https://github.com/frappe/books) 0.36.0 打包产物 `app.asar` 的一次静态逆向工程实验。**目标不是重建 Frappe Books**，而是回答一个具体问题：

**「会计凭证草稿在本地是如何持久化的？」**

实验全程只对 `app.asar` 做静态分析，未查阅 Frappe Books 的 GitHub 源码（实验结束后才用源码做最终核验）。

---

## 核心发现

**Frappe Books 没有独立的「草稿自动保存」子系统。**

- 主进程（`main.js`）里完全没有 `draft` 相关标识符
- 界面上的「Draft」徽标来自内存标志位：`notInserted=true` 或 `submitted=0`
- 草稿落盘走的是和已提交单据完全相同的 IPC 链路：`doc.sync()` → `db-call` → 主进程 → SQLite
- 没有自动保存 —— 用户必须显点 Save，未保存的草稿只存在于内存，重启即失

详见 [REPORT.md](REPORT.md)（完整时序图、IPC 契约、数据结构）。

---

## 实验方法

| 步骤 | 操作 | 产物 |
|---|---|---|
| 1 | `asar extract` 解包 | `extracted/main.js`、`preload.js`、渲染层 JS + 源映射 |
| 2 | 解析 `.js.map` 内嵌 `sourcesContent` | `recovered/` 348 个原始 TS/Vue 文件 |
| 3 | 正则扫描 `ipcMain.handle` + preload 常量注释 | 34 个 IPC 通道清单 |
| 4 | 用源码写出可运行复现件 | `reimpl/` 2,347 行零依赖 JS |
| 5 | 用原始源码逐条核验结论 | 见 [COMPARISON_REPORT.md](COMPARISON_REPORT.md) |

---

## 实验结果

### 源文件恢复精度

| 指标 | 数值 |
|---|---|
| 还原文件数 | 348 |
| 与源码逐字节一致 | **347 / 348 (99.71%)** |
| 差异 | 1 个 SVG（Vite 构建产物，非源码本身） |

### 行为结论核验（4 条全部通过）

- ✅ 主进程无 `draft` 标识符
- ✅ Draft 状态来自 `notInserted`/`submitted=0` 内存标志位
- ✅ 无自动保存钩子（`beforeunload` / `beforeRouteLeave` 零命中）
- ✅ 草稿落盘走通用 `db-call` IPC 链路

### 重实现验证

`reimpl/` 用 Node 内置 `node:sqlite` + `worker_threads.MessageChannel` 复现了完整的进程边界与结构化克隆约束，一次跑通，SQLite 产出结构与原程序一致。

详见 [COMPARISON_REPORT.md](COMPARISON_REPORT.md)。

---

## 目录结构

```
.
├── app.asar                    # 实验对象（Frappe Books 0.36.0 打包产物）
├── extracted/                  # asar 解包产物
│   ├── main.js                 # 主进程（2.9 MB，已反混淆但无源映射内容）
│   ├── main.js.map             # 主进程源映射（有 sources 清单，无 sourcesContent）
│   ├── main/preload.js         # preload 脚本
│   ├── src/assets/*.js.map     # 渲染层源映射（含完整 sourcesContent）
│   └── ...
├── recovered/                  # 源映射还原的渲染层源码（348 文件）
│   └── renderer/               # 目录结构与原始 fyo/、src/、models/ 等一致
├── reimpl/                     # 零依赖 JS 重实现（14 文件，2,347 行）
│   ├── run.js                  # 主进程入口
│   ├── renderer.js             # 渲染进程（worker 线程）
│   └── ...
├── REPORT.md                   # 逆向分析报告（652 行，含 Mermaid 时序图）
└── COMPARISON_REPORT.md        # 最终对比报告（含定量核验与评级）
```

---

## 如何运行

```bash
# 1. 重实现验证（无需额外依赖，Node ≥ 22）
cd reimpl
node run.js                    # SQLite 用 :memory:
node run.js /tmp/jv.db         # 落盘，可用任意 SQLite 客户端检查
node inspect.js /tmp/jv.db     # 独立连接 dump 各表 + JournalEntry DDL

# 2. 核验恢复精度（需要原始源码做对照）
# 见 COMPARISON_REPORT.md §1
```

---

## 覆盖范围与局限

### 已覆盖

- IPC 通道全量枚举（34 个）
- `db-call` 白名单机制与写链路完整时序
- Schema 装配、数据类型转换规则
- 子表 upsert 语义（`parent` 覆写、`#runDeleteOtherChildren`）
- 编号生成（`NumberSeries.next()` + 撞号自增）
- SQLite 存储路径、连接参数、DDL 生成规则
- 保存触发点（Save 按钮 / Ctrl+S / 程序化调用）
- 乐观锁并发检查

### 未覆盖（超出本次实验范围）

- 数据库迁移/补丁流程
- ERPNext 同步队列
- 自定义字段、SingleValue 初始化
- 报表、打印、POS 等模块

### 诚实说明

- **主进程无 `sourcesContent`**：主进程结论来自反混淆代码 + 源清单交叉验证，未做源码级比对
- **重实现不是原代码的翻译**：是理解后的独立实现，语义等价但代码不同
- **实验只针对 0.36.0 版本**：其他版本可能有不同行为

---

## 关于原始源码

本实验的对照组是 Frappe Books 0.36.0（[GitHub](https://github.com/frappe/books)），AGPL-3.0-only 协议。本仓库中的 `recovered/` 目录是从 `app.asar` 的 `.js.map` 内嵌 `sourcesContent` 还原的渲染层源码，仅用于验证逆向精度，**不代表 Frappe Books 官方发布**。

---

## 协议

本实验的代码产物（`reimpl/`）为 MIT 协议。

`app.asar` 属于 Frappe Books，遵循 AGPL-3.0-only。`recovered/` 目录为逆向还原的 Frappe Books 源码片段，版权归原开发者所有。本仓库仅用于学术研究目的。
