# Wiki Main 文件夹智能处理方案

## 概述

监控 `C:\Users\13213\.openclaw\wiki\main` 文件夹变化，自动将新文件内容发送给 AI（独立会话），**让 AI 自主分析并调用工具**整理到 Obsidian 知识库对应分类目录中。

---

## 核心流程

```
[监控 main 文件夹] → [检测到文件变化] → [发送给 AI 独立会话] 
    ↓
[AI 自主分析 + 调用工具处理] → [保存到对应知识库目录]
```

---

## 任务指令

```text
【文件整理任务】

这是一个需要整理到 Obsidian 知识库的文件。请读取文件内容，分析后决定如何整理。

文件路径：{file_path}
文件内容：
{content}

请按以下步骤处理：

1. 分析文件内容，理解主题和用途
2. 决定应该保存到知识库的哪个分类目录：
   - 02-项目/{项目名称}/ - 项目相关文档
   - 03-领域/{领域}/ - 学习/工作/生活/技术/财务 等
   - 04-资源/ - 参考资料
   - 05-归档/ - 其他需要归档的内容

3. 生成一个新的 Markdown 文件，包含：
   - 清晰的标题
   - 提取的核心内容（去掉冗余信息）
   - 关键词标签
   - 原文件来源说明

4. 使用 write_file 工具保存到合适的目录

注意：
- 原文件不要删除，保留在 main 目录
- 新文件名可以使用原文件名或根据内容重新命名
```

---

## 分类规则

| 分类 | 目标文件夹 |
|------|-----------|
| 项目 | `02-项目/{项目名称}/` |
| 学习/工作/生活/技术/财务 | `03-领域/{领域}/` |
| 资源 | `04-资源/` |
| 归档 | `05-归档/` |

---

## 技术实现

### AI 调用方式

```python
from run_agent import AIAgent

agent = AIAgent(
    model="deepseek-r1:1.5b",
    provider="ollama",
    base_url="http://127.0.0.1:11434",
    max_iterations=1,
    skip_context_files=True,
    skip_memory=True,
    session_id="wiki-main-processor",
)
response = agent.chat(message)
```

### 模块划分

```
organizer-main/
├── __init__.py
├── monitor.py           # 文件监控
├── processor.py         # 主处理器
├── ai_client.py         # AI 会话客户端
└── config.yaml
```

---

## 下一步

1. 创建目录结构
2. 实现 monitor.py
3. 实现 ai_client.py
4. 实现 processor.py
5. 配置 RPC 接口
6. 测试验证
