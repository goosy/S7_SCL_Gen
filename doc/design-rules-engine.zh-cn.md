# 设计：后处理规则引擎

> 本文是 [design-rules-engine.md](design-rules-engine.md) 的中文译本。

实现于 `src/rules/`（`parse.js`、`match.js`、`apply.js`）。该子系统在
*不*改动 GCL 源的前提下，改写 `gen_data()` 产生的扁平 `copy`/`convert`
任务列表（见
[design-pipeline.zh-cn.md §4](design-pipeline.zh-cn.md#4-从-area-到输出文件-gen_list)）——
而是由通过 `--rules` 传入的独立规则 YAML 文件驱动（见
[spec-cli.zh-cn.md §5](spec-cli.zh-cn.md#5---rules-模式与普通-convert-的区别)）。
它的存在是为了让与部署相关的调整（把多个 CPU 的循环调用合并到一个文件、
注入额外条目、丢弃不需要的输出）可以放在受版本管理的 GCL 配置之外。

## 1. 规则文件结构 (`parse.js`)

一个规则 YAML 文件由一个或多个文档组成，每个文档描述一个**任务**：

```yaml
config_path: <relative path>   # 可选，默认 '.'
attributes: { ... }            # 可选，额外的模板 tags
rules:
  - pattern: { ... }
    scope: applied | origin    # 可选，默认 'applied'
    actions: [ ... ]
  - sort_by: [ 'field', '@field' ]   # '@' 前缀 = 降序
```

`get_rules(filename)` 读取该文件并返回一个 `{ path, rules }` 任务数组——
每个文档一个——其中 `path` 是相对于规则文件自身所在目录解析的
`config_path`。CLI 对每个任务运行一次 `convert({ rules })`，运行前先
`chdir` 到 `path`。

每个 `rule.actions` 条目在使用前都会被规范化（`regularize`）：

- 字符串简写 `'delete'` 展开为 `{ action_type: 'delete' }`。
- 裸数组简写展开为 `{ action_type: 'inner_rules', rules: <array> }`。
- `action_type` 默认为 `'replace'`，除非存在 `rules`（此时为
  `'inner_rules'`）。
- `action_scope` 默认为 `'matched'`。
- `delete`/`merge` 只能与 `action_scope: 'matched'` 一起使用。
- 没有 `pattern` 的规则只能包含 `add` 动作（没有可匹配的对象）。
- `inner_rules` 动作会被递归地解析为**文档规则**：语法与规则相同，但在
  其中 `merge` 和嵌套的 `inner_rules` 会被拒绝（`using_inner_rules`
  标志），因为它们只对顶层任务列表有意义。

## 2. 模式匹配 (`match.js`)

`match(obj, pattern_object)` 递归地将任务列表条目与模式对象进行比较。
模式值支持：

| 模式 | 匹配 |
|---|---|
| `'*'` | 任意非空值 |
| `'%u'` | `null`/`undefined` |
| `'%b'` / `'%s'` / `'%n'` / `'%a'` / `'%o'` | 任意布尔 / 字符串 / 数字 / 数组 / 普通对象 |
| `'%O'` | 任意其他对象（非 null/布尔/字符串/数字/数组/普通对象） |
| 普通字符串，如 `'AS*'` | 对字符串值进行 glob 匹配（通过 `matcher`） |
| `'!pattern'` | 取反的 glob 匹配 |
| 字符串数组 | 正向 glob 的并集 ∩ 反向 glob 的交集——例如 `['AS*', '!*2', '!*3']` 匹配以 `AS` 开头、但不以 `2` 或 `3` 结尾的字符串 |
| 普通对象 | 递归：每个键都必须与对应属性匹配 |

对于数组值的属性，只要**任一**元素与模式匹配即算匹配
（`Array.prototype.some`）。`match_all(list, pattern)` 将列表过滤为
`match(item, pattern)` 为真的条目。

## 3. 动作 (`apply.js`)

`apply_rules(list, rules, parent_tags)` 按顺序对一个工作用 `Set`
（`applied_list`，由输入列表初始化，使后面的规则能看到前面规则的效果）
执行每条规则：要么应用 `sort_by`（通过 `multi_sort`），要么调用
`apply_rule`。

对于带 `pattern` 的规则，`matched_items = match_all(source, pattern)`，
其中 `source` 为 `applied_list`（`scope: 'applied'`，默认——能看到之前
规则的输出）或原始未改动的 `list`（`scope: 'origin'`）。随后动作作用于
以下三个作用域桶之一：`matched`（模式匹配到的条目）、`merged`（*同一*
规则中先前 `merge` 动作创建的条目）、`new`（同一规则中先前 `add` 动作创建
的条目）——或 `all`（三者的并集）。

| 动作 | 作用对象 | 效果 |
|---|---|---|
| `replace` | `matched`/`merged`/`new` | 用动作的属性覆盖目标的属性（包括整个数组，例如 `files`）。 |
| `join` | 同上 | 合并而非覆盖：对象属性逐键合并，数组属性追加。 |
| `merge` | 仅 `matched`，仅 `convert` 条目 | 把多个匹配到的 `convert` 任务合并为**一个新**任务（加入 `merged`），分两个阶段：阶段 1 将每个匹配条目的 `tags`/`template`/`distance`/`output_dir`/`cpu_name`/`feature`/`platform`/`OE`/`line_ending` 折叠进新条目（不一致的非 tag 字段分别归为 `''`/`'utf8'`/`'LF'`；不一致的 `template`/`distance`/`output_dir` 会取消整个合并）；阶段 2 在其上应用动作自身的属性（以动作的值为准）。原条目保持不变——若不应再单独输出它们，请搭配一个 `delete`。 |
| `add` | 无需（即使 `pattern: null` 也可用） | 为每个源条目创建一个新条目（无 pattern 时以 `{}` 为源创建一个条目），通过一次**全新**的 `replace` 式应用完成（在 `action_type: 'add'` 下，模板表达式中的 `$` 指源条目，而在其他所有动作类型下指目标条目）。 |
| `delete` | 仅 `matched` | 从任务列表中彻底移除匹配到的条目；必须是其规则中唯一/最后一个动作（同一规则中其后的动作会被丢弃并发出警告），并会取消同一规则中所有 `action_scope: matched` 的 `replace`/`join`/`inner_rules` 动作。 |
| `inner_rules` | 规则自身的动作目标，即 `tags.list` 本身是嵌套逐条目列表的 `convert` 条目（见下文） | 将嵌套的规则数组作为**文档规则**（见 §4）递归应用到 `target.tags.list`。 |

动作中的属性值（除少数保留键：`action_type`、`action_scope`、
`action_target`、`rules_path`、`tags`、`cpu_name`、`feature`、`platform`、
`input_dir`、`output_dir`、`template` 外）在应用前会通过 `gooplate` 的
`convert(tags, value)` 进行模板替换——`tags` 包括条目自身的模板 tags，
加上 `$`（正在读取的条目，在 `add` 动作中可用于引用匹配到的源条目），以及
动作自身设置的 `{cpu_name, feature, platform}`（若有）。若以动作属性给出
`template`，则通过 `get_template` 从文件读取（路径相对于规则文件解析，即
`action.rules_path`）并缓存。

## 4. 文档规则 (`inner_rules`)

`convert` 类型任务的 `tags.list` 就是模板所迭代的同一个逐条目数组（例如
一个 `AI` 文档的通道列表——见
[design-pipeline.zh-cn.md §2](design-pipeline.zh-cn.md#2-核心数据模型-srcgen_datajs)）。
`inner_rules` 动作把嵌套的规则数组恰好应用到这个数组上，使用相同的
`apply_rule`/`match`/动作机制，但：

- 设置了 `parent_tags`（外层任务的 tags），因此嵌套动作知道其
  `cpu_name`/`feature`/`platform` 来自父级，而无需单独指定。
- `merge` 和更深一层的 `inner_rules` 动作在解析时即被拒绝。
- 每个内部条目会先被打上 `__original_index` 标记，在规则应用过程中保留
  原始顺序信息，以备后续需要。

这是在不改动 GCL 源的情况下深入到生成文件的条目列表*内部*（例如对单个
AI 通道重新排序或过滤）的机制。

## 5. 实践说明

- `merge` + `delete` 是将多个 CPU（或功能）的循环调用函数合并为一个新
  文件、同时屏蔽原文件的标准模式。
- 由于 `sort_by` 的条目按栈的方式求值（`multi_sort` 内部使用
  `Array.prototype.pop`），应把**主**排序键放在**最后**。
- 所有属性值都会经过 gooplate 模板替换，因此包含 `{{`/`}}` 的普通字符串
  若不打算作为模板表达式，需要转义。
