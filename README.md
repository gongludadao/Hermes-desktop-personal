# Hermes Desktop UI

Hermes Agent 桌面界面模块，提供覆盖层和侧边栏功能。

## 功能模块

- **聊天覆盖层** (`_chat_overlay.js`) - 主界面框架
- **编辑器面板** (`_editor_panel.js`) - 代码编辑和预览
- **文件管理器** (`_file_manager.js`) - 项目文件浏览
- **记事本** (`_notepad.js`) - 快速笔记
- **剪贴板翻译** (`_clipboard_translate.js`) - 剪贴板内容翻译
- **股票侧边栏** (`_stock_sidebar.js`) - 股票行情查看
- **Obsidian仓库** (`_obsidian_vault.js`) - Obsidian笔记集成

## 启动方式
文件夹放Hermes根目录下，执行desktop_ui.py

## 依赖

- fastapi
- uvicorn
- starlette
- pywebview
- websockets
