# Hermes Desktop UI

Hermes Agent 桌面界面模块，基于 pywebview 封装 Web Dashboard，并提供覆盖层、侧边栏、本地向量搜索等功能。

## 启动方式

文件夹放在 Hermes 根目录下，执行：

```bash
python desktop_ui.py
# 可选参数
python desktop_ui.py --port 9119 --lang zh --width 1200 --height 800
```

启动后自动打开桌面窗口，Web UI 监听 `http://127.0.0.1:9119`。

## 功能模块

### 界面层（JS）

- **聊天覆盖层** (`_chat_overlay.js`) - 主界面框架、AutoKB 自动知识库注入
- **编辑器面板** (`_editor_panel.js`) - 代码编辑和预览
- **文件管理器** (`_file_manager.js`) - 项目文件浏览
- **记事本** (`_notepad.js`) - 快速笔记
- **剪贴板翻译** (`_clipboard_translate.js`) - 剪贴板内容翻译
- **股票侧边栏** (`_stock_sidebar.js`) - 股票行情查看
- **Obsidian仓库** (`_obsidian_vault.js`) - Obsidian 笔记集成

### RPC 后端（Python）

- **`_rpc_fs.py`** - 文件系统操作（读/写/列表）
- **`_rpc_embedding.py`** - 本地向量搜索（Qwen3-Embedding + 分块索引）
- **`_rpc_notepad.py`** - 记事本数据管理
- **`_rpc_obsidian.py`** - Obsidian vault 操作
- **`_rpc_stock.py`** - 股票数据查询
- **`_rpc_config.py`** - 配置管理

## 向量搜索（Embedding）

基于 `Qwen/Qwen3-Embedding-0.6B` 本地模型实现语义搜索，支持：

- **分块索引**：长文件按段落切成多个 chunk（约 1200 字符/块），每个 chunk 单独算 embedding
- **片段注入**：搜索时返回匹配的 chunk 内容，直接注入 AI 上下文（而非整个文件）
- **自适应 batch**：根据 GPU 显存自动调整 batch_size，OOM 时自动降级
- **内存缓存**：索引加载到内存，numpy 矩阵运算加速相似度计算
- **自动更新**：每 5 分钟检查文件变化，后台增量更新索引
- **DirectML 加速**：支持 NVIDIA/AMD/Intel GPU（Windows）

### 索引存储

索引文件位于 `cache/embeddings/vault_index.json`，包含：
- 每个 chunk 的 embedding 向量（1024 维）
- chunk 文本内容、字符位置、文件元数据
- 索引版本号（v2 = 分块索引格式）

## 依赖

### 必需

- fastapi
- uvicorn[standard]
- starlette
- pywebview
- websockets

### 向量搜索（可选）

- numpy
- torch
- transformers
- torch-directml（Windows GPU 加速，可选）

缺失时启动会自动通过 `uv pip` 或 `pip` 安装。

## 技能（Skills）

`skill/` 目录包含可被 Hermes Agent 调用的技能定义，启动时自动同步到 `skills/desktop/`。

## 支持的语言

zh, en, zh-hant, ja, de, es, fr, tr, uk, af, ko, it, ga, pt, ru, hu
