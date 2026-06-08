---
name: desktop-data
description: "桌面端数据服务 - 侧边栏/自选股行情/笔记/项目文件/剪贴板。用户提到侧边栏、股票、行情、自选股、笔记、记事本、文件管理、项目结构、剪贴板、复制记录等时，用read_file读取: C:\\Users\\13213\\AppData\\Local\\hermes\\desktop\\cache\\stock_config.json(自选股) notepad_index.json(笔记) project_index.json(项目) clipboard_cache.json(剪贴板)"
version: 1.7.0
author: Hermes Desktop
license: MIT
platforms: [windows, linux, macos]
metadata:
  hermes:
    tags: [desktop, sidebar, stocks, watchlist, notes, clipboard, file-manager, self-data, 侧边栏, 自选股, 行情, 笔记, 记事本, 剪贴板, 项目, 文件管理, stock, notepad, clipboard, project]
    related_skills: [china-stock-analysis, stock-financial-analysis]
---

# 桌面端数据服务

用户运行了 Hermes 桌面端，数据存在本地缓存文件里。当用户提到以下任何内容时，**直接用 `read_file` 读对应的文件**，不要用 execute_code，不要猜路径：

- **股票/行情/自选股/涨跌/盈亏** → 读自选股缓存
- **笔记/记事本/备忘** → 读笔记缓存
- **项目/文件/目录/代码结构** → 读项目缓存
- **剪贴板/复制记录/粘贴** → 读剪贴板缓存

## 自选股

```
read_file("C:\\Users\\13213\\AppData\\Local\\hermes\\desktop\\cache\\stock_config.json")
```

JSON 含：
- `stockWatch`：代码数组，如 `["600519", "601868", "000001"]`
- `stockCache`：每只股票的完整行情，字段如下：
  - 基础：code, name, price, change, changePercent
  - 扩展行情：yesterdayClose(昨收), todayOpen(今开), high(最高), low(最低), amplitude(振幅%), averagePrice(均价), limitUp(涨停价), limitDown(跌停价)
  - 成交：volume(成交量/手), turnover(成交额/万), outerVolume(外盘), innerVolume(内盘), turnoverRate(换手率%), volumeRatio(量比), bidRatio(委比%)
  - 估值：peDynamic(市盈率动), peStatic(市盈率静), pb(市净率), totalMarketCap(总市值/亿), circulatingMarketCap(流通市值/亿)
  - 多周期：weekChange, monthChange, quarterChange, halfYearChange, yearChange(涨跌幅%), week52High, week52Low
  - 五档盘口：bidAsk.sell1~sell5, bidAsk.buy1~buy5（各有 price 和 volume）
  - 其他：type(品种), currency(币种), dataTime(数据时间)
- `stockThresholds`：每只股的 buy_price(买入价), lots(手数), sell_target(卖价预警), low_alert(止损价)

读完用表格展示。有 buy_price 时计算盈亏：盈亏 = (当前价 - 买入价) × 手数 × 100

## 记事本

```
read_file("C:\\Users\\13213\\AppData\\Local\\hermes\\desktop\\cache\\notepad_index.json")
```

JSON 含 `notes` 数组，每项有 id/title/mtime/size。读完列出笔记标题和修改时间。读笔记内容用 `read_file("C:\\Users\\13213\\AppData\\Local\\hermes\\desktop\\notepad\\{title}.md")`。

## 文件管理器

```
read_file("C:\\Users\\13213\\AppData\\Local\\hermes\\desktop\\cache\\project_index.json")
```

JSON 含 `projectRoot`（项目根路径）和递归目录树 `items`（每项有 name/is_dir/size/children）。读完列出目录结构。

## 剪贴板

```
read_file("C:\\Users\\13213\\AppData\\Local\\hermes\\desktop\\cache\\clipboard_cache.json")
```

JSON 含 `history` 数组，每项有 preview（前200字）和 time。读完列出最近的复制记录。

## 禁止事项

- 禁止回复"我没有访问权限"或"需要提供股票代码"
- 禁止猜路径，路径已给出

## 故障排除

### read_file 失败时的 fallback

在 Windows 环境下，`read_file` 可能因终端 cwd=null 问题报错"文件不存在"，即使文件实际存在。

**fallback 方案**：用 `execute_code` + Python 直接读取：

```python
import json
with open(r"C:\Users\13213\AppData\Local\hermes\desktop\cache\stock_config.json", "r", encoding="utf-8") as f:
    data = json.load(f)
```

这不是"绕路"，是环境限制下的标准后备方案。先试 `read_file`，失败立刻切 `execute_code`，别反复报错。
