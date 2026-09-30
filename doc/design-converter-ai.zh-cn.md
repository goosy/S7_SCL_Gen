# 设计：AI 转换器

> 本文是 [design-converter-ai.md](design-converter-ai.md) 的中文译本。

行为规格见 [spec-converters.zh-cn.md](spec-converters.zh-cn.md#ai)；所有
转换器共用的接口与生命周期见
[design-converters.zh-cn.md](design-converters.zh-cn.md)。

## 1. 文件

| 文件 | 内容 |
|---|---|
| `src/converters/converter_AI.js` | `platforms = ['step7', 'portal', 'pcs7']`；`NAME = 'AI_Proc'`、`LOOP_NAME = 'AI_Loop'`；`is_feature` 对 `AI` 做不区分大小写匹配 |
| `src/converters/AI.yaml` | 内置符号 `[{{NAME}}, FB512, ...]`、`[{{LOOP_NAME}}, FC512, ...]` |
| `src/converters/AI.template` | 实例 DB 与 `AI_Loop` 函数 |
| `src/converters/analog_common.js` | 模拟量共用库：原始值常量（`S7_*`）与默认值常量（`DEFAULT_*`）；与 `alarm` 共用 `make_fake_DB`、`make_alarms`（超限判断与量程键），与 `AO` 共用 `raw_SP`（见 [§2.1](#21-raw_sp)） |
| `AI_Proc/`（子模块） | `AI_Proc(<platform>).scl` |

## 2. `initialize_list`

沿用 [design-converters.zh-cn.md §3](design-converters.zh-cn.md#3-通用的逐条目生命周期)
的逐条目骨架，每个 YAML 条目得到一个 `AI` 对象：

- `location`/`type`/`comment` 为字符串，`comment` 缺省为
  `location + type`。
- 既无 `DB` 也无 `input` 的条目原样返回、不做处理。
- `DB`：先用 `make_fake_DB(DB)` 放一个占位 `{ name }`（`make_alarms` 的
  描述文字要用），再
  `make_s7_expression(DB, { disallow_s7express: true, force: { type: NAME } })`。
- `input`：`make_s7_expression`，`force: { type: 'WORD' }`。
- 默认值：`$zero_raw`/`$span_raw`/`$overflow_SP`/`$underflow_SP` 在此处
  补齐默认值（`DEFAULT_ZERO_RAW`、`DEFAULT_SPAN_RAW`、`DEFAULT_OVERFLOW_SP`、
  `DEFAULT_UNDERFLOW_SP`，即 `0`/`27648`/`28000`/`-500`），`$zero`/`$span`
  由 `make_alarms` 补齐（`DEFAULT_ZERO`/`DEFAULT_SPAN`）。此后它们总有值，
  模板总是写出，`build_list` 直接读取，实例 DB 不依赖 `AI_Proc` 声明中的
  默认值。
- `$zero_raw`/`$span_raw`：`new INT(...)`。
- `$overflow_SP`/`$underflow_SP`：`raw_SP(value, desc, zero_raw, span_raw)`，
  `zero_raw`/`span_raw` 取上面的结果。它们都是静态值，所以换算在这一遍
  完成，模板直接输出结果。
- 其余超限判断键由 `make_alarms(AI, node, document)` 处理。

### 2.1 `raw_SP`

`src/converters/analog_common.js` 导出
`raw_SP(value, desc, zero_raw = 0, span_raw = S7_SPAN)`，返回 `INT` 或
`undefined`：

- `undefined`/`null` → `undefined`（键省略）。
- 字符串须匹配 `/^\s*([+-]?\d+(\.\d+)?)\s*%\s*$/`，否则 `elog`；原始值为
  `Math.round(zero_raw + pct * (span_raw - zero_raw) / 100)`。必须先识别
  `%`，因为 `Integer` 用 `parseInt` 会把 `'105%'` 静默解析为 `105`。
- 数字须为整数，否则 `elog`；原样作为原始值。
- 结果经 `ensure_value(INT, ...)`，超出 INT 时以
  `SyntaxError('... 超出 INT 范围')` 报错。

`AO` 调用时不传后两个参数（即 `0`/`27648`），所以两者的 `%` 写法共用同一
公式。所有错误都发生在第 1 遍，由 `gen_data` 捕获并记录后停止转换。

## 3. `build_list`

对每个有 `DB` 的条目先执行 `check_raw`，再拼接 FB 调用参数：

- `check_raw`：
  - `zero_raw`/`span_raw` 相等时 `elog`。
  - `$overflow_SP`/`$underflow_SP` 原始值 `<= -32768` 或
    `>= 32767` 时 `elog`——这两个值是 `AI_Proc` 的非测量值标志，阈值落在
    其上则溢出判断失去意义（FB 先按 `AI_error` 处理这两个值）。
  - 上溢出值 `high = $overflow_SP.value` 不大于下溢出值
    `low = $underflow_SP.value` 时 `elog`。
- `input_paras`：把已配置的 `input`（作为 `AI`）与 `enable_HH`/`enable_H`/
  `enable_L`/`enable_LL` 拼成 `name := value` 列表，供模板生成调用。

错误信息以 `<CPU>:AI (<comment>)` 开头。

## 4. 模板

- 每个有 `DB` 的条目一个 `DATA_BLOCK {{AI.DB.value}}`，Portal 上加
  `{ S7_Optimized_Access := 'FALSE' }`；`BEGIN` 段总是写出
  `enable_HH`…`enable_LL`、`zero_raw`、`span_raw`、`overflow_SP`、
  `underflow_SP`、`zero`、`span` 初值，其余成员（各 `*_limit`、
  `dead_zone`、`FT_time`）仅在已定义时写出。
- `AI_Loop` 支持 `loop_begin`/`loop_end`；有 `DB` 且 `input_paras` 非空的
  条目生成 FB 调用（非 Portal 前缀 `"{{NAME}}".`），每个条目都输出
  `// {{AI.comment}}` 注释。

## 5. `gen` / `gen_copy_list`

`gen` 输出 `<output_dir>/AI_Loop.scl`（可被 `options.output_file` 覆盖）；
`gen_copy_list` 把 `AI_Proc/AI_Proc(<platform>).scl` 复制为
`<output_dir>/AI_Proc.scl`，`IE: 'utf8'`。
