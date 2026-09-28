# Changelog

Notable changes of each release, starting from 2.0.0. Each release lists
the English notes first, followed by the Chinese notes.

本文件记录各版本的重要改动，从 2.0.0 开始。每个版本先列英文说明，随后是
中文说明。

## 2.0.0 - 2026-09-30

### Breaking changes

- **AI/alarm limit keys renamed.** GCL keys now share the names of the
  `AI_Proc`/`Alarm_Proc` limit-check members. Old keys are ignored.
  Migration: rename `$AH/$WH/$WL/$AL_limit` to `$HH/$H/$L/$LL_limit`,
  and `$enable_AH/WH/WL/AL` / `enable_AH/WH/WL/AL` to
  `$enable_HH/H/L/LL` / `enable_HH/H/L/LL`.
- **`$enable_AH/WH/WL/AL` have a new meaning.** They are now alarm
  switches read only by rules (see Features) and no longer disable a limit
  check in the PLC. Migration: a config that used them to disable a limit
  must use `$enable_HH/H/L/LL` instead.
- **Generated AI/alarm instance DB members renamed.** They expose
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

- **AI/alarm 限值键改名。** GCL 键名与 `AI_Proc`/`Alarm_Proc` 的限值检查
  成员名保持一致，旧键名会被忽略。迁移方法：将 `$AH/$WH/$WL/$AL_limit`
  改为 `$HH/$H/$L/$LL_limit`，将 `$enable_AH/WH/WL/AL` /
  `enable_AH/WH/WL/AL` 改为 `$enable_HH/H/L/LL` / `enable_HH/H/L/LL`。
- **`$enable_AH/WH/WL/AL` 含义改变。** 它们现在是只供规则读取的报警开关
  （见"新功能"），不再在 PLC 中关闭限值检查。迁移方法：原来用它们关闭
  限值检查的配置，须改用 `$enable_HH/H/L/LL`。
- **生成的 AI/alarm 背景 DB 成员改名。** 改为 `HH/H/L/LL_flag`、
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

- 供规则使用的 `$enable_AH/WH/WL/AL` 报警开关：决定超限时是否在上位系统
  报警。默认 `true`，不会写入 PLC。

### 修复

- `s7scl watch` 改为调用全局安装的 `nodemon` 命令，未安装 nodemon 时 CLI
  不再加载失败；并且只监视 `.yaml`/`.yml` 文件，自身输出的 `.scl` 不再导致
  无限重启。

### 构建

- iconv-lite 升级到 0.7 并打包进 `lib/`，不再是运行时依赖。
