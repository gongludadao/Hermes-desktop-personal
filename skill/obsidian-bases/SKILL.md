---
name: obsidian-bases
description: 创建和编辑 Obsidian Bases（.base 文件）包含视图、筛选器、公式和汇总。在处理 .base 文件、创建类数据库的笔记视图时，或用户提到 Bases、表格视图、卡片视图、筛选器或 Obsidian 中的公式时使用。
---

# Obsidian Bases 技能

## 工作流程

1. **创建文件**：在 vault 中创建包含有效 YAML 内容的 `.base` 文件
2. **定义范围**：添加 `filters` 选择哪些笔记出现（按标签、文件夹、属性或日期）
3. **添加公式**（可选）：在 `formulas` 部分定义计算属性
4. **配置视图**：添加一个或多个视图（`table`、`cards`、`list` 或 `map`），用 `order` 指定要显示的属性
5. **验证**：确认文件是有效的 YAML 无语法错误。检查所有引用的属性和公式是否存在。常见问题：未引用的特殊 YAML 字符字符串、公式表达式中不匹配的引号、引用了 `formula.X` 但 `formulas` 中未定义 `X`
6. **在 Obsidian 中测试**：在 Obsidian 中打开 `.base` 文件确认视图正确渲染。如果显示 YAML 错误，检查引用规则如下

## Schema

Bases 文件使用 `.base` 扩展名并包含有效 YAML。

```yaml
# 全局筛选器应用于 base 中的所有视图
filters:
 # 可以是单个筛选器字符串
 # 或递归筛选器对象 with and/or/not
 and: []
 or: []
 not: []

# 定义可在所有视图中使用的公式属性
formulas:
 formula_name: 'expression'

# 配置属性的显示名称和设置
properties:
 property_name:
 displayName: "显示名称"
 formula.formula_name:
 displayName: "公式显示名称"
 file.ext:
 displayName: "扩展名"

# 定义自定义汇总公式
summaries:
 custom_summary_name: 'values.mean().round(3)'

# 定义一个或多个视图
views:
 - type: table | cards | list | map
 name: "视图名称"
 limit: 10 # 可选：限制结果数量
 groupBy: # 可选：分组结果
 property: property_name
 direction: ASC | DESC
 filters: # 视图特定的筛选器
 and: []
 order: # 按顺序显示的属性
 - file.name
 - property_name
 - formula.formula_name
 summaries: # 将属性映射到汇总公式
 property_name: Average
```

## 筛选器语法

筛选器缩小结果范围。可全局应用或每个视图单独应用。

### 筛选器结构

```yaml
# 单个筛选器
filters: 'status == "done"'

# AND - 所有条件必须为真
filters:
 and:
 - 'status == "done"'
 - 'priority > 3'

# OR - 任意条件可为真
filters:
 or:
 - 'file.hasTag("book")'
 - 'file.hasTag("article")'

# NOT - 排除匹配项
filters:
 not:
 - 'file.hasTag("archived")'

# 嵌套筛选器
filters:
 or:
 - file.hasTag("tag")
 - and:
 - file.hasTag("book")
 - file.hasLink("Textbook")
 - not:
 - file.hasTag("book")
 - file.inFolder("Required Reading")
```

### 筛选器运算符

| 运算符 | 描述 |
|----------|-------------|
| `==` | 等于 |
| `!=` | 不等于 |
| `>` | 大于 |
| `<` | 小于 |
| `>=` | 大于或等于 |
| `<=` | 小于或等于 |
| `&&` | 逻辑与 |
| `\|\|` | 逻辑或 |
| <code>!</code> | 逻辑非 |

## 属性

### 三种类型的属性

1. **笔记属性** - 来自 frontmatter：`note.author` 或简写 `author`
2. **文件属性** - 文件元数据：`file.name`、`file.mtime` 等
3. **公式属性** - 计算值：`formula.my_formula`

### 文件属性参考

| 属性 | 类型 | 描述 |
|----------|------|-------------|
| `file.name` | String | 文件名 |
| `file.basename` | String | 不含扩展名的文件名 |
| `file.path` | String | 文件的完整路径 |
| `file.folder` | String | 父文件夹路径 |
| `file.ext` | String | 文件扩展名 |
| `file.size` | Number | 文件大小（字节） |
| `file.ctime` | Date | 创建时间 |
| `file.mtime` | Date | 修改时间 |
| `file.tags` | List | 文件中的所有标签 |
| `file.links` | List | 文件中的内部链接 |
| `file.backlinks` | List | 链接到此文件的文件 |
| `file.embeds` | List | 笔记中的嵌入 |
| `file.properties` | Object | 所有 frontmatter 属性 |

### `this` 关键字

- 在主内容区：指代 base 文件本身
- 当被嵌入时：指向嵌入文件
- 在侧边栏：指代主内容中的活动文件

## 公式语法

公式从属性计算值。定义在 `formulas` 部分。

```yaml
formulas:
 # 简单算术
 total: "price * quantity"

 # 条件逻辑
 status_icon: 'if(done, "✅", "⏳")'

 # 字符串格式化
 formatted_price: 'if(price, price.toFixed(2) + " dollars")'

 # 日期格式化
 created: 'file.ctime.format("YYYY-MM-DD")'

 # 计算自创建以来的天数（使用 .days 获取 Duration）
 days_old: '(now() - file.ctime).days'

 # 计算距离到期日还有多少天
 days_until_due: 'if(due_date, (date(due_date) - today()).days, "")'
```

## 关键函数

最常用的函数。完整参考所有类型（Date、String、Number、List、File、Link、Object、RegExp），参见 [FUNCTIONS_REFERENCE.md](references/FUNCTIONS_REFERENCE.md)。

| 函数 | 签名 | 描述 |
|----------|-----------|-------------|
| `date()` | `date(string): date` | 解析字符串为日期（`YYYY-MM-DD HH:mm:ss`） |
| `now()` | `now(): date` | 当前日期和时间 |
| `today()` | `today(): date` | 当前日期（时间 = 00:00:00） |
| `if()` | `if(condition, trueResult, falseResult?)` | 条件判断 |
| `duration()` | `duration(string): duration` | 解析时长字符串 |
| `file()` | `file(path): file` | 获取文件对象 |
| `link()` | `link(path, display?): Link` | 创建链接 |

### Duration 类型

减去两个日期时，结果是 **Duration** 类型（不是数字）。

**Duration 字段：** `duration.days`、`duration.hours`、`duration.minutes`、`duration.seconds`、`duration.milliseconds`

**重要：** Duration 不支持直接 `.round()`、`.floor()`、`.ceil()`。必须先访问数值字段（如 `.days`），然后应用数字函数。

```yaml
# 正确：计算日期之间的天数
"(date(due_date) - today()).days" # 返回天数
"(now() - file.ctime).days" # 创建以来的天数
"(date(due_date) - today()).days.round(0)" # 四舍五入的天数

# 错误 - 会导致错误：
# "((date(due) - today()) / 86400000).round(0)" # Duration 不支持先除再四舍五入
```

### 日期运算

```yaml
# Duration 单位：y/year/years, M/month/months, d/day/days,
# w/week/weeks, h/hour/hours, m/minute/minutes, s/second/seconds
"now() + \"1 day\"" # 明天
"today() + \"7d\"" # 一周后
"now() - file.ctime" # 返回 Duration
"(now() - file.ctime).days" # 以数字形式获取天数
```

## 视图类型

### 表格视图

```yaml
views:
 - type: table
 name: "我的表格"
 order:
 - file.name
 - status
 - due_date
 summaries:
 price: Sum
 count: Average
```

### 卡片视图

```yaml
views:
 - type: cards
 name: "画廊"
 order:
 - file.name
 - cover_image
 - description
```

### 列表视图

```yaml
views:
 - type: list
 name: "简单列表"
 order:
 - file.name
 - status
```

### 地图视图

需要 latitude/longitude 属性及 Maps 社区插件。

```yaml
views:
 - type: map
 name: "位置"
 # map 特定设置用于 lat/lng 属性
```

## 默认汇总公式

| 名称 | 输入类型 | 描述 |
|------|------------|-------------|
| `Average` | Number | 数学平均值 |
| `Min` | Number | 最小数字 |
| `Max` | Number | 最大数字 |
| `Sum` | Number | 所有数字之和 |
| `Range` | Number | Max - Min |
| `Median` | Number | 数学中位数 |
| `Stddev` | Number | 标准差 |
| `Earliest` | Date | 最早日期 |
| `Latest` | Date | 最晚日期 |
| `Range` | Date | Latest - Earliest |
| `Checked` | Boolean | 真值的计数 |
| `Unchecked` | Boolean | 假值的计数 |
| `Empty` | Any | 空值的计数 |
| `Filled` | Any | 非空值的计数 |
| `Unique` | Any | 唯一值的计数 |

## 完整示例

### 任务跟踪器 Base

```yaml
filters:
 and:
 - file.hasTag("task")
 - 'file.ext == "md"'

formulas:
 days_until_due: 'if(due, (date(due) - today()).days, "")'
 is_overdue: 'if(due, date(due) < today() && status != "done", false)'
 priority_label: 'if(priority == 1, "🔴 高", if(priority == 2, "🟡 中", "🟢 低"))'

properties:
 status:
 displayName: Status
 formula.days_until_due:
 displayName: "距离截止天数"
 formula.priority_label:
 displayName: 优先级

views:
 - type: table
 name: "活动任务"
 filters:
 and:
 - 'status != "done"'
 order:
 - file.name
 - status
 - formula.priority_label
 - due
 - formula.days_until_due
 groupBy:
 property: status
 direction: ASC
 summaries:
 formula.days_until_due: Average

 - type: table
 name: "已完成"
 filters:
 and:
 - 'status == "done"'
 order:
 - file.name
 - completed_date
```

### 阅读清单 Base

```yaml
filters:
 or:
 - file.hasTag("book")
 - file.hasTag("article")

formulas:
 reading_time: 'if(pages, (pages * 2).toString() + " min", "")'
 status_icon: 'if(status == "reading", "📖", if(status == "done", "✅", "📚"))'
 year_read: 'if(finished_date, date(finished_date).year, "")'

properties:
 author:
 displayName: Author
 formula.status_icon:
 displayName: ""
 formula.reading_time:
 displayName: "预计时间"

views:
 - type: cards
 name: "图书馆"
 order:
 - cover
 - file.name
 - author
 - formula.status_icon
 filters:
 not:
 - 'status == "dropped"'

 - type: table
 name: "阅读清单"
 filters:
 and:
 - 'status == "to-read"'
 order:
 - file.name
 - author
 - pages
 - formula.reading_time
```

### 日记索引

```yaml
filters:
 and:
 - file.inFolder("Daily Notes")
 - '/^\d{4}-\d{2}-\d{2}$/.matches(file.basename)'

formulas:
 word_estimate: '(file.size / 5).round(0)'
 day_of_week: 'date(file.basename).format("dddd")'

properties:
 formula.day_of_week:
 displayName: "星期"
 formula.word_estimate:
 displayName: "~字数"

views:
 - type: table
 name: "最近笔记"
 limit: 30
 order:
 - file.name
 - formula.day_of_week
 - formula.word_estimate
 - file.mtime
```

## 嵌入 Bases

嵌入 Markdown 文件中：

```markdown
![[我的 Base.base]]

<!-- 特定视图 -->
![[我的 Base.base#视图名称]]
```

## YAML 引用规则

- 对包含双引号的公式使用单引号：`'if(done, "Yes", "No")'`
- 对简单字符串使用双引号：`"我的视图名称"`
- 复杂表达式中正确转义嵌套引号

## 故障排除

### YAML 语法错误

**未引用的特殊字符**：包含以下字符的字符串必须加引号：`:`, `{`, `}`, `[`, `]`, `,`, `&`, `*`, `#`, `?`, `|`, `-`, `<`, `>`, `=`, `!`, `%`, `@`, `` ` ``。

```yaml
# 错误 - 未引用字符串中包含冒号
displayName: Status: Active

# 正确
displayName: "Status: Active"
```

**公式中引号不匹配**：当公式包含双引号时，整个公式用单引号包裹。

```yaml
# 错误 - 双引号内包含双引号
formulas:
 label: "if(done, "Yes", "No")"

# 正确 - 单引号包裹双引号
formulas:
 label: 'if(done, "Yes", "No")'
```

### 常见公式错误

**Duration 运算没有字段访问**：减去两个日期返回的是 Duration，不是数字。始终访问 `.days`、`.hours` 等。

```yaml
# 错误 - Duration 不是数字
"(now() - file.ctime).round(0)"

# 正确 - 先访问 .days，再四舍五入
"(now() - file.ctime).days.round(0)"
```

**缺少空值检查**：属性可能不在所有笔记中存在。使用 `if()` 保护。

```yaml
# 错误 - due_date 为空时会崩溃
"(date(due_date) - today()).days"

# 正确 - 用 if() 保护
'if(due_date, (date(due_date) - today()).days, "")'
```

**引用未定义的公式**：确保 `order` 或 `properties` 中的每个 `formula.X` 都在 `formulas` 中有对应的条目。

```yaml
# 这会在 'total' 未在 formulas 中定义时静默失败
order:
 - formula.total

# 修复：定义它
formulas:
 total: "price * quantity"
```

## 参考资料

- [Bases Syntax](https://help.obsidian.md/bases/syntax)
- [Functions](https://help.obsidian.md/bases/functions)
- [Views](https://help.obsidian.md/bases/views)
- [Formulas](https://help.obsidian.md/formulas)
- [Complete Functions Reference](references/FUNCTIONS_REFERENCE.md)
