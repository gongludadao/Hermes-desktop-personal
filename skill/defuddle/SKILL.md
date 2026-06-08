---
name: defuddle
description: 使用 Defuddle CLI 从网页提取干净的 Markdown 内容，去除杂乱内容和导航栏以节省 token。当用户提供 URL 进行阅读或分析时优先使用（在线文档、文章、博客或其他标准网页）。不要用于以 .md 结尾的 URL——那些已经是 Markdown，直接使用 WebFetch。
---
# Defuddle
使用 Defuddle CLI 从网页提取干净可读的内容。标准网页优于 WebFetch —— 它移除导航、广告和杂乱内容，减少 token 用量。
如未安装：`npm install -g defuddle`
## 使用方法
始终使用 `--md` 获取 Markdown 输出：
```bash
defuddle parse <url> --md
```
保存到文件：
```bash
defuddle parse <url> --md -o content.md
```
提取特定元数据：
```bash
defuddle parse <url> -p title
defuddle parse <url> -p description
defuddle parse <url> -p domain
```
## 输出格式
| 标志 | 格式 |
|------|--------|
| `--md` | Markdown（默认选择） |
| `--json` | JSON 包含 HTML 和 Markdown |
| （无） | HTML |
| `-p <名称>` | 特定元数据属性 |
