# 设计：符号与地址系统

> 本文是 [design-symbols.md](design-symbols.md) 的中文译本。

实现于 `src/symbols.js`（分配、冲突检测、导出）和 `src/s7data.js`（地址
运算、类型化值类）。这是
[spec-gcl-format.zh-cn.md §3.5–3.6](spec-gcl-format.zh-cn.md#35-s7-符号定义)
背后的子系统。

## 1. 地址模型

S7 地址形如 `<block_name><block_no>[.<block_bit>]`，例如 `DB100`、
`M100.0`、`FB512`。前缀按其分配/类型方式分组（`src/symbols.js`）：

| 分组 | 前缀 | 说明 |
|---|---|---|
| `INDEPENDENT_PREFIX` | `OB FB FC SFB SFC UDT` | 按块号编号；类型始终为自身 |
| `INTEGER_PREFIX` | independent + `DB` | 通过 `IntHashList` 按块号编号 |
| `DWORD_PREFIX` | `MD ID PID QD PQD` | 4 字节；类型必须为 `DWORD`/`DINT`/`REAL` |
| `WORD_PREFIX` | `MW IW PIW QW PQW` | 2 字节；类型必须为 `WORD`/`INT` |
| `BYTE_PREFIX` | `MB IB PIB QB PQB` | 1 字节；类型必须为 `BYTE` |
| `BIT_PREFIX` | `M I Q` | 按位寻址；类型必须为 `BOOL` |

`DB` 符号比较特殊：其类型要么是自身（独立 DB），要么是它作为实例/类型化
视图所对应的 `FB`/`SFB`/`UDT` 符号名（`check_type_compatibility`、
`complete_type`）。写入与符号地址前缀不兼容的 `type` 值是硬错误
（`throw_type_incompatible`）。

数值 ↔ 字节.位 转换辅助函数：`dec2foct`/`foct2dec`（十进制偏移 ↔
`[byte, bit]`）、`foct2S7addr`/`s7addr2foct`（`[byte, bit]` ↔ 内部用于
表示 S7 地址的 `12.3` 形式浮点数）、`get_boundary`（字/双字对齐）。

## 2. 冲突检测

两个相互独立的分配器家族，都隶属于 `S7SymbolEmitter`（`src/symbols.js`），
每个 `CPU` 一个实例：

- **`IntHashList`**（`src/s7data.js`）：跟踪按块号编号区域
  （`OB_list`、`DB_list`、`FB_list`、`FC_list`、`SFB_list`、`SFC_list`、
  `UDT_list`）中已使用的整数。`push(null)`（即 GCL 中的地址 `+`）查找下一
  个空闲整数；`push(n)` 保留 `n`，若已被占用则抛出 `HLError`。
- **`S7HashList`**（`src/s7data.js`）：跟踪 `M`/`I`/`Q`/`PI`/`PQ` 区
  （`MA_list`、`IA_list`、`QA_list`、`PIA_list`、`PQA_list`）中已使用的
  字节.位范围，考虑操作数大小（`BOOL` = 0.1 字节即 1 位，直至 `DWORD` =
  4 字节）及字/双字对齐（`get_boundary`）。与 `IntHashList` 相同的
  "自动分配或保留，否则抛出"契约。

`S7SymbolEmitter.build_symbols()` 在每个文档的第 1 遍都注册完符号之后，
每个 CPU 运行一次（由 `'finished'` 事件触发，见
[design-pipeline.zh-cn.md §3](design-pipeline.zh-cn.md#3-两遍处理)）。
对每个符号，它通过相应的分配器解析 `+`/省略的地址，检测重复的显式地址
（`#dict_by_address`），并通过 `complete_type()` 最终确定
`type_name`/`type_no`。任何冲突都会通过 `throw_symbol_conflict` 中止整个
运行，并打印当前符号与先前已注册符号的源位置（file:line:col + 出错的
YAML 片段，通过 `GCL.get_pos_info` 获取）。

符号**名称**的重复检查更早进行，在注册时（`add_symbol`）——但重新声明
*内置*符号的名称是允许的，并被视为对地址/注释的覆盖
（`symbols.is_buildin(name)`），这正是
[spec-gcl-format.zh-cn.md §1.2 `symbols`](spec-gcl-format.zh-cn.md#symbols)
所述覆盖机制的实现方式。

## 3. 内置符号

`src/symbols_buildin.yaml` 在构建时生成（见
[design-pipeline.zh-cn.md §5](design-pipeline.zh-cn.md#5-构建时自生成)），
由各转换器可选的 `<feature>.yaml` 拼接而成。每个这样的文件声明：

- `symbols`：该功能导出的内置符号（例如 `AI.yaml` 以固定默认编号注册
  `AI_Proc` FB 和 `AI_Loop` FC，并使用转换器自身导出的
  `NAME`/`LOOP_NAME` 进行模板化）。
- `reference_symbols`（仅 CPU，例如 `TON`、`GET`、`PUT`、`TCON` 等标准
  `SFB`/`FB`/`FC` 系统功能块）：注册进符号表以便其他代码按名称引用，但
  标记为 `exportable = false`，因此永远不会出现在输出的符号表文件中（它们
  默认已存在于每个 Step 7/Portal 项目中）。

每个文档的 `parse_doc` 步骤（`src/gen_data.js`）会在处理文档自身的
`symbols` 之前，从 `BUILDIN_SYMBOLS` 克隆并注册其功能的内置文档，因此
内置符号总是存在，但可以被覆盖。

## 4. 解析配置值

`make_s7_expression(value, infos)`（`src/symbols.js`）是
[spec-gcl-format.zh-cn.md §3.8](spec-gcl-format.zh-cn.md#38-联合类型)
中所述每一个"该配置值可能是符号定义、符号引用或原始 SCL 表达式"字段背后
的唯一分派器。给定一个原始 YAML 值，它：

1. 对缺失的值立即返回 `undefined`（若设置了 `disallow_null` 则抛出）。
2. 若为数组/YAML 序列且允许符号定义，则将其注册为新符号（`add_symbol`）
   并返回该符号。
3. 若为与已注册符号名匹配的字符串，则返回该符号（通过
   `apply_default_force` 应用 `force`/`default` 类型/注释覆盖）。
4. 若为*尚未*注册的字符串，则返回一个 `Promise`：当该名称随后被注册时
   （监听 `<name>_added`）完成；或者在所有文档处理完毕后（`'finished'`）
   回退为当作原始 SCL 表达式处理（记录在 `cpu.non_symbols` 中用于运行
   结束时的警告）——除非设置了 `disallow_s7express`，此时为硬错误。
5. 否则（数字/布尔字面量，或本身就像 SCL 表达式的字符串）将其包装为普通
   的 `{ value, isExpress }` 引用对象。

`infos.force`/`infos.default` 让转换器可以固定某个字段的类型（例如 AI 的
`DB` 字段必须为 `AI_Proc` 类型），或提供回退注释，而不会覆盖用户已提供
的值。

## 5. 符号表导出

`gen_symbols(cpu)`（`src/symbols.js`）为每个 CPU 额外产生一个 `convert`
任务，将该 CPU 的完整符号列表（先按地址、再按名称排序）渲染为目标工具
所需的文本格式：

- **Step 7**（`platform !== 'portal'`）：固定列宽的
  `126,<name> <address> <type> <comment>` 行，写为 `symbols.asc`。
- **Portal**：类 CSV 的带引号行
  `"name","%address","type","True","True","False","comment","","True"`，
  写为 `symbols.sdf`。`OB`/`FB`/`FC`/`SFB`/`SFC`/`UDT` 符号不包含在
  Portal 导出中（它们不属于变量表条目）。

两种格式都只包含 `exportable !== false` 的符号。
