# 设计：interlock 转换器

行为规格见 [spec-converters.zh-cn.md](spec-converters.zh-cn.md#interlock)；
所有转换器共用的接口与生命周期见
[design-converters.zh-cn.md](design-converters.zh-cn.md)；用户手册见
[guide-interlock.zh-cn.md](manual/guide-interlock.zh-cn.md)。

`interlock` 是唯一不依托 FB 库块、由转换器直接写出全部逻辑的功能：每个
联锁组由 `data`/`input`/`reset`/`output` 合成一段锁存逻辑，最终全部写入
一个自包含的 `Interlock_Loop.scl`。

## 1. 文件

| 文件 | 内容 |
|---|---|
| `src/converters/converter_interlock.js` | `platforms = ['step7', 'portal']`；`LOOP_NAME = 'Interlock_Loop'`；`is_feature` 不区分大小写地匹配 `interlock` 或 `il` |
| `src/converters/interlock.yaml` | 内置符号 `[{{LOOP_NAME}}, FC518, ...]`，没有 FB |
| `src/converters/interlock.template` | 所有联锁 DB 的 `DATA_BLOCK` 与 `Interlock_Loop` 函数 |

无子模块、无库文件：`gen_copy_list` 返回 `[]`。

## 2. 数据模型：DB 与组两层

YAML `list` 的每一项是一个**联锁 DB**，其下有一个或多个**联锁组**（下称
group）：`groups` 的每一项是一个 group；没有 `groups` 时，`list` 项本身
就是唯一的 group。`initialize_list` 把每个 `list` 项解析为一个 DB 对象
（`parse_DB`），`area.list` 与 YAML `list` 一一对应。两个层级：

| 层级 | 对象 | 拥有 |
|---|---|---|
| DB | `{ name, comment, symbol, fields, data_dict, interlocks, edges }` | `enable` 字段、字段命名空间、data 名称表、边沿字段、读入/写出阶段、resettable 清零 |
| group | `{ node, comment, extra_code, input_list, reset_list, output_list }` | 本组的输入、组级复位、输出与附加代码 |

**DB 不只是存储容器**。以下语义都是 DB 级、由同一 DB 下所有 group 共享的：

1. **`enable` 是 DB 级的**。`create_fields()` 为每个 DB 只创建一个
   `enable` 字段，`enable`（读入来源）和 `$enable`（初值）只能写在 DB 层。
   模板中每个 group 都以 `IF NOT "<DB>".enable` 开头，即同一 DB 的所有
   group 同时启停。没有组级使能：需要独立启停的组放在单独的 DB 中，或用
   data 项与 `and` 输入组合出条件。
2. **字段命名空间是 DB 级的**：`fields`（见 §4）。
3. **data 名称表 `data_dict` 是 DB 级的**：data 在所有 group 之前解析，
   所以每个 group 都能按名称引用该 DB 的任一 data 项（见 §3.2）。
4. **读入/写出、resettable 清零是 DB 级的**：所有 `read` 在该 DB 第一个
   group 之前执行，所有 resettable 清零与 `write` 在该 DB 最后一个 group
   之后执行（见 §6）。
5. **执行顺序与配置顺序一致**：DB 按 `list` 顺序，group 按 `groups` 顺序。

## 3. `initialize_list`

`initialize_list` 用一个 `Set`（`DB_names`）记录已解析的 DB 名称，专用于
DB 重名检查，对每个 `list` 项调用 `parse_DB(document, node, DB_names)`。`parse_DB` 依次解析 DB、`enable`/
`$enable`、`data`，最后解析 group；`parse_IL_expression`、`conv_rest`、
`parse_group` 都是 `parse_DB` 内的闭包，共享该 DB 的 `fields`/`data_dict`。

### 3.1 DB

- `DB` 缺失时 `elog('interlock转换必须有DB块!')`。
- `get_DB_name(document, DB)`：`DB` 为数组/序列（符号定义）时先
  `add_symbol` 取得名称，否则取字符串值；不是字符串时 `elog`。
- 名称已在 `DB_names` 中时 `elog`（`interlock 的 DB "…" 重复！…`），提示
  改用 `groups`。`DB_names` 存的是名称字符串：符号定义时为符号名，符号
  引用时为原样写的字符串；后者因 `disallow_s7express` 必须解析为已有符号，
  所以两者都是符号名，比较区分大小写。检查范围为本文档，即本 CPU
  （同一 CPU 只能有一个 interlock 文档）。因此无论 DB 在 `symbols` 中统一
  定义后在 `list` 中引用，还是在 `list` 中定义，两个 `list` 项使用同一
  符号名都由此报错。符号表另外负责：同一符号定义两次（符号重名）、两个
  不同符号指向同一 DB 号（重复地址）。
- 对名称调用
  `make_s7_expression(name, { disallow_s7express: true, disallow_symbol_def: true, force: { type: name } })`，
  结果存入 `DB.symbol`。`force` 把符号类型固定为它自己，即全局 DB（不是
  FB 背景块），与 `AI` 把 DB 固定为 `AI_Proc` 背景块是同一机制。用户定义
  了其它类型时，该符号进入 `WRONGTYPESYMBOLS`，转换结束时警告并按全局 DB
  处理。`force` 在符号解析时生效（前向引用在 `_added` 事件时），早于
  `finished` 时 `build_symbols` 中的 `complete_type` 校验。地址是位/字节/
  字等存储区（如 `M10.0`）时，`force` 当场报类型不兼容；地址是 FB/FC 等
  块时，其类型本就是自身，`force` 拦不住，由 `build_list` 的 DB 块检查
  报错（§5）。
- `DB.comment`：`list` 项的 `comment`（`nullable_value(STRING)`），可为空。

### 3.2 值的解析：`parse_IL_expression`

`input`、`reset`、`output` 中的单个布尔值都经此函数解析，依次判断：

1. `null`/`undefined` → 原样返回。
2. 字符串（含 YAML Scalar）：
   - 去掉首尾空白后不区分大小写地等于 `enable` → `elog`（input、reset、
     output 中都不能使用 `enable`）；
   - 命中 `data_dict` → data 的 `type`（缺省 `BOOL`）不是 `BOOL` 时 `elog`；
     否则返回
     `{ ref, value: { value: '"<DB>".<name>' }, trigger_type, comment }`，
     `ref` 指向 data 字段对象。
3. 字符串或序列 → `make_s7_expression(expr, { force: { type: 'BOOL' }, ... })`，
   异步写入 `ret.value`。符号引用会被强制为 `BOOL` 类型；未定义的名称最终
   落为原样 SCL 表达式（不加引号、不报错）。
4. 其它（映射等）→ 返回 `null`，由调用方按完整对象形式处理。

第 2 步的查找发生在解析当时；由于 data 先于所有 group 解析，此时
`data_dict` 已包含该 DB 的全部 data 项。

### 3.3 `enable` / `$enable`

- `enable`：`node.get('enable')` 不为空时（含 `false` 等字面量），
  `make_s7_expression(enable, { force: { type: 'BOOL' } })` →
  `fields.enable.read`。它必须是可赋值的地址，在 `build_list` 中检查
  （§5）。
- `$enable`：`nullable_value(BOOL, ...)`，存在时设置
  `fields.enable.init` 为 `'TRUE'`/`'FALSE'`（默认 `'TRUE'`）。

### 3.4 group 的划分

组级键为 `GROUP_KEYS = ['input', 'reset', 'output', 'extra_code']`，另有
`comment`。`list` 项的 `comment` 总是 DB 注释。

- `list` 项有 `groups` 键时：
  - DB 层出现任一组级键则 `elog`（`… 有 groups 时，不能在 DB 层设置 …`，
    列出出现的键）；
  - `groups` 不是至少 1 项的序列时 `elog`；
  - 每项不是映射时 `elog`，否则 `parse_group(item)`。
- 没有 `groups` 时：`parse_group(node, true)`，`list` 项本身是唯一的
  group。此时 `comment` 属于 DB，该 group 视为没有自己的注释。

`parse_group` 读取：

- `comment`：`nullable_value(STRING, ...)?.value`，可为空；简写形式下不读取。
  为空时在 `build_list` 中取 DB 注释（§5）。
- `extra_code`：`nullable_value(STRING, ...)?.value`。
- `input`/`reset`/`output`：见 §3.6–§3.8。

### 3.5 `data`

`data` 在 group 之前解析，必须是序列，否则 `elog`。每项：

- 字符串简写：`{ name: <Scalar>, s7_m_c: true }`（`name` 保存的是 YAML
  Scalar 节点本身，依赖其 `toString()` 拼接）。
- 映射：`name`（`ensure_value(STRING)`，必填）、`comment`、`type`
  （`is_common_type` 通过时采用，否则为 `BOOL`）、`read`/`write`（均以
  `force: { type }` 调用 `make_s7_expression`）、`$value`（初值，见下）。
- `$value`：不为空时按 `type` 的大写查 `INIT_FORMATTERS`，转换为 SCL 字面量
  存入 `data.init`，由 `build_list` 写进声明：`BOOL` → `TRUE`/`FALSE`；
  `BYTE`/`WORD`/`DWORD` → `B#16#`/`W#16#`/`DW#16#` 十六进制（无符号，按位数
  校验范围）；`INT` → 十进制（16 位范围）；`DINT` → `L#…`；`REAL` → 带小数点
  的十进制。转换失败（类型或范围不符）时 `elog`。字符串简写的 data 没有初值。
- 其它形式 `elog`。
- 随后 `fields.push(data)` 并登记 `data_dict[name] = data`。

### 3.6 `input`

`input` 必须是至少 1 项的序列，否则 `elog`（每个 group 都必须有自己的
`input`）。每项：

- 简写：`parse_IL_expression(item, { trigger_type: 'rising' })`。
- 映射：`trigger`（转小写，默认 `rising`，不在
  `TRIGGER_TYPES = ['rising', 'falling', 'change', 'on', 'off']` 中时 `elog`）、
  `comment`，以及 `and` 或 `value` 二选一：
  - `and` 必须是序列，每项经 `parse_IL_expression` 解析，结果为空（映射、
    空值）时 `elog`，最终为 `{ items, trigger_type, comment }`；
  - 否则 `parse_IL_expression(value, { trigger_type, comment })`，结果为空
    （缺少 `value`，或 `value` 是映射）时 `elog`。
  - 映射中的 `name` 不被读取。
- 每个 input 对象（包括命中 data 的引用对象，它是新对象而非 data 字段本身）
  都 `fields.push(input)`，因而被自动命名为 `b_<n>`（见 §4）。

### 3.7 `reset`（组级）与 `conv_rest`

`reset` 必须是序列。每项经 `conv_rest(item, false)`；输出项的 `reset` 经
`conv_rest(reset, true)`：

- 不是 JS 字符串、YAML 字符串 Scalar 或序列时 `elog`。
- Scalar 取 `item.value`；JS 字符串原样；序列（符号定义）原样交给
  `parse_IL_expression`，由 `make_s7_expression` 定义符号。
- 字符串中出现特殊变量 `inputs`（`INPUTS_REGEX`，不区分大小写，前面不是
  标识符字符、`.` 或 `"`，后面不是标识符字符或 `"`，所以 `NOT(inputs)`
  能识别，`"X".inputs`、`"inputs"` 不会被误认）时：
  - 组级 `reset`（`allow_inputs` 为假）`elog`：组级复位在计算输入之前
    执行，`inputs` 没有意义；
  - 输出项的 `reset` 把它替换为 `output`（模板中的 `VAR_TEMP output`，即
    本组本周期的输入 OR 结果）。
- 然后 `parse_IL_expression(expr)`。

这只是基于正则的识别，彻底的解决有赖于将来引入 SCL 解析器。

### 3.8 `output`

`output` 必须是序列。每项：

- 简写：`parse_IL_expression(item)`。
- 映射：`comment`、`value`（`parse_IL_expression`，结果为空时 `elog`）、
  `reset`（`conv_rest(reset, true)`）。
- `inversion`：`ensure_value(BOOL, ... ?? false)`；`default`：
  `nullable_value(BOOL, ...)`。
- 派生三个字面量：`setvalue = inversion ? 'FALSE' : 'TRUE'`，
  `resetvalue = inversion.toString()`，`defaultvalue` 为 `default`
  （若给出）否则等于 `resetvalue`。

输出不登记到 `fields`，也不检查可赋值性（与 `AO`/`RP` 的 `is_assignable`
不同）。

## 4. 字段命名空间与重名处理

`create_fields()` 为每个 DB 创建一个类字典对象 `fields`
（name → field），预置 `enable`，并带一个不可枚举的 `push(item)`：

- 名称不区分大小写地比较（S7 标识符不区分大小写），已用名称以小写形式
  记录在 `lower_names` 中，预置 `enable`。
- `item.name` 为空时自动命名为 `b_<++index>`，并跳过 `b_<n>` 或
  `b_<n>_fo` 已被占用的序号；`index` 是 DB 级计数器。由于 data 先于所有
  input 登记，自动名与边沿字段名不会和 data 名冲突。
- 名称已被占用时 `elog('interlock 项属性 name:… 重复定义或已保留!请改名')`。

进入 `fields` 的只有 `enable`、data 字段、input 对象；reset、output 不进入。
由此在同一 DB（跨其所有 group）内：

| 情形 | 结果 |
|---|---|
| data 重名 | 报错 |
| data 名为 `enable` | 报错 |
| 名称仅大小写不同（`reset`/`Reset`、`Enable`） | 报错 |
| data 名为 `b_<n>` 或 `b_<n>_fo` | 正常，input 的自动名跳过该序号 |
| 不同 DB 中同名 data | 正常，各自独立 |
| 多个 group 引用同一个 data | 正常，引用的是同一字段 |
| 多个 group 以同一目标作为 output | 不检查，同一周期内后执行的 group 的赋值生效 |

`b_<n>` 中的 `<n>` 是该 input 在本 DB 所有 group 中的累计序号（含不需要
边沿字段的 `on`/`off` 项，以及因 data 占用而跳过的序号，所以边沿字段编号
可能不连续）。

## 5. `build_list`

对每个 DB，先做 DB 块检查：`DB.symbol.type` 必须等于 DB 名，且
`DB.symbol.block_name` 必须为 `DB`，否则 `elog`（必须是全局 DB 块）。
`force` 已把类型固定为自身，这一步主要拦下地址为 FB/FC 等块的符号。
同时检查 `enable` 的读入来源：有 `fields.enable.read` 而 `is_assignable`
为假（字面量或复合表达式）时 `elog`，提示设初值请用 `$enable`。然后：

1. 注释：
   - `DB.comment ||= DB.symbol.comment ?? ''`：模板显示的 DB 注释依次取
     `list` 项的 `comment`、符号注释；
   - `DB.symbol.comment ||= DB.comment`：符号表注释依次取符号自己的注释、
     上面的 DB 注释；
   - 每个 group：`interlock.comment ||= DB.comment`，即没有自己的注释时取
     DB 注释。
2. 遍历 `Object.values(fields)`（enable、data、input）：
   - `expression = '"<DB>".<name>'`；
   - 有 `read` → `assign_read = '<expression> := <read>;'`；
     有 `write` → `assign_write = '<write> := <expression>;'`；
   - `s7_m_c` 为真（enable 与 data）→
     `declaration = '<name> {S7_m_c := 'true'} : <type>[ := <init>] ;'`，
     `type` 缺省 `BOOL`；`init` 来自 `$enable`（enable）或 `$value`（data）。
3. `declarations` = `s7_m_c` 字段；`read_list`/`write_list` 为其中带
   `read`/`write` 的子集。
4. 每个 group 的每个 input：
   - `and` 形式：各项值（表达式加括号）以 ` AND ` 连接，触发表达式中整体
     再加括号；并把 `input.value` 覆写为 `{ value: <and 串>, isExpress: false }`
     供边沿维护使用。
   - 普通形式：表达式值加括号。
   - 按 `trigger_type` 生成 `trigger`，边沿类同时设置
     `edge_field = '<name>_fo'` 并加入 `DB.edges`：

     | `trigger_type` | `trigger` | 边沿字段 |
     |---|---|---|
     | `rising` | `v AND NOT "DB".b_n_fo` | 有 |
     | `falling` | `NOT v AND "DB".b_n_fo` | 有 |
     | `change` | `v XOR "DB".b_n_fo` | 有 |
     | `on` | `v` | 无 |
     | `off` | `NOT v` | 无 |

5. 组级 `reset` 与输出项 `reset` 中引用的、**没有 `read`** 的 data 字段标记
   `resettable = true`。
6. 输出项引用了带 `read` 的 data 字段时 `elog`。
7. 被输出项引用、又被标记为 resettable 的 data 字段，按流水线惯例
   `console.error('warning: 警告：…')` 警告：它每周期末被清零，HMI 与
   `write` 只能看到 `FALSE`。不报错，因为 A 组输出、B 组以之复位可以构成
   一个周期内有效的内部脉冲。

## 6. 模板与执行顺序

`DATA_BLOCK`：每个 DB 一个，Portal 上加
`{ S7_Optimized_Access := 'FALSE' }`，否则 `{ S7_m_c := 'true' }`；
`STRUCT` 先列 `declarations`（enable、data，按登记顺序），再列每个边沿字段
`<b_n>_fo : BOOL`（注释固定为"上升沿"，不区分触发类型）。不写 `BEGIN` 初值。

`FUNCTION "Interlock_Loop" : VOID`，`VAR_TEMP reset, output : BOOL`，在
`loop_begin` 之后，每个 DB 先输出一行段标题
`// ===== DB "<DB>": <DB.comment>`（DB 注释为空时省略 `: <DB.comment>`），
其下各组的注释行构成"DB → 组"的层次，读入、复位、写出各段的注释行不再
重复 DB 名。然后：

1. 读入：`read_list` 的 `assign_read`（含 `enable` 的读入）。
2. 每个 group：
   1. 有组级复位时：`reset := r1 OR r2 ...;`
   2. `IF NOT "DB".enable THEN` 输出 := `defaultvalue`；
      （有组级复位时）`ELSIF reset THEN` 输出 := `resetvalue`；
      `ELSE` `output := trigger1 OR trigger2 ...;`，`IF output THEN`
      输出 := `setvalue`；随后对每个带单独 `reset` 的输出：
      `IF <reset> THEN 输出 := resetvalue`。
   3. 边沿维护：`"DB".b_n_fo := v;`——无论使能、复位与否每周期都执行，
      所以复位或未使能期间出现的边沿会被吞掉。
   4. `extra_code` 原样输出。
3. 所有 `resettable` 字段 `:= FALSE`。
4. 写出：`write_list` 的 `assign_write`。

最后 `loop_end`。由于读入在前、清零与写出在后，一个 resettable 的 data
项在本周期内能被该 DB 的所有 group 看到，然后才被清零。

## 7. `gen` / `gen_copy_list`

`gen` 返回一个描述符：`distance = <CPU.output_dir>/<options.output_file ?? 'Interlock_Loop.scl'>`，
`output_dir = context.work_path`，`tags = { LOOP_NAME }`，
`template = 'interlock.template'`。`gen_copy_list` 返回 `[]`。

## 8. 已知限制

1. **未知键静默忽略**：DB 层与 group 中的未知键（包括旧写法的 group
   `name`）不报错。其它功能同样不检查，属于全项目的话题。
2. **可赋值性只是粗略判断**：`enable` 的地址检查复用 `is_assignable`，
   只能区分字面量、复合表达式与单个变量，不能确认变量真实存在。
3. **反相输出的初值**：`inversion: true` 时复位值为 `TRUE`，但 DB 字段初值
   为 `FALSE`；没有组级或单独复位时，输出一旦动作就回不到 `TRUE`。不自动
   修改初值，因为多组写同一字段且取值不同时会更难预料；由手册提示。
4. **跨 DB 写字段的时序**：写另一 DB 的字段时，若对方 DB 排在前面，下一
   周期才看到。
5. **SCL 表达式不做解析**：未定义或拼错的名称、表达式内部的 data 名称、
   `inputs` 的识别都只能按字符串处理，有赖于将来引入 SCL 解析器。同理，
   input/reset/output 中只拦得住裸写的 `enable`，写成本 DB 的完整地址
   （如 `'"IL_pump".enable'`）会被当作普通表达式放过。
