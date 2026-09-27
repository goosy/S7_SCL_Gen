# GCL 配置语言规格说明

> 本文是 [spec-gcl-format.md](spec-gcl-format.md) 的中文译本。

GCL（Generative Configuration Language，生成式配置语言）是本工具读取的
YAML 方言。GCL 文件位于"GCL 目录"中；`convert` 读取该目录下（非递归）的
所有 `*.yaml`/`*.yml` 文件。

## 1. 文档

一个 YAML 文件可包含多个文档，以 `---` 分隔，可选地以 `...` 结束（标准
YAML 多文档语法）：

```yaml
--- # 文档 1
name: AS1-CPU
platform: step7
device: CPU410-5H
symbols:
- [Clock_Byte, MB10]
options:
  output_dir: SCL

--- # 文档 2
name: AS1-AI
list:
- comment: temperature
  DB: [TIT002, DB+]
  input: [AI01-03, PIW516]
  $zero: "-40.0"
  $span: "80.0"
...
```

- 每个文档是一个不可分割的配置单元。
- 文档可以分散在多个文件中；不要求一个 CPU 的所有文档位于同一文件。
- 文档的根级键称为**指令**（`name`、`feature`、`CPU`、`list`、
  `options` 等）。
- 指令/文档的兼容性随版本变化；`s7scl -v` 会报告生成器的版本。

### 1.1 必需指令

每个文档都必须通过以下**其中一种**方式，标明其所属的 CPU 和所配置的
功能：

- `name`：形如 `<CPU>-<feature>` 的单个字符串（推荐——只需一个值，且名称
  同时充当唯一性键），例如 `name: AS1-AI`。
- `CPU` + `feature`：分别给出两部分，例如 `CPU: AS1` / `feature: AI`。

`<CPU>-<feature>` 组合在整个 GCL 目录中必须唯一——即一个 CPU 的每种功能
最多只能有一个文档。`feature` 不区分大小写。受支持功能及其别名的完整
列表（如 `MT`/`modbusTCP`、`SC`/`MB`、`interlock`/`il`）见
[spec-converters.zh-cn.md](spec-converters.zh-cn.md)。

### 1.2 可选指令（所有文档类型）

#### `options`

额外设置的映射表。目前可识别的键包括 `output_file`（覆盖生成文件的基本
名称），以及仅在 `CPU` 文档中有效的 `output_dir`（覆盖该 CPU 的输出
目录，其本身可使用 `cpu_name`/`platform`/`device` 进行模板替换）。

#### `symbols`

[S7 符号定义](#35-s7-符号定义)的数组。每个功能都有带默认地址的内置符号
（见 [design-symbols.zh-cn.md](design-symbols.zh-cn.md#3-内置符号)）；
通常无需手写，但如果某个默认地址与项目中其他内容冲突，可以在此以相同的
**名称**重新声明，并指定不同的地址（和/或注释）——名称本身不可更改。

#### `includes`

原样合并到本文档生成输出文件顶部的额外 SCL 源码。可为以下之一：

1. **字符串**：直接作为 SCL 源码使用。
2. **数组**：每个元素要么是文件名（字符串，相对于 GCL 文件所在目录，
   假定为 UTF-8），要么是显式指定文件编码的对象 `{ filename, encoding }`。

被包含的文件可使用 `{{ expression }}` 模板占位符（针对文档的
`attributes` 映射表以及 `cpu_name`/`feature`/`platform` 进行替换），并且
可以把不应出现在最终 SCL 中的说明文字，包在一对内容恰好为 `(**` 与 `**)`
的行之间——这样一对行之间的所有内容会在包含之前被剔除（见
`src/gen_data.js` 中的 `parse_SCL`）。除此之外，生成器不校验被包含的 SCL。

#### `files`

需要原样复制到输出目录的额外文件/文件夹（SCL、AWL 或其他任何文件）数组，
每项都相对于 GCL 文件所在目录，使用 `/` 作为分隔符（不要用 `\`）。规则：

- 纯文件名复制到 `<output_dir>/<basename>`——不保留源路径。
- 若要保留部分相对路径，用 `//` 标记分割点：`os//ab/c.scl` 会把
  `os/ab/c.scl` 复制到 `<output_dir>/ab/c.scl`。
- 文件夹条目会将整个文件夹（递归）复制到 `<output_dir>/<foldername>`。
- 支持 glob 模式（`*`、`**`），使用 `globby` 匹配。
- 纯文件名条目按字节原样复制（不做编码转换）。对象形式
  `{ filename, encoding }`（或等价的流式映射
  `{filename: ..., encoding: ...}`）会将文件重新编码为本次运行的输出编码
  （默认 GBK）——为兼容 Step 7 导入时请使用此形式。
- 生成器不解析也不校验被复制文件的内容。

### 1.3 其他可选指令

- `list` —— 功能的条目列表（对象数组）；其结构因功能而异，见
  [spec-converters.zh-cn.md](spec-converters.zh-cn.md)。
- `loop_begin` / `loop_end` —— 原始 SCL 字符串，分别拼接在该功能生成的
  主循环函数体的开头/结尾。

## 2. `CPU` 文档

每个 CPU 必须恰好有一个 `CPU` 功能文档（若省略，会在内部合成一个空白
文档，使非 CPU 文档仍有归属——见
[design-pipeline.zh-cn.md](design-pipeline.zh-cn.md)）。除上述通用指令外，
`platform`（`step7`（默认）| `portal` | `pcs7`）和 `device` 只在此文档中
有意义；在非 CPU 文档中指定 `platform` 会记录一条警告并被忽略。所有共享
同一 CPU 名称的文档自动参与该 CPU 的共享符号表、地址分配和冲突检查。

## 3. 值类型

### 3.1 布尔

`true` / `false`，不区分大小写。

### 3.2 数值

十进制或十六进制（`0x4A98`）字面量，例如 AI 配置中的 `zero`/`span`。

### 3.3 字符串

通常不加引号；必要时遵循标准 YAML 引号规则（例如为了与其他类型区分，
或包含特殊字符）。

### 3.4 SCL 表达式

字面形式与字符串相同，但内容必须是合法的 SCL 表达式（合法性由作者负责——
生成器不检查 SCL 语法）。若表达式中含有双引号，按 YAML 规则用单引号包裹
整个值，例如 `'NOT "TIT001".LL_flag'`。

### 3.5 S7 符号定义

`[name, address, type?, comment?]` —— 含 2 到 4 个元素的 YAML 流式序列：

- `name`：符号标识符。
- `address`：S7 地址，如 `DB100`、`M100.0`、`FB512` 或 `DB+`
  （`+` 表示为 `OB`/`DB`/`FB`/`FC`/`SFB`/`SFC`/`UDT` 自动分配块号，或在
  `M`/`I`/`Q`/`PI`/`PQ` 区内自动分配地址）。
- `type`（可选）：合法的 S7 类型。`FB`/`FC`/`UDT`/`OB`/`SFB`/`SFC` 符号的
  类型始终是其自身，可以省略；`DB` 符号省略时默认为自身（独立 DB），
  也可指定其作为实例/类型化视图所对应的 `FB`/`UDT`。
- `comment`（可选）：自由文本。

示例：`[recvDB, DB100, FB512, receive block]` 定义了一个名为 `recvDB` 的
FB512 实例 DB100。`[length, M100, INT, length]` 定义了位于 `M100` 的 INT
符号。

在一个 CPU 内，每个符号名和每个符号地址都必须唯一；违反即为硬错误（见
[design-symbols.zh-cn.md](design-symbols.zh-cn.md#2-冲突检测)）。

### 3.6 S7 符号引用

符号一经定义（在 `symbols` 中，或作为该 CPU 中任意 `list` 条目自带的符号
定义），即可在其他地方仅凭名称引用，例如 `recvDB` 即引用上面定义的符号。
引用可以是**前向**的——在整个 GCL 目录完成第一遍扫描后才解析（见
[design-pipeline.zh-cn.md](design-pipeline.zh-cn.md#3-两遍处理)）。

### 3.7 数组与对象

由上述类型组合而成，结构遵循各功能自身的模式定义。

### 3.8 联合类型

某些配置项可以互换地接受多种上述类型。两个常见例子：

- `AI.DB` / `AI.input`（以及其他功能中的对应项）：符号定义或符号引用。
- `interlock` 的 `input_list` 条目：对象、符号定义、符号引用或原始 SCL
  表达式。

各功能的转换器通过 `make_s7_expression` 完成这种分派（见
[design-symbols.zh-cn.md](design-symbols.zh-cn.md#4-解析配置值)）。
