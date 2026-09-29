# 设计：转换流水线

> 本文是 [design-pipeline.md](design-pipeline.md) 的中文译本。

本文描述一个 GCL 目录如何变成 SCL 输出目录——即
[spec.zh-cn.md](spec.zh-cn.md) 与 [spec-gcl-format.zh-cn.md](spec-gcl-format.zh-cn.md)
背后的机制。

## 1. 总体流程

```
GCL YAML 文件
  -> gcl.js：解析为 yaml Document（+ 自定义合并键处理）
  -> gen_data.js 第 1 遍（parse_conf/parse_doc）：构建 CPU/Area 模型，注册符号
  -> gen_data.js 第 2 遍（逐 area 执行 build_list）：补全交叉引用数据
  -> gen_data.js gen_list：向每个转换器索取其复制/转换任务列表
  -> [可选] rules/apply.js：按外部规则文件改写任务列表
  -> index.js process()：渲染模板（gooplate）/ 复制文件，写出输出
```

入口：`src/cli.js`（CLI）调用 `src/index.js` 中的 `convert()`，后者依次
调用 `gen_data()` 和 `process()`。任何以库方式导入 `s7-scl-gen` 的代码，
得到的也是 `src/index.js` 中同一个 `convert` 函数。

## 2. 核心数据模型 (`src/gen_data.js`)

- **`CPU`**：每个不同的 CPU 名称对应一个。持有 `platform`、`device`、
  `output_dir`、`OE`（该 CPU 输出文件的默认编码，见
  [§4.1](#41-输出编码)）、`line_ending`（该 CPU 输出文件的默认行尾，见
  [§4.2](#42-输出行尾)）、以功能名为键的私有 `#areas` 映射（每个功能一个 `Area`）、
  CPU 级的 `S7SymbolEmitter`（`symbols`）、挂起的 `async_symbols` Promise、
  `non_symbols`（无法解析为真实符号、按原始 SCL 表达式透传并作为警告报告
  的值），以及 CPU 级的地址分配器（`conn_ID_list`、`conn_host_list`，供
  `MT` 使用）。
- **`Cpu_Pool`**：一个 `Map<string, CPU>`，重写了 `get()`，在首次引用时
  惰性创建 `CPU`——因此文档可以在该 CPU 自己的 `CPU` 文档被解析之前就引用
  它。
- **`Area`**：每个 (CPU, feature) 的工作集：已解析的 `document`、其
  `attributes`、`includes`（已解析为 SCL 字符串）、`files`、`list`（就地
  从原始 YAML 节点改写为转换器自有的对象——见
  [design-converters.zh-cn.md](design-converters.zh-cn.md)）、
  `loop_begin`/`loop_end` 以及 `options`。

## 3. 两遍处理

每个功能转换器（`src/converters/converter_<feature>.js`）实现
`initialize_list(area)`（第 1 遍），并可选实现 `build_list(area)`（第 2
遍）。之所以要分两遍，是因为符号引用可以是**前向**的——文档可能引用一个
在同一 CPU 中稍后才定义的符号名，甚至引用一个尚未被解析的文档中的符号——
所以在第 1 遍中，任何转换器都不能安全地假定所有符号均已存在。

1. **第 1 遍**（`parse_doc`，每个文档调用一次，按文件/CPU 顺序，且强制
   `CPU` 文档优先）：注册文档自身的 `symbols`，调用 `initialize_list(area)`
   把每个 `list` YAML 节点转换为模板可使用的普通对象表示。任何可能是符号
   的配置值（见 [design-symbols.zh-cn.md §4](design-symbols.zh-cn.md#4-解析配置值)）
   都通过 `make_s7_expression` 解析：若所引用的符号已存在则立即返回解析
   后的值，否则返回一个排入 `cpu.async_symbols` 的 `Promise`。
2. 所有文档都完成第 1 遍后，每个 CPU 的符号发射器会发出 `'finished'`
   事件，它 (a) 触发 `build_symbols()`——最终的地址分配和重复检测（见
   [design-symbols.zh-cn.md §2](design-symbols.zh-cn.md#2-冲突检测)）；
   (b) 将仍未解决的前向引用回退解析为 S7 表达式（一个始终未成为真实符号
   的名称会被当作 SCL 字面表达式，并列入 "non-symbols" 警告）。
   `gen_data()` 会等待所有排队的 `async_symbols` Promise 完成后再继续。
3. **第 2 遍**（`build_list(area)`，仅当转换器定义了它时执行）：在所有
   符号确定之后运行，因此可以安全读取 `symbol.block_no`、
   `symbol.type_name` 之类的字段，或同一 CPU 上其他功能 area 中的值。
   派生/汇总字段在此计算（例如 `interlock` 的逐字段 SCL 语句、`MT`/`SC`
   轮询的字节偏移打包、`motor` 按平台拼装的参数字符串）。

如果某个 `CPU` 文档尚不存在，但被非 `CPU` 文档引用，会按需合成一个
（`create_fake_CPU_doc`），默认平台为 `step7`，这样流水线就无需特殊处理
缺失的 CPU 文档——功能直接读取该 CPU 的默认值即可。

## 4. 从 Area 到输出文件 (`gen_list`)

对每个 `(CPU, feature, Area)` 三元组，`gen_list()`：

- 将 `area.files` 展开为具体的 `copy` 任务条目（`{ source, input_dir,
  distance, output_dir, IE, OE, line_ending, ... }`），解析 glob 以及
  `//` 分割的路径保留语法。
- 调用转换器的 `gen_copy_list(area)` 获取功能库文件（如
  `AI_Proc(step7).scl`），同样追加为 `copy` 条目；描述符中给出的字段
  （包括可选的 `OE`/`line_ending`）覆盖通用字段。
- 调用转换器的 `gen(area)`，它返回一个或多个 `{ distance, output_dir,
  tags, template, OE?, line_ending? }` 描述符；`gen_list` 合并通用 tags（`context`、`gcl`、
  字符串填充辅助函数、`cpu_name`/`feature`/`platform`，以及 `area` 自身的
  全部内容——`includes`、`list`、`loop_begin`、`loop_end`、`options`），
  并在生成的 `templates` 映射表中查找所命名的模板字符串（见
  [design-converters.zh-cn.md §2](design-converters.zh-cn.md#2-templates-映射表)），
  生成一个 `convert` 任务条目。
- 所有 CPU/area 处理完毕后，再为每个 CPU 追加一个用于符号表本身的
  `convert` 任务（`gen_symbols`，见
  [design-symbols.zh-cn.md §5](design-symbols.zh-cn.md#5-符号表导出)）。

结果是一个由 `copy` 与 `convert` 任务对象组成的扁平列表——规则引擎正是在
这个列表上操作（见 [design-rules-engine.zh-cn.md](design-rules-engine.zh-cn.md)），
之后 `index.js` 的 `process()` 才真正渲染模板（通过 `gooplate` 的
`convert()`），并按每个条目的 `OE`/`line_ending` 写出文件。

### 4.1 输出编码

`files` 展开的 `copy` 条目：

- 字符串条目，或 `IE`、`OE` 都不存在的对象条目：`IE` 置为 `null`，
  `process()` 据此按字节原样复制。若该对象条目写了 `line_ending`，
  `gen_list` 在展开时输出一条警告（`console.error`，含 GCL 文件名与条目
  `filename`），说明 `line_ending` 被忽略。
- `IE`、`OE` 至少存在一个：`IE` 缺省取 `utf8`，`OE` 缺省取 `cpu.OE`；按
  `IE` 解码、按 `OE` 写出。

转换器 `gen_copy_list`/`gen` 产生的条目以及符号表条目的 `OE` 按以下优先级
确定：

1. 转换器描述符中的 `OE` 字段（符号表条目没有）。
2. 所属 CPU 的 `cpu.OE`。

因此，需要转换编码的 `files` 条目与功能库复制条目（描述符为 `IE: 'utf8'`、
不带 `OE`）遵循同一条规则：转换时 `OE` 缺省取 `cpu.OE`。

`cpu.OE` 由 `CPU` 转换器的 `build_list` 从 CPU 文档的 `options.OE` 解析
（与 `options.output_dir` → `cpu.output_dir` 相同的时机）；未指定时取平台
默认值：`step7`/`pcs7` 为 `gbk`，`portal` 为 `utf8bom`。合成的空白 CPU
文档平台为 `step7`，因此为 `gbk`。`gen_list` 中所有条目的通用字段以及
符号表条目都取 `cpu.OE`。

`utf8bom`（别名 `utf8-bom`）不是 `iconv-lite` 的编码名，由 `write_file`
识别，按 `utf8` 编码并加上 BOM（`iconv.encode(..., 'utf8', { addBOM:
true })`）。读取时 `iconv-lite` 默认会剥离源文件的 BOM，因此复制带 BOM 的
源文件不会产生重复 BOM。

规则引擎可以修改或新增条目（见
[design-rules-engine.zh-cn.md](design-rules-engine.zh-cn.md)），因此到达
`process()` 的条目可能没有 `OE`（例如 `add` 新建且未指定 `OE` 的条目）。
这类条目由 `write_file` 按 `utf8` 写出。这是有意的选择：兜底不猜测平台，
需要其他编码时由规则显式指定 `OE`。

### 4.2 输出行尾

每个需要写出文本的条目（转换编码的 `copy` 条目以及所有 `convert` 条目）
的 `line_ending` 按以下优先级确定：

1. 条目自身指定的行尾：`files` 对象条目的 `line_ending` 键，或转换器
   `gen_copy_list`/`gen` 描述符中的 `line_ending` 字段（符号表条目没有）。
2. 所属 CPU 的 `cpu.line_ending`。

`cpu.line_ending` 由 `CPU` 转换器的 `build_list` 从 CPU 文档的
`options.line_ending` 解析（与 `options.OE` 相同的时机）；未指定时为
`LF`，所有平台相同。`gen_list` 中所有条目的通用字段以及符号表条目都取
`cpu.line_ending`。按字节原样复制的 `files` 条目不涉及行尾（见
[§4.1](#41-输出编码)）。

与 `OE` 相同，到达 `process()` 的条目可能没有 `line_ending`（例如规则
`add` 新建且未指定的条目），由 `write_file` 按 `LF` 写出。

## 5. 构建时自生成

`src/converter.js` 是**生成**的，而非手写（其文件头有说明）。
`build.js`：

1. 扫描 `src/converters/` 中的 `converter_<feature>.js` 文件，校验每个
   文件都导出了 `is_feature`/`initialize_list`/`gen`/`gen_copy_list`，
   并收集对应的 `<feature>.template` 与 `<feature>.yaml` 文件。
2. 以转换器模块自身的导出作为 tags，通过 `gooplate` 渲染每个功能的
   `.yaml`（内置符号列表）（因此 `.yaml` 文件可以引用转换器导出的
   `{{NAME}}`/`{{LOOP_NAME}}` 等常量），再把它们拼接为一个多文档的
   `src/symbols_buildin.yaml`（并复制到 `lib/`）。
3. 以发现的功能列表和模板内容渲染 `src/converter.template`（它本身也是
   gooplate 模板），结果写为 `src/converter.js`——由此产生
   `import * as X from './converters/converter_X.js'` 导入块、
   `supported_features` 数组，以及把每个 `.template` 文件内容作为字符串
   常量嵌入的 `templates` 映射表。
4. 用 rolldown 将 `src/index.js` 打包为 `lib/index.js`，`src/cli.js` 打包
   为 `lib/cli.js`。

实际影响：**新增转换器或重命名转换器/模板文件后，必须重新构建**
（`pnpm build`/`pnpm watch`）才能生效；并且绝不应手工编辑
`src/converter.js`——若生成逻辑本身需要修改，请编辑
`src/converter.template`。

## 6. `context` 对象 (`src/util.js`)

一个可变的模块级单例对象，保存横切的运行状态：`module_path`（包根目录，
用于定位模板和库子模块）、`work_path`（当前 GCL 目录，CLI 在 `chdir` 时
修改它）、`version`，以及 I/O 默认值（`output_zyml`、`no_convert`、
`no_copy`、`silent`、`IE`）。`context` 不含 `OE` 与 `line_ending`：输出
编码与行尾只来自条目和 CPU（见 [§4.1](#41-输出编码)、
[§4.2](#42-输出行尾)）。CLI 标志直接修改它；
使用 `src/index.js` 的库调用方也可以在调用 `convert()` 之前做同样的修改。
