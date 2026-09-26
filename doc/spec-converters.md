# Feature (Converter) Specification

Each GCL document declares one **feature**. This document describes what
each of the 11 supported features is for, its platform support, its key
`list`-item configuration keys, and what it generates. For the underlying
mechanism common to all of them, see
[design-converters.md](design-converters.md).

Every feature except `CPU` follows the same output convention:

- `<Feature>_Loop.scl` — generated main-loop `FUNCTION` that instantiates/
  calls the feature's function block once per configured item, plus any
  per-item `DATA_BLOCK`s the feature needs (parameter/instance data).
- `<Feature>_Proc.scl` (or the feature's own library file name) — copied
  verbatim (with encoding conversion) from the feature's external SCL
  library submodule (see [spec.md §5](spec.md#5-external-dependencies)); not
  generated from GCL.

## CPU

**Purpose**: CPU-wide settings shared by every other feature document for the
same CPU (platform, device, output folder, shared symbols/includes/files),
plus a place to declare arbitrary custom `OB`/`FC` blocks built from raw SCL.

- Platforms: `step7`, `portal`, `pcs7`.
- `device`: one of a fixed list of Siemens CPU model strings (see
  `devices` in `src/converters/converter_CPU.js`); affects built-in symbol
  defaults (e.g. `GET`/`PUT` map to `SFB14`/`SFB15` on CPU31x) and (for `MT`)
  the communication-device ID used in `TCON`.
- `list` items each need a `block` (an `OB` or `FC` symbol) and a `code`
  string (raw SCL statements for the block body); `title` is optional (`OB`
  only).
- If a CPU has a `Clock_Byte` built-in symbol address, the standard clock-bit
  sub-symbols (`Clock_10Hz` … `Clock_0.5Hz`) are derived automatically.
- Output: `CPU.scl` (or `options.output_file`), only if there is `includes`
  or a non-empty `list`. No library file is copied.

## AI

**Purpose**: analog input channel processing — raw-to-engineering-unit
scaling plus over/under-range and high/high-high/low/low-low alarms, backed
by the `AI_Proc` FB.

- Platforms: `step7`, `portal`, `pcs7`.
- Aliases: none (must be `AI`).
- Key `list` item keys: `DB` (instance DB), `input` (source WORD, e.g. a
  `PIW` channel), plus the shared alarm/scaling keys documented under
  [alarm](#alarm) (`$zero`, `$span`, `$zero_raw`, `$span_raw`,
  `$overflow_SP`, `$underflow_SP`, `$AH_limit`/`$WH_limit`/`$WL_limit`/
  `$AL_limit` and their `enable_*`/`$enable_*` counterparts, `$dead_zone`,
  `$FT_time`).
- Library file name: `AI_Proc(<platform>).scl`.

## alarm

**Purpose**: threshold alarming for a process value that does **not** come
from a raw AI channel already handled by an `AI` document (e.g. a value
received over serial/Modbus), backed by `Alarm_Proc`.

- Platforms: `step7`, `portal`, `pcs7`.
- Aliases: `pv_alarm`, `pv`, `pvalarm`.
- Key `list` item keys: `DB`, `input` (a REAL engineering-unit value, not raw
  counts), `invalid` (optional quality/validity bit), and the shared alarm
  keys (`$zero`, `$span`, `$AH_limit`/`$WH_limit`/`$WL_limit`/`$AL_limit`,
  `enable_AH`/`enable_WH`/`enable_WL`/`enable_AL` and their `$enable_*`
  initial-value counterparts, `$dead_zone`, `$FT_time`). Limits must satisfy
  `AL <= WL <= WH <= AH`; violating this is a configuration error.
- Library file name: `Alarm_Proc(<platform>).scl`.

## interlock

**Purpose**: the simplest protective-interlock pattern — one or more input
conditions (with configurable rising/falling/change/level trigger type,
optionally AND-combined) OR together to set one or more BOOL outputs, with
optional reset conditions and an `enable` gate. Multiple `interlock` list
items can target the same DB, accumulating fields into one shared instance
DB per `DB` name.

- Platforms: `step7`, `portal` only (no `pcs7`).
- Aliases: `il`.
- Key `list` item keys: `DB` (required, groups items), `enable`/`$enable`,
  `data` (extra named fields the DB should carry, each with its own
  `read`/`write` expression), `input`/`input_list` (required, ≥1 item; each
  item is a data-field reference, symbol, SCL expression, or an object with
  `trigger: rising|falling|change|on|off`, `and: [...]`, `value`, `comment`),
  `reset`, `output` (each item may set `inversion`, `default`, and its own
  `reset`).
- See [design-converters.md](design-converters.md#5-interlock-data-model)
  for the internal `DB`/`Interlock`/`Field` object model (migrated from the
  former `interlock_class.md`).
- No external library file — the generated `Interlock_Loop.scl` is fully
  self-contained (no `Interlock_Proc` submodule).

## motor

**Purpose**: standard start/stop/e-stop motor control and status feedback,
backed by `Motor_Proc`.

- Platforms: `step7`, `portal`.
- Key `list` item keys: `DB`, `enable`, `run`, `error`, `remote` (status
  inputs), `run_action`/`start_action`/`stop_action`/`estop_action` (command
  outputs), `$stateless`, `$over_time`.
- Output parameter layout differs by platform: Portal calls the FB with all
  parameters (in+out) as one positional list; Step 7/PCS7 pass only inputs
  to the FB call and then assign each output parameter from the DB
  separately.
- Library file name: `Motor_Proc(<platform>).scl`.

## MT (ModbusTCP)

**Purpose**: Modbus TCP master polling over the CPU's onboard PN interface,
one `TCON`-based connection per `list` item, each with its own list of
Modbus polls, backed by `MT_Poll`.

- Platforms: `step7` only.
- Aliases: `modbusTCP`.
- Key connection-level keys: `DB` (connection instance DB, type `MT_Poll`),
  `host` (dotted-quad IP string or 4-element array), `port`,
  `local_device_id`/`device`/`rack`/`xslot` (the communication-device ID for
  `TCON`), `$interval_time`/`interval_time`.
- Communication-device ID priority: the connection's `local_device_id` (an
  SCL byte literal such as `B#16#02`, used as-is); otherwise the connection's
  `device`, falling back to the CPU document's `device`, looked up together
  with `rack`/`xslot` in the built-in table (an unknown combination is an
  error). The lookup is an exact match on the full `device`/`rack`/`xslot`
  combination: `rack`/`xslot` may be omitted where the table has a default
  entry, and supplying one the model does not take is an error.
  The legacy key `XSlot` is still accepted as an alias of `xslot`.
- Key per-poll keys: either `send_DB` + `send_start` (poll frame lives in an
  externally managed DB) or `unit_ID` + `func_code` + `address`/`started_addr`
  + `data`/`length` (+ `extra_data` for function codes 15/16) to have the
  generator build and pack the Modbus request frame itself into a shared
  `MT_polls_DB`; `recv_DB`/`recv_start`, `try_times`, `enable`,
  `custom_trigger`, `extra_code: FB` (auto-invoke the send/recv FB instances
  if they are FB-typed).
- Connection IDs and TCP ports are allocated/checked per CPU
  (`conn_ID_list`, `conn_host_list`) to avoid duplicates.
- Library file name: `MT_Poll.scl` (platform-independent).

## PI

**Purpose**: high-speed pulse counting via a Siemens FM350-2 counter module,
backed by `PI_Proc`.

- Platforms: `step7` only.
- Key `list` item keys: `DB` (channel instance, type `PI_Proc`), `module`
  (HW module address symbol) or `module_addr` (raw address, auto-wrapped
  into a symbol), `count_DB` (the FM350-2-specific parameter DB, type
  `FM350-2`), `model` (currently only `FM350-2` is supported).
- Library file name: `PI_Proc.scl` (platform-independent).

## RP

**Purpose**: "recently changed" signal shaping — on/off-delay and pulse
(single or with falling-edge inclusion) timers built on standard `TON`/
`TOF`/`TP` (and `CP`/`DP`, this project's own change-pulse FBs).

- Platforms: `step7`, `portal`, `pcs7`.
- Aliases: `RELAY`, `PULSE`.
- Key `list` item keys: `DB`, `type` (one of `onDelay`, `offDelay`,
  `onPulse`, `onDPulse`, `changePulse`, `changeDPulse` — maps to the FB
  used), `input`, `output`, `$time` (pulse/delay duration, `TIME` literal).
- `output` (optional): an assignable `BOOL` — a symbol definition, symbol
  reference or single variable, never a constant or compound expression
  (rejected at conversion). When present, `RP_Loop` assigns
  `<output> := <DB>.Q;` right after the item's FB call.
- Library files: `CP.scl`, `DP.scl` (from `RP_Trigger`); `TON`/`TOF`/`TP`
  come from the CPU's built-in `SFB` library, not a copied file.

## SC

**Purpose**: Modbus RTU (or raw serial) master polling over a CP340/CP341
serial module, structurally parallel to `MT` but over RS232/422/485,
backed by `CP_Poll` (`CP340_Poll`/`CP341_Poll`/`CRC16`).

- Platforms: `step7` only.
- Aliases: `MB`, `modbusRTU`.
- Key `list` item (module) keys: `DB` (module instance, type
  `CP340_Poll`/`CP341_Poll` depending on `model`), `module`/`module_addr`,
  `try_times`/`retry_times`.
- Key per-poll keys: `mode` (`continuous` (default) | `periodicity` |
  `custom`), and either `send_data` (raw hex-byte string, non-Modbus framing)
  or `unit_ID`+`func_code`+`address`/`started_addr`+`data`/`length` (Modbus
  framing, CRC appended automatically) or `send_DB`+`send_start` (external
  frame); `recv_DB`, `timeout`, `enable`, `custom_trigger`, `extra_code: FB`.
- Library files: `CRC16.awl` always; `CP340_Poll.scl`/`CP341_Poll.scl`
  copied only if a module of that model is present.

## timer

**Purpose**: a simple counting/timing utility block driven off a clock pulse
(`PPS`, default `Clock_1Hz`), backed by `Timer_Proc`.

- Platforms: `step7`, `portal`, `pcs7`.
- Key `list` item keys: `DB`, `enable`, `reset`, `PPS`.
- Library file name: `Timer_Proc(portal).scl` on Portal, `Timer_Proc.scl`
  otherwise.

## valve

**Purpose**: on/off or positioning valve control with feedback, remote/local
mode, and open/close/stop command outputs, plus optional AI-based position
scaling, backed by `Valve_Proc`.

- Platforms: `step7`, `pcs7`, `portal`.
- Key `list` item keys: `DB`, `AI` (position feedback WORD, optional),
  `CP`/`OP` (closed/open limit switch inputs), `error`, `remote`,
  `close_action`/`open_action`/`stop_action`/`control_action` (command
  outputs — direction depends on platform: `=>` FB output parameters on
  Portal, DB-field-to-symbol assignment statements on Step 7/PCS7),
  `$zero_raw`/`$span_raw`/`$overflow_SP`/`$underflow_SP` (AI scaling),
  `$FT_zone`, `$action_time`, `$signal_time`.
- Output also defines platform-appropriate `VAR CONSTANT`/`CONST` status
  word constants (`STOP_STATUS`, `OPEN_STATUS`, …) used by the loop.
- Library file name: `Valve_Proc(<platform>).scl`.
