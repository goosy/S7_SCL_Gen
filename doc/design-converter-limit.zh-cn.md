# 设计：limit 转换器

行为规格见 [spec-converters.zh-cn.md](spec-converters.zh-cn.md#limit)；
所有转换器共用的接口与生命周期见
[design-converters.zh-cn.md](design-converters.zh-cn.md)。

## 1. 文件

| 文件 | 内容 |
|---|---|
| `src/converters/converter_limit.js` | `platforms = ['step7', 'portal', 'pcs7']`；`NAME = 'Limit_Proc'`、`LOOP_NAME = 'Limit_Loop'`；`is_feature` 不区分大小写地匹配 `limit`、`limitcheck` 或 `LC` |
| `src/converters/limit.yaml` | 内置符号 `[{{NAME}}, FB519, ...]`、`[{{LOOP_NAME}}, FC519, ...]` |
| `src/converters/limit.template` | 背景 DB 与 `Limit_Loop` 函数 |
| `src/converters/analog_common.js` | 与 `AI` 共用 `make_fake_DB`、`make_limit`（超限判断与量程键） |
| `Limit_Proc/`（子模块） | `Limit_Proc(<platform>).scl` |

功能名即转换器文件名（`converter_limit.js`），因此无论 GCL 文档用的
是哪个名字，`document.feature`、复制/转换项以及 rules 的模式都使用
`limit`。

## 2. `initialize_list`

沿用 [design-converters.zh-cn.md §3](design-converters.zh-cn.md#3-通用的逐条目生命周期)
的逐条目骨架，每个 YAML 条目成为一个 `LC` 对象：

- `location`/`type`/`comment` 为字符串；`comment` 默认为 `location + type`。
- 既无 `DB` 也无 `input` 的条目原样返回，不做处理。
- `DB`：先用 `make_fake_DB(DB)` 放一个占位 `{ name }`（`make_limit` 的描述
  需要它），再
  `make_s7_expression(DB, { disallow_s7express: true, force: { type: NAME } })`。
- `input`：`make_s7_expression`，`force: { type: 'REAL' }`——是工程值，
  不同于 `AI` 的原始值 `WORD` 输入。
- `invalid`：`make_s7_expression`，`force: { type: 'BOOL' }`。
- 超限判断键由 `make_limit(LC, node, document)` 处理（见
  [§2.1](#21-make_limit)）。

### 2.1 `make_limit`

`src/converters/analog_common.js` 导出 `make_limit(item, node, document)`，
在 `item` 上写入：

- `$zero`/`$span`：`REAL`，默认 `DEFAULT_ZERO`/`DEFAULT_SPAN`
  （`0.0`/`100.0`）。
- 对每一级 `HH`/`H`/`L`/`LL`：
  - `$<level>_limit`：`REAL` 或 `undefined`。
  - `$enable_<level>`：`BOOL`，默认取 `$<level>_limit` 是否定义。
  - `enable_<level>`：`make_s7_expression`，`force: { type: 'BOOL' }`，在
    其 `.then()` 中赋值。
- `$enable_AH`/`$enable_WH`/`$enable_WL`/`$enable_AL`：`BOOL`，默认
  `true`。只供 rules 读取，模板从不写入。
- 限值顺序：已定义的限值须满足 `LL <= L <= H <= HH`，未定义的 `H`/`L`/`LL`
  取其上一级的值，未定义的 `HH` 取已定义的最高一级限值；否则 `elog('定义的限制值有错误 ...')`。只看
  限值，不看 `$enable_*`。该检查在第一遍扫描中执行，`gen_data` 捕获并
  记录错误后停止转换。
- `$dead_zone`：`REAL` 或 `undefined`；`$FT_time`：`TIME` 或 `undefined`。

## 3. `build_list`

对每个条目，把已配置的 `input`（作为 `PV`）、`invalid` 及
`enable_HH`/`enable_H`/`enable_L`/`enable_LL` 拼成 `name := value` 列表
`input_paras`，供模板中的调用使用。没有其它转换时校验。

## 4. 模板

- 每个有 `DB` 的条目生成一个类型为 `"{{NAME}}"` 的
  `DATA_BLOCK {{LC.DB.value}}`，Portal 上另加
  `{ S7_Optimized_Access := 'FALSE' }`；`BEGIN` 段总是写入
  `enable_HH`…`enable_LL`、`zero`、`span` 的初始值，其余成员（各
  `*_limit`、`dead_zone`、以 `DINT` 写入的 `FT_time`）仅在已定义时写入。
- `Limit_Loop` 支持 `loop_begin`/`loop_end`；有 `DB` 的条目生成一条 FB
  调用（非 Portal 平台前缀 `"{{NAME}}".`），每个条目都生成
  `// {{LC.comment}}` 注释。

## 5. `gen` / `gen_copy_list`

`gen` 输出 `<output_dir>/Limit_Loop.scl`（可由 `options.output_file`
覆盖）；`gen_copy_list` 把 `Limit_Proc/Limit_Proc(<platform>).scl` 复制为
`<output_dir>/Limit_Proc.scl`，`IE: 'utf8'`。

## 6. 测试

`test/limit_test.js` 覆盖：接受与拒绝的功能名、step7 与 Portal 上
生成的背景 DB 与主循环、复制的库文件、内置符号以及限值顺序检查。
