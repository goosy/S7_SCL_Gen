# 设计：转换器插件接口

> 本文是 [design-converters.md](design-converters.md) 的中文译本。

[spec-converters.zh-cn.md](spec-converters.zh-cn.md) 中的每个功能都实现为
`src/converters/converter_<feature>.js` 下的一个自包含模块，在构建时被
自动发现并组装（见
[design-pipeline.zh-cn.md §5](design-pipeline.zh-cn.md#5-构建时自生成)）。
本文涵盖每个转换器必须满足的接口契约、模板渲染约定，以及不属于行为规格的
值得注意的各功能实现细节。单个功能较完整的实现说明放在独立的
`design-converter-<feature>.zh-cn.md` 中。

## 1. 必需的导出

| 导出 | 必需 | 签名 | 用途 |
|---|---|---|---|
| `platforms` | 是 | `string[]` | 该功能支持 `step7`/`portal`/`pcs7` 中的哪些；若文档所属 CPU 的平台不在此列表中，`parse_doc` 会跳过该文档（并发出警告）。 |
| `is_feature(name)` | 是 | `(string) => boolean` | 与文档的 `feature` 指令做不区分大小写的匹配，包括所有别名（如 `MT`/`modbusTCP`、`SC`/`MB`、`interlock`/`il`）。 |
| `initialize_list(area)` | 是 | `(Area) => void` | 第 1 遍：就地将 `area.list` 从原始 YAML 节点改写为普通对象；通过 `make_s7_expression`/`add_symbol` 注册/解析符号。 |
| `gen(area)` | 是 | `(Area) => ConvertDescriptor[]` | 返回零个或多个 `{ distance, output_dir, tags, template, OE?, line_ending? }` 描述符，描述生成的输出文件。可选的 `OE`/`line_ending` 覆盖所属 CPU 的默认值（见 [design-pipeline.zh-cn.md §4.1](design-pipeline.zh-cn.md#41-输出编码)、[§4.2](design-pipeline.zh-cn.md#42-输出行尾)）。`template` 是生成的 `templates` 映射表（§2）中的键名，按惯例为 `<feature>.template`。 |
| `gen_copy_list(area)` | 是 | `(Area) => CopyDescriptor[]` | 返回零个或多个 `{ source, input_dir, distance, output_dir, IE, OE?, line_ending? }` 描述符，用于复制静态库文件（见 [spec.zh-cn.md §5](spec.zh-cn.md#5-外部依赖)）。可选的 `OE`/`line_ending` 同上。 |
| `build_list(area)` | 否 | `(Area) => void` | 第 2 遍，在所有 CPU 的符号完全解析后运行（见 [design-pipeline.zh-cn.md §3](design-pipeline.zh-cn.md#3-两遍处理)）；仅当功能有跨条目或跨符号的派生数据时才需要。 |
| `<feature>.yaml` | 否 | — | 该功能的内置符号声明，见 [design-symbols.zh-cn.md §3](design-symbols.zh-cn.md#3-内置符号)。 |
| `<feature>.template` | 按惯例必需 | — | `gen()` 的描述符按名称引用的 gooplate 模板。 |

`build.js` 在构建时强制检查每个 `converter_*.js` 文件都具备这四个必需
函数，缺失则抛出异常——这是权威列表，而不仅仅是惯例。

转换器可以自由导出额外的具名常量（`NAME`、`LOOP_NAME`、`POLLS_NAME` 等——
见各转换器）；这些常量通常既在 `gen()` 的 `tags` 中复用，也在该功能自己的
`<feature>.yaml` 中复用（后者以转换器模块本身作为 gooplate tags 渲染，
因此例如 `AI.yaml` 可以写 `{{NAME}}`/`{{LOOP_NAME}}`）。

## 2. `templates` 映射表

`gen()` 从不自己读取模板文件；它只是给出名称（`template: 'AI.template'`）。
`gen_list()`（`src/gen_data.js`）在生成的 `src/converter.js` 所导出的
`templates` 对象中查找该名称，该对象在构建时把每个
`src/converters/*.template` 文件的内容嵌入为字符串常量。这意味着：

- 模板是纯粹的 [gooplate](https://www.npmjs.com/package/gooplate) 语法——
  模板语言本身（`{{if}}`/`{{for}}`/`{{_...}}` 续行、`{{// comment}}` 等）
  请查阅 gooplate 自己的文档/API；本项目只提供 tags。
- 模板可用的 tags 是以下三者的并集：`gen_list()` 始终注入的通用 tags
  （`context`、`gcl`、`pad_left`/`pad_right`/`fixed_hex`、`cpu_name`、
  `feature`、`platform`）、`Area` 上的全部内容（`includes`、`list`、
  `loop_begin`、`loop_end`、`options` 等），以及 `gen()` 放入其描述符
  自身 `tags` 的内容。
- 修改 `.template` 文件内容后，要到下一次 `pnpm build` 才生效（或在
  `pnpm watch` 下自动生效，它会在 `.scl`/`.yaml` 变化时重新构建）——
  而不是立即生效，因为内容已被固化进 `src/converter.js`。

## 3. 通用的逐条目生命周期

几乎所有转换器（`CPU` 和 `interlock` 除外，它们是以 CPU/DB 为中心而非
每条目一个对象的结构）都遵循相同的 `initialize_list` 骨架：

```js
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const item = { node, comment: new STRING(node.get('comment') ?? '') };
        const DB = node.get('DB');
        if (!DB) return item; // an item without a DB is left inert
        make_s7_expression(DB, {
            document, disallow_s7express: true,
            force: { type: NAME },      // pin the instance DB's type to this feature's FB
            default: { comment: item.comment.value },
        }).then(symbol => { item.DB = symbol; });
        // ...resolve the remaining fields the same way...
        return item;
    });
}
```

（注释大意：没有 DB 的条目保持惰性不处理；将实例 DB 的类型固定为本功能的
FB；其余字段按同样方式解析。）

由于 `make_s7_expression` 可能返回 `Promise`（前向引用），赋值总是在
`.then()` 中进行——等到 `build_list`/`gen` 运行时，流水线排队的每个
Promise 都已完成（见
[design-pipeline.zh-cn.md §3](design-pipeline.zh-cn.md#3-两遍处理)），
所以下游代码可以同步读取 `item.DB.value`/`item.DB.block_no` 等。
**转换器绝不能在调用 `make_s7_expression` 之后立刻同步读取其结果**——
只能在第 2 遍（`build_list`）或之后读取。

## 4. 值得注意的各功能差异

- **`CPU`**：`list` 条目是原始的 `OB`/`FC` 块（`block` + `code`），而非
  每条目一个 DB 的模式；`build_list` 会校验 `block.block_name` 为 `OB` 或
  `FC`。它还会从 `Clock_Byte` 内置符号派生标准时钟位符号，并解析
  `options.output_dir`（流水线其余部分将其作为 `CPU.output_dir` 读取），
  `options.OE`（未指定时取平台默认值，作为 `CPU.OE` 读取，见
  [design-pipeline.zh-cn.md §4.1](design-pipeline.zh-cn.md#41-输出编码)），以及
  `options.line_ending`（未指定时为 `LF`，作为 `CPU.line_ending` 读取，见
  [design-pipeline.zh-cn.md §4.2](design-pipeline.zh-cn.md#42-输出行尾)）。
- **`AI`/`limit`**：通过 `src/converters/analog_common.js` 中的
  `make_limit()`/`make_fake_DB()` 共享限值/量程字段的解析，而不是各自
  重复实现——完整字段列表见该文件自身的文档注释。`make_fake_DB` 使模板
  在真实符号 Promise 完成之前也能渲染一个占位的 `AI.DB`（这是必要的，
  因为在某些仅用于信息展示的渲染路径中，`gen()` 可能在所有 Promise
  完成之前就运行）。`AI` 的细节见
  [design-converter-ai.zh-cn.md](design-converter-ai.zh-cn.md)，`limit`
  的细节见
  [design-converter-limit.zh-cn.md](design-converter-limit.zh-cn.md)。
- **`AO`**：见 [design-converter-ao.zh-cn.md](design-converter-ao.zh-cn.md)。
  `AI` 与 `AO` 共用 `src/converters/analog_common.js` 中的原始值设定转换
  （`raw_SP`，含 `%` 写法）。
- **`interlock`**：唯一一个不依托 FB、由转换器直接写出全部逻辑的功能。
  每个 `list` 条目是一个联锁 DB（DB 名称不得重复），其下有一个或多个
  联锁组（`groups`，或以条目本身作为唯一的组），`area.list` 的每一项是
  一个 DB 对象而非单个组。见
  [design-converter-interlock.zh-cn.md](design-converter-interlock.zh-cn.md)。
- **`MT`/`SC`**：两者都把多条轮询的请求/响应报文打包进一个共享的结构体
  DB（`MT_polls_DB`/`SC_polls_DB`），字节偏移由程序手动计算
  （`poll_index`，按每条轮询的报文长度递增，并做字对齐）——这些簿记工作
  完全在 `build_list` 中进行，因为它需要先知道整个 CPU 上每条轮询的最终
  报文长度。
- **`RP`**：唯一一个实例 DB 名称和复制的库文件不与 `NAME`/`LOOP_NAME`
  常量对应的功能——`RP.FB` 按条目的 `type` 从 `FB_dict` 中逐条选取，而
  `gen_copy_list` 总是同时复制 `CP.scl` 和 `DP.scl`，无论实际用到了哪些
  类型。
- **`motor`/`valve`**：参数列表的渲染在 `build_list` 内部根据
  `document.CPU.platform` 分支（Portal：一次输入+输出合并的位置参数调用；
  Step 7/PCS7：仅输入参数的调用加上单独的输出赋值语句），而不是把分支
  推给模板——见各转换器的 `build_list`。
