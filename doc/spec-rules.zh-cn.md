# 规则文件规格说明

> 本文是 [spec-rules.md](spec-rules.md) 的中文译本。

规则文件（rml）是一个 YAML 文件，用 `s7scl --rules <file>` 传入（见
[spec-cli.zh-cn.md](spec-cli.zh-cn.md)）。它在**不改动** GCL 源的前提下，
对转换产生的输出任务列表做后处理：合并多个文件、新增或删除输出、修改
输出位置和模板、改写文件内部的条目列表等。这样，与部署相关的调整可以放在
GCL 配置之外。

本文规定规则文件的格式和行为。实现见
[design-rules-engine.zh-cn.md](design-rules-engine.zh-cn.md)。

## 1. 任务列表

一次 GCL 转换产生一个**任务列表**，每个任务（条目）对应一个输出文件。规则
作用于这个列表；规则应用完毕后，列表中剩下的每个条目才被真正复制或生成。

条目有两种类型：

- `copy` 条目：把一个源文件复制到输出目录。
- `convert` 条目：用模板生成一个输出文件。

条目上可供规则匹配和修改的属性：

| 属性 | 条目类型 | 含义 |
|---|---|---|
| `type` | 两者 | `copy` 或 `convert` |
| `cpu_name` | 两者 | 所属 CPU 的名称 |
| `feature` | 两者 | 所属功能，如 `AI`、`CPU`；符号表条目为 `symbol` |
| `platform` | 两者 | `step7`、`portal` 或 `pcs7` |
| `output_dir` | 两者 | 输出目录 |
| `distance` | 两者 | 相对于 `output_dir` 的输出文件路径 |
| `OE` | 两者 | 输出编码 |
| `line_ending` | 两者 | 输出行尾，`LF` 或 `CRLF` |
| `input_dir` | `copy` | 源目录 |
| `source` | `copy` | 相对于 `input_dir` 的源文件路径 |
| `IE` | `copy` | 源文件编码；为空表示按字节原样复制 |
| `template` | `convert` | 生成该文件所用的模板 |
| `tags` | `convert` | 该模板的变量（模板 tags），其中 `list` 是该功能的条目列表，模板按它逐条生成内容 |

## 2. 文件结构

规则文件由一个或多个 YAML 文档组成，每个文档是一个**规则任务**，各自独立
执行：

```yaml
config_path: <相对路径>         # 可选，默认 '.'
attributes: { ... }            # 可选，本任务的模板变量
rules:                         # 规则列表，按顺序应用
  - pattern: { ... }
    scope: applied | origin    # 可选，默认 applied
    actions: [ ... ]
  - sort_by: [ field, '@field' ]
```

- `config_path`：要转换的 GCL 目录，相对于规则文件所在目录。对每个规则
  任务，生成器转换该目录，再把 `rules` 应用到产生的任务列表上。
- `attributes`：本任务的模板变量，见 [§6](#6-attributes)。
- `rules`：规则列表。规则按书写顺序依次应用，后面的规则能看到前面规则的
  结果。

格式不正确的规则或动作被忽略，并输出警告。

## 3. 规则

规则有两种：

- **匹配规则**：`pattern`（可省略，见下）、`scope` 和 `actions`。先用
  `pattern` 从列表中选出匹配的条目，再按顺序执行 `actions`。
- **排序规则**：只有 `sort_by`，对当前列表排序，见 [§3.3](#33-排序)。

### 3.1 模式

`pattern` 是一个对象，每个键对应条目的一个属性，条目的每个对应属性都匹配时，
条目才算匹配。`pattern` 也可以直接写一个字符串或字符串数组，此时与条目
整体匹配（常用 `'*'` 表示所有条目）。

模式值：

| 模式 | 匹配 |
|---|---|
| `'*'` | 任意非空值 |
| `'%u'` | `null` 或不存在 |
| `'%b'` / `'%s'` / `'%n'` / `'%a'` / `'%o'` | 任意布尔 / 字符串 / 数字 / 数组 / 普通对象 |
| `'%O'` | 其他任意对象（非 null、布尔、字符串、数字、数组、普通对象） |
| 普通字符串，如 `'AS*'` | 对字符串值做 glob 匹配 |
| `'!pattern'` | glob 匹配取反 |
| 字符串数组 | 满足至少一个正向模式，且满足全部取反模式；例如 `['AS*', '!*2', '!*3']` 匹配以 `AS` 开头、但不以 `2` 或 `3` 结尾的值 |
| 对象 | 递归：每个键都与对应的子属性匹配 |

属性值是数组时，只要任一元素匹配即算匹配。

省略 `pattern` 的规则不匹配任何条目，只能包含 `add` 动作（见
[§4.4](#44-add)），用于凭空新增条目。

### 3.2 匹配来源 `scope`

- `applied`（默认）：从当前列表匹配，即已应用了前面规则之后的列表，包括
  前面规则新增或合并出来的条目。
- `origin`：从规则应用前的原始列表匹配，不受前面规则的影响。

### 3.3 排序

```yaml
- sort_by: [ feature, '@cpu_name' ]
```

按列出的属性对当前列表排序，第一个属性为主排序键，依次往后为次级排序键。
属性名前加 `@` 表示降序。属性名可以用 `.` 访问子属性，如 `DB.name`。

## 4. 动作

每个动作是一个对象，其中：

- `action_type`：动作类型，`replace`、`join`、`merge`、`add`、`delete`
  或 `inner_rules`。省略时为 `replace`；动作带有 `rules` 时为
  `inner_rules`。
- `action_scope`：动作作用的条目，默认 `matched`：
  - `matched`：本规则的 `pattern` 匹配到的条目；
  - `merged`：本规则中前面的 `merge` 动作合并出的条目；
  - `new`：本规则中前面的 `add` 动作新增的条目；
  - `all`：以上三者的并集。
- 其余键是要写入条目的**属性**。

简写：

- 动作写作字符串 `delete`，等同于 `{ action_type: delete }`；
  `actions: delete` 等同于 `actions: [delete]`。
- 动作写作数组，等同于 `{ action_type: inner_rules, rules: <该数组> }`。

属性值按 [§5](#5-模板替换) 做模板替换后再写入。

### 4.1 replace

用动作的属性覆盖条目的同名属性，包括整个数组和对象。属性值为 `null` 时，
删除条目的该属性。

### 4.2 join

合并而非覆盖：对象属性逐键合并，数组属性追加元素，其余值直接替换。属性值
为 `null` 时，删除条目的该属性。

### 4.3 merge

把本规则匹配到的多个 `convert` 条目合并为**一个新的** `convert` 条目，新
条目加入列表，并可用 `action_scope: merged` 继续处理。只能用于
`action_scope: matched`；匹配到的条目中非 `convert` 的会被跳过。

合并方式：

- `tags`：各条目的 `tags` 依次以 join 方式合并，`list` 等数组首尾相接。
  各条目的 `cpu_name`、`feature`、`platform` 不合并进 `tags`。
- `template`、`distance`、`output_dir`：各条目一致时取该值；不一致时须由
  动作自身给出，否则取消本次合并。
- `cpu_name`、`feature`、`platform`：一致时取该值，不一致时为 `''`。
- `OE`：一致时取该值，不一致时为 `utf8`。
- `line_ending`：一致时取该值，不一致时为 `CRLF`。
- 最后在新条目上应用动作自身的属性，以动作的值为准。

原条目保持不变，仍会各自输出；不需要时用 `delete` 删除（与内层规则同时
使用时的写法见 [§4.5](#45-delete)）。

合并之后，各原条目的 `cpu_name`、`feature`、`platform` 就丢失了。需要在
合并之后使用它们或由它们派生的值时，由规则自己保留，见
[§7](#7-在合并前保留取值)。

### 4.4 add

为每个作用条目新增一个条目；规则没有 `pattern` 时，只新增一个条目。新条目
**不继承**作用条目的任何属性，它的属性全部来自动作，因此 `copy` 条目需要
写出 `type`、`source`、`input_dir` 等，`convert` 条目需要写出
`type`、`template` 等。新条目未指定 `OE`、`line_ending` 时，分别按
`utf8`、`CRLF` 输出。

在 `add` 动作中，模板变量 `$` 指作用条目（新条目的来源），而不是新条目。

### 4.5 delete

从列表中移除匹配到的条目，它们不会被复制或生成。只能用于
`action_scope: matched`。

`delete` 应是规则中的最后一个动作：其后的动作被忽略，并输出警告。同一规则
中作用于 `matched` 的 `replace`、`join`、`inner_rules` 动作不执行，因为
这些条目已被删除；`merge`、`add` 照常执行，因此“合并后删除原条目”可以
写在同一规则中。

### 4.6 inner_rules

对 `convert` 条目的 `tags.list`（文件内部的条目列表，例如一个 AI 文档的
各通道）应用一组**内层规则**：

```yaml
- pattern: { feature: AI, type: convert }
  actions:
  - rules:
    - pattern: { $enable_AH: { value: true } }
      actions:
      - action_type: add
        tagname: '{{$.DB.name}}.HH_flag'
    - sort_by: [ tagname ]
```

内层规则的写法与外层规则相同，模式、`scope`、动作作用于 `tags.list` 的
元素，结果写回 `tags.list`。区别：

- 不能使用 `merge` 和 `inner_rules` 动作，写了会被忽略并输出警告。
- 每个元素带有 `__original_index` 属性，表示它在原列表中的顺序，可用于
  排序。
- 模板替换的上下文见 [§5](#5-模板替换)。

内层规则对每个作用条目分别执行一次。

## 5. 模板替换

动作的属性值写入条目之前，做 gooplate 模板替换：字符串中的 `{{...}}` 按
模板变量求值。替换对对象和数组的各层字符串都生效。若条目原值是布尔，替换
结果为 `true`/`false` 时写入布尔值。

不打算作为模板的字符串中，不要出现 `{{` 和 `}}`。

模板变量由以下几部分组成，同名时**后者优先**：

| 动作所在位置 | 模板变量 |
|---|---|
| 外层规则 | 本任务的 `attributes`，作用条目的 `tags`（`copy` 条目没有），作用条目的 `cpu_name`、`feature`、`platform`，`$` |
| 内层规则 | 本任务的 `attributes`，外层条目的 `tags`，`$` |

- `$` 指正在处理的条目：外层规则中是作用条目；内层规则中是 `tags.list`
  的元素；`add` 动作中都指新条目的来源条目。`$` 只存在于动作的模板替换
  中，不写入条目，输出模板中不可用。
- 内层规则中，`cpu_name`、`feature`、`platform` 来自外层条目的 `tags`；
  它们不写入内层元素，`$.cpu_name` 等只有元素自己带有这些属性时才有值。
- 外层动作写了 `cpu_name`、`feature` 或 `platform` 时，这些值先替换，再
  写入条目，后面的属性和动作看到的是新值。
- `template`、`input_dir`、`output_dir` 的值是相对于规则文件所在目录的
  路径，也做模板替换。
- 动作的 `tags` 属性以 join 方式并入条目的 `tags`，不论动作类型。

## 6. attributes

`attributes` 是本任务的模板变量，写成一个对象：

```yaml
attributes:
  link_names:
    GD1: CCProgram
    GD2: GDProgram
```

要求：

- 在本任务的所有模板替换中都可用：外层和内层规则的动作属性值，以及规则
  应用之后每个 `convert` 条目输出时的模板，不论该条目是否被动作修改过。
- 与条目自己的 `tags` 同名时，以条目的 `tags` 为准：`attributes` 只补充
  `tags` 中没有的变量，不覆盖生成器产生的变量（如 `list`）。发生遮蔽时
  输出警告，指明键名和条目。
- 不得包含 `cpu_name`、`feature`、`platform` 这三个键。解析规则文件时
  发现这三个键即报错并停止转换，指明规则文件和键名。这三个值始终来自条目
  本身，要修改它们，应在规则动作中指定（见 [§5](#5-模板替换)）。
- `attributes` 只作为模板变量，不会写入条目的属性。

## 7. 在合并前保留取值

`merge` 之后，原条目的 `cpu_name`、`feature`、`platform` 不再可用（见
[§4.3](#43-merge)）。生成器不替规则保留它们：需要在合并之后使用这些值或
由它们派生的值时，规则编写者应在 `merge` **之前**，用内层规则把它们显式
写入元素的某个属性。

例如，合并多个 CPU 的报警列表，并让每条报警带上所在 CPU 的程序名：

```yaml
attributes:
  link_names:
    GD1: CCProgram
    GD2: GDProgram
rules:
- pattern: { feature: AI, type: convert }
  scope: origin
  actions:
  - rules:                       # 合并之前：每个元素记下自己的程序名
    - pattern: '*'
      actions:
      - link_name: '{{link_names[cpu_name]}}'
  - action_type: merge           # 合并后的模板中直接使用元素的 link_name
    cpu_name: dist
    template: alarms.template
    output_dir: dist
    distance: alarms.csv
- pattern: { feature: AI, type: convert }
  scope: origin                  # 只匹配原条目，不匹配合并出的条目
  actions: delete
```

删除原条目要写成单独的规则：若与内层规则写在同一规则中，内层规则不会执行
（见 [§4.5](#45-delete)）。
