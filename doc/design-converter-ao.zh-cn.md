# 设计：AO 转换器

> 本文是 [design-converter-ao.md](design-converter-ao.md) 的中文译本。

行为规格见 [spec-converters.zh-cn.md](spec-converters.zh-cn.md#ao)；所有
转换器共用的接口与生命周期见
[design-converters.zh-cn.md](design-converters.zh-cn.md)。

## 1. 文件

| 文件 | 内容 |
|---|---|
| `src/converters/converter_AO.js` | `platforms = ['step7', 'portal', 'pcs7']`；`NAME = 'AO_Proc'`、`LOOP_NAME = 'AO_Loop'`；`is_feature` 对 `AO` 做不区分大小写匹配 |
| `src/converters/AO.yaml` | 内置符号 `[{{NAME}}, FB515, ...]`、`[{{LOOP_NAME}}, FC515, ...]` |
| `src/converters/AO.template` | 实例 DB 与 `AO_Loop` 函数 |
| `AO_Proc/`（子模块） | `AO_Proc(<platform>).scl` |

## 2. `initialize_list`

沿用 [design-converters.zh-cn.md §3](design-converters.zh-cn.md#3-通用的逐条目生命周期)
的逐条目骨架，每个 YAML 条目得到一个 `AO` 对象：

- 没有 `DB` 的条目原样返回、不做处理（与 `AI` 相同）；模板与
  `build_list` 均以 `AO.DB` 是否存在为准跳过它。
- `DB`：`make_s7_expression(DB, { disallow_s7express: true, force: { type: NAME } })`。
- `PV`：`make_s7_expression`，`force: { type: 'REAL' }`，允许 SCL 表达式；
  `AO.PV` 可能为 `undefined`。
- `output`：`make_s7_expression`，`force: { type: 'WORD' }`。
- `$zero`/`$span`/`$PV`：`nullable_value(REAL, ...)`。`$PV` 缺省时取
  `$zero`（此处完成，因为二者都是静态值），并记录 `AO.explicit_PV`
  （`$PV` 是否显式配置）供范围检查使用。
- `$overflow_SP`/`$underflow_SP`：由本模块的 `raw_SP(value)` 转换为
  `INT`——字符串匹配 `/^\s*([+-]?\d+(\.\d+)?)\s*%\s*$/` 时取
  `Math.round(27648 * pct / 100)`，其余字符串 `elog`；数字直接
  `new INT(value)`。必须先识别 `%`，因为 `Integer` 用 `parseInt` 会把
  `'105%'` 静默解析为 `105`。将来 `AI` 支持 `%` 写法时，`raw_SP` 移到
  共享模块。
- `extra_code`：`nullable_value(STRING, ...)?.value`，与 `interlock` 相同。

## 3. `build_list`

- `output` 可赋值性：调用 `src/symbols.js` 导出的 `is_assignable(expr)`
  （由 RP 的原有判断抽取而来，RP 与 AO 共用），不可赋值时 `elog`。
- 量程检查：`zero = $zero?.value ?? 0.0`、`span = $span?.value ?? 100.0`
  （FB 默认值），`zero === span` 时 `elog`。
- 限幅上下限：`high = $overflow_SP?.value ?? 28000`、
  `low = $underflow_SP?.value ?? -500`（FB 默认值）。显式配置的值不在
  `[-6912, 32511]` 内时 `elog`；`high <= low` 时 `elog`。由于已校验范围，
  无需再模拟 FB 对 `S7_AO_MIN`/`S7_AO_MAX` 的约束。
- 转换方向：`AO_Proc` 的公式为
  `(PV - zero) * 27648 / (span - zero)`，恒有 `zero` → `0`、
  `span` → `27648`。生成器原样写入 `$zero`/`$span`，绝不按大小交换，
  反向输出因此自然成立。
- `$PV` 范围检查：仅当 `AO.explicit_PV`，把 `high`/`low` 换算回工程值
  `zero + raw * (span - zero) / 27648`，`$PV` 不在二者所围区间内时按流水线
  现有惯例用
  `console.error('warning: 警告：...')` 输出警告，不中断转换。

与 `motor`/`valve` 不同，AO 的 FB 调用不带参数，因此 `build_list` 不
预先渲染参数列表，平台分支全部留在模板中。

## 4. 模板

- 每个有 `DB` 的条目一个 `DATA_BLOCK {{AO.DB.value}}`，Portal 上加
  `{ S7_Optimized_Access := 'FALSE' }`；`BEGIN` 段仅写出已定义的
  `PV`/`zero`/`span`/`overflow_SP`/`underflow_SP` 初值。
- `AO_Loop` 支持 `loop_begin`/`loop_end`；每个条目按规格中的固定顺序输出：
  `{{AO.DB.value}}.PV := {{AO.PV.value}};`（若 `AO.PV`）→
  `{{AO.extra_code}}`（原样，若有）→ FB 调用（非 Portal 前缀
  `"{{NAME}}".`）→ `{{AO.output.value}} := {{AO.DB.value}}.AO;`
  （若 `AO.output`）。

## 5. `gen` / `gen_copy_list`

与 `AI` 相同：`gen` 输出 `<output_dir>/AO_Loop.scl`（可被
`options.output_file` 覆盖）；`gen_copy_list` 把
`AO_Proc/AO_Proc(<platform>).scl` 复制为 `<output_dir>/AO_Proc.scl`，
`IE: 'utf8'`。`AO_Proc(pcs7).scl` 自带 `S7_tasklist := 'OB100'`，生成器
不需要额外处理。
