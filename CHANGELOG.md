# Changelog

Notable changes of each release, starting from 2.0.1-beta.0. Each release
lists the English notes first, followed by the Chinese notes.

本文件记录各版本的重要改动，从 2.0.1-beta.0 开始。每个版本先列英文说明，
随后是中文说明。

## 2.0.1-beta.0 - 2026-10-04

This is the first release after 1.20.4. The version number 2.0.0 was never
published; its changes are included here.

### Breaking changes

- **`alarm` feature renamed to `limit`.** The feature only checks limits;
  whether an exceedance raises an alarm is decided by the upper system.
  The GCL feature is now `limit` with aliases `limitcheck` and `LC`; the
  library `Alarm_Proc` becomes `Limit_Proc`, with the blocks `Limit_Proc`
  (FB519) and `Limit_Loop` (FC519). The names `alarm`, `pv`, `pv_alarm`
  and `pvalarm` are no longer accepted. Migration: rename the GCL
  documents to `limit` (or `limitcheck`, `LC`), change `feature: alarm` in
  rules to `feature: limit`, and change SCL references to
  `Alarm_Proc`/`Alarm_Loop` to `Limit_Proc`/`Limit_Loop`.
- **Interlock config is organized by DB.** Each list item is one DB;
  `groups` holds its interlock groups, or the item itself is the single
  group. A repeated DB, or `groups` mixed with DB-level
  `input`/`reset`/`output`/`extra_code`, is an error. The DB symbol is
  forced to a global DB and must be a DB block. Validation is stricter:
  names are compared case-insensitively, `enable` must be an assignable
  address and may not be used in `input`/`reset`/`output`, trigger types
  are validated, non-BOOL data cannot be used as a boolean, and `inputs`
  is rejected in a group `reset`. Migration: merge list items sharing a DB
  into one item with `groups`.
- **AI/limit limit keys renamed.** GCL keys now share the names of the
  `AI_Proc`/`Limit_Proc` limit-check members. Old keys are ignored.
  Migration: rename `$AH/$WH/$WL/$AL_limit` to `$HH/$H/$L/$LL_limit`,
  and `$enable_AH/WH/WL/AL` / `enable_AH/WH/WL/AL` to
  `$enable_HH/H/L/LL` / `enable_HH/H/L/LL`.
- **`$enable_AH/WH/WL/AL` have a new meaning.** They are now alarm
  switches read only by rules (see Features) and no longer disable a limit
  check in the PLC. Migration: a config that used them to disable a limit
  must use `$enable_HH/H/L/LL` instead.
- **Generated AI/limit instance DB members renamed.** They expose
  `HH/H/L/LL_flag`, `HH/H/L/LL_PV` and `no_limit` instead of
  `AH/WH/WL/AL_flag`, `AH/WH/WL/AL_PV` and `no_alarm`. Migration: update
  SCL expressions and rule templates that reference the old members.
- **Output encoding is set per CPU.** The CPU document's `options.OE`
  sets the encoding of every output file of that CPU, including the
  symbol table. Defaults: `gbk` for step7/pcs7, `utf8bom` (UTF-8 with BOM)
  for portal. The CLI `--OE` option is removed. Migration: portal output
  is now UTF-8 with BOM; set `options.OE` in the CPU document to keep
  another encoding.
- **Line ending is set per CPU and defaults to LF.** The CPU document's
  `options.line_ending` (`LF` or `CRLF`) sets the line ending of every
  output file of that CPU. The CLI `--line-ending` option is removed.
  Migration: output is now LF instead of CRLF; set
  `options.line_ending: CRLF` in the CPU document if the configuration
  software on the target PC needs CRLF.
- **`files` entry syntax.** An object entry is
  `{ filename, IE, OE, line_ending }`; the documented
  `{ filename, encoding }` form was never honored. An entry with neither
  `IE` nor `OE` is copied verbatim (a warning is printed if it sets
  `line_ending`). Otherwise `IE` defaults to `utf8`, and `OE` and
  `line_ending` default to the CPU's settings. Migration: an entry that
  only sets `IE` is now written in the CPU's encoding.
- **Rules output defaults.** An entry without `OE`/`line_ending`, such as
  one created by a rules `add` action, is written as `utf8`/`LF`. A
  `merge` of entries with different `OE` (e.g. step7 and portal CPUs) is
  written as `utf8`. Migration: set `OE`/`line_ending` in the rule action
  when another format is needed.
- **Library API.** `context.OE`, `context.line_ending` and `context.IE`
  are removed. Migration: configure output in GCL or rules; pass an
  encoding to `read_file` explicitly.

### Features

- New `AO` feature backed by the `AO_Proc` library: instance DB initial
  values, PV assignment, `extra_code`, the FB call and the output
  assignment in `AO_Loop`, with conversion-time checks on the output,
  range and clamp limits.
- AI `$overflow_SP`/`$underflow_SP` accept the `<n>%` form like AO,
  relative to the raw range (`zero_raw` = 0%, `span_raw` = 100%). AI gains
  conversion-time checks: setpoints within -32767..32766, overflow above
  underflow, and `zero_raw` different from `span_raw`.
- The keys used by these checks are always written to the instance DB,
  with common defaults when omitted (`zero` 0.0, `span` 100.0, `zero_raw`
  0, `span_raw` 27648, `overflow_SP` 28000, `underflow_SP` -500), so the
  checks never depend on the defaults declared in the FBs. For AO this also
  covers `mode` (default 0), `underflow_SP` (the category default of the
  mode: -500, 0 or -28000) and `PV`.
- Interlock: data items take their initial value from `$value`, and reset
  items accept symbol definitions. Data is parsed before all groups, so
  every group can reference any data item.
- `$enable_AH/WH/WL/AL` alarm switches for rules: they decide whether a
  limit exceedance raises an alarm on the upper system. They default to
  `true` and are never written to the PLC.

### Fixes

- `s7scl watch` runs the globally installed `nodemon` command, so the CLI
  no longer fails to load when nodemon is absent, and it watches only
  `.yaml`/`.yml` files, so its own `.scl` output no longer restarts the
  watch endlessly.

### Build

- iconv-lite is upgraded to 0.7 and bundled into `lib/`; it is no longer
  a runtime dependency.

### 破坏性改动

- **`alarm` 功能改名为 `limit`。** 该功能只做限值检查，超限是否报警由上位
  系统决定。GCL 功能名现为 `limit`，别名为 `limitcheck` 和 `LC`；库
  `Alarm_Proc` 改为 `Limit_Proc`，块为 `Limit_Proc`（FB519）和
  `Limit_Loop`（FC519）。名称 `alarm`、`pv`、`pv_alarm`、`pvalarm` 不再
  被接受。迁移方法：将 GCL 文档改为 `limit`（或 `limitcheck`、`LC`），
  规则中的 `feature: alarm` 改为 `feature: limit`，SCL 中对
  `Alarm_Proc`/`Alarm_Loop` 的引用改为 `Limit_Proc`/`Limit_Loop`。
- **联锁配置按 DB 组织。** 每个列表项是一个 DB；`groups` 存放该 DB 的联锁
  组，或者列表项本身就是唯一的一组。DB 重复，或 `groups` 与 DB 级的
  `input`/`reset`/`output`/`extra_code` 混用，都会报错。DB 符号强制为全局
  DB，且必须是 DB 块。校验更严格：名称不区分大小写比较，`enable` 必须是
  可赋值地址且不能用于 `input`/`reset`/`output`，校验触发类型，非 BOOL
  数据不能当作布尔量使用，组级 `reset` 中不允许 `inputs`。迁移方法：把
  共用同一个 DB 的列表项合并为一项，使用 `groups`。
- **AI/limit 限值键改名。** GCL 键名与 `AI_Proc`/`Limit_Proc` 的限值检查
  成员名保持一致，旧键名会被忽略。迁移方法：将 `$AH/$WH/$WL/$AL_limit`
  改为 `$HH/$H/$L/$LL_limit`，将 `$enable_AH/WH/WL/AL` /
  `enable_AH/WH/WL/AL` 改为 `$enable_HH/H/L/LL` / `enable_HH/H/L/LL`。
- **`$enable_AH/WH/WL/AL` 含义改变。** 它们现在是只供规则读取的报警开关
  （见"新功能"），不再在 PLC 中关闭限值检查。迁移方法：原来用它们关闭
  限值检查的配置，须改用 `$enable_HH/H/L/LL`。
- **生成的 AI/limit 背景 DB 成员改名。** 改为 `HH/H/L/LL_flag`、
  `HH/H/L/LL_PV` 和 `no_limit`，取代 `AH/WH/WL/AL_flag`、
  `AH/WH/WL/AL_PV` 和 `no_alarm`。迁移方法：修改引用旧成员名的 SCL
  表达式和规则模板。
- **输出编码按 CPU 设置。** CPU 文档的 `options.OE` 决定该 CPU 所有输出
  文件（包括符号表）的编码。默认值：step7/pcs7 为 `gbk`，portal 为
  `utf8bom`（UTF-8 带 BOM）。删除 CLI 的 `--OE` 选项。迁移方法：portal
  输出现在是 UTF-8 带 BOM；需要其他编码时，在 CPU 文档中设置
  `options.OE`。
- **行尾按 CPU 设置，默认 LF。** CPU 文档的 `options.line_ending`
  （`LF` 或 `CRLF`）决定该 CPU 所有输出文件的行尾。删除 CLI 的
  `--line-ending` 选项。迁移方法：输出现在是 LF 而不是 CRLF；若目标电脑
  上的组态软件需要 CRLF，在 CPU 文档中设置 `options.line_ending: CRLF`。
- **`files` 条目语法。** 对象条目为 `{ filename, IE, OE, line_ending }`；
  原文档中的 `{ filename, encoding }` 写法实际从未生效。`IE`、`OE` 都不写
  的条目按字节原样复制（若写了 `line_ending` 会输出警告）。否则 `IE`
  默认为 `utf8`，`OE` 和 `line_ending` 默认取 CPU 的设置。迁移方法：只写
  `IE` 的条目现在按 CPU 的编码写出。
- **规则输出的默认值。** 没有 `OE`/`line_ending` 的条目（例如规则 `add`
  动作新建的条目）按 `utf8`/`LF` 写出。`merge` 合并 `OE` 不同的条目
  （例如 step7 与 portal CPU 的条目）时按 `utf8` 写出。迁移方法：需要其他
  格式时，在规则动作中设置 `OE`/`line_ending`。
- **库 API。** 删除 `context.OE`、`context.line_ending` 和 `context.IE`。
  迁移方法：在 GCL 或规则中配置输出格式；调用 `read_file` 时显式传入编码。

### 新功能

- 新增 `AO` 功能，基于 `AO_Proc` 库：背景 DB 初值、PV 赋值、`extra_code`、
  `AO_Loop` 中的 FB 调用和输出赋值，并在转换时检查输出、量程和限幅。
- AI 的 `$overflow_SP`/`$underflow_SP` 与 AO 一样支持 `<n>%` 写法，相对于
  原始量程（`zero_raw` = 0%，`span_raw` = 100%）。AI 新增转换期检查：
  设定值在 -32767..32766 内、overflow 大于 underflow、`zero_raw` 不等于
  `span_raw`。
- 这些检查用到的键总是写入背景 DB，省略时使用通用默认值（`zero` 0.0、
  `span` 100.0、`zero_raw` 0、`span_raw` 27648、`overflow_SP` 28000、
  `underflow_SP` -500），检查因此不再依赖 FB 中声明的默认值。对 AO 还包括
  `mode`（默认 0）、`underflow_SP`（按 mode 的类别默认值：-500、0 或
  -28000）和 `PV`。
- 联锁：数据项的初值取自 `$value`，复位项接受符号定义。数据先于所有组解析，
  因此每个组都能引用任意数据项。
- 供规则使用的 `$enable_AH/WH/WL/AL` 报警开关：决定超限时是否在上位系统
  报警。默认 `true`，不会写入 PLC。

### 修复

- `s7scl watch` 改为调用全局安装的 `nodemon` 命令，未安装 nodemon 时 CLI
  不再加载失败；并且只监视 `.yaml`/`.yml` 文件，自身输出的 `.scl` 不再导致
  无限重启。

### 构建

- iconv-lite 升级到 0.7 并打包进 `lib/`，不再是运行时依赖。
