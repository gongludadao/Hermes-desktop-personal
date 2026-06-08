---
name: desktop-data
description: "桌面端数据服务 - 直接操作 Obsidian 知识库、股票、笔记、剪贴板、项目、项目文件夹。"
version: 1.0.0
metadata:
  hermes:
    tags: [stock, notepad, clipboard, project, obsidian]
---

# 桌面端数据服务

## 使用场景说明

**项目/项目文件夹操作** → 文件操作
   配置：`C:/Users/13213/AppData/Local/hermes/desktop/cache/project_index.json`
- **知识库/笔记库/Obsidian** → 操作 `.md` 文件  
  配置：`C:/Users/13213/AppData/Local/hermes/desktop/cache/obsidian_config.json`
  
- **股票/行情/自选股** → 查询自选股行情数据  
  配置：`C:/Users/13213/AppData/Local/hermes/desktop/cache/stock_config.json`
  
- **笔记/记事本** → 读写本地记事本  
  配置：`C:/Users/13213/AppData/Local/hermes/desktop/cache/notepad_index.json`
  
- **剪贴板/复制记录** → 查看复制历史记录  
  配置：`C:/Users/13213/AppData/Local/hermes/desktop/cache/clipboard_cache.json`

**Vault 路径配置**：从 `C:/Users/13213/AppData/Local/hermes/desktop/cache/obsidian_config.json` 读取 `active_vault` 字段。

## 参考技能

- [obsidian-markdown](./obsidian-markdown/SKILL.md) - Markdown 语法
- [obsidian-bases](./obsidian-bases/SKILL.md) - Bases 视图
- [json-canvas](./json-canvas/SKILL.md) - Canvas 画布
