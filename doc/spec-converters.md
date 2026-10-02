# Feature (Converter) Specification

Each GCL document declares one **feature**. This document describes what
each of the 12 supported features is for, its platform support, its key
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
scaling plus over/under-range and high/high-high/low/low-low limit checks, backed
by the `AI_Proc` FB.

- Platforms: `step7`, `portal`, `pcs7`.
- Aliases: none (must be `AI`).
- Key `list` item keys: `DB` (instance DB), `input` (source WORD, e.g. a
  `PIW` channel), plus the shared limit-check/scaling keys documented under
  [limit](#limit) (`$zero`, `$span`, `$HH_limit`/`$H_limit`/`$L_limit`/
  `$LL_limit` and their `enable_*`/`$enable_*` counterparts, `$dead_zone`,
  `$FT_time`).
- Raw-value keys, always written to the same-named instance DB members,
  with the defaults when omitted (as in [AO](#ao), independent of the
  defaults declared in the FB):
  - `$zero_raw`/`$span_raw`: integers, the channel raw values that
    `$zero`/`$span` map to (defaults `0`/`27648`).
  - `$overflow_SP`/`$underflow_SP`: the overflow/underflow thresholds; a raw
    value beyond them sets `overflow`/`underflow` (defaults
    `28000`/`-500`). As in AO, two forms are accepted:
    - a number: the raw value itself, e.g. `28000`, `-500`;
    - a string with `%`: a percentage of the raw range, `$zero_raw` being
      `0%` and `$span_raw` `100%` (defaults when omitted), i.e.
      `zero_raw + pct × (span_raw − zero_raw) / 100`, rounded to the raw
      value. E.g. with the default range `'105%'` is `29030` and `'-5%'` is
      `-1382`; with `$zero_raw: 5530`, `'-5%'` is `4424`.
- Conversion-time checks (items with `DB` only):
  - A malformed `%` string, or a number that is not an integer, for
    `$overflow_SP`/`$underflow_SP` is a configuration error.
  - A converted `$overflow_SP`/`$underflow_SP` raw value outside
    `-32767`–`32766` is a configuration error — `-32768`/`32767` are the
    non-measurement (wire break etc.) markers of `AI_Proc`.
  - An overflow threshold not above the underflow threshold is a
    configuration error (defaults when omitted).
  - Equal `zero_raw` and `span_raw` are a configuration error (the FB would
    divide by zero; defaults when omitted).
- Library file name: `AI_Proc(<platform>).scl`.

## limit

**Purpose**: limit checking for a process value that does **not** come
from a raw AI channel already handled by an `AI` document (e.g. a value
received over serial/Modbus), backed by `Limit_Proc`. Whether a limit
exceedance becomes an alarm is decided by the upper system (see the alarm
switches below), not by this feature.

- Platforms: `step7`, `portal`, `pcs7`.
- Aliases: `limitcheck`, `LC` (case-insensitive, as is `limit`). The former names
  `alarm`, `pv_alarm`, `pv` and `pvalarm` are no longer accepted.
- Built-in symbols: `Limit_Proc` (`FB519`), `Limit_Loop` (`FC519`); their
  addresses can be redefined in the document's `symbols`.
- Key `list` item keys: `DB`, `input` (a REAL engineering-unit value, not raw
  counts), `invalid` (optional quality/validity bit), and the shared
  limit-check keys (`$zero`, `$span`, `$HH_limit`/`$H_limit`/`$L_limit`/`$LL_limit`,
  `enable_HH`/`enable_H`/`enable_L`/`enable_LL` and their `$enable_*`
  initial-value counterparts, `$dead_zone`, `$FT_time`). Limits must satisfy
  `LL <= L <= H <= HH`; violating this is a configuration error.
- Alarm switches `$enable_AH`/`$enable_WH`/`$enable_WL`/`$enable_AL`: BOOL,
  default `true`, telling whether an HH/H/L/LL limit exceedance raises an
  alarm on the upper system. They are not written to the PLC and are only
  extracted by rules (e.g. to generate the upper-system alarm list). The same
  applies to `AI`.
- The limit-check GCL keys above are written to the same-named members of the
  instance DB. The instance DB outputs are `HH_flag`/`H_flag`/`L_flag`/`LL_flag`,
  `HH_PV`/`H_PV`/`L_PV`/`LL_PV` and `no_limit`, indicating limit exceedance
  rather than alarms. The same applies to `AI`.
- Library file name: `Limit_Proc(<platform>).scl`.
- Implementation: [design-converter-limit.md](design-converter-limit.md).

## AO

**Purpose**: analog output channel processing — linear conversion of an
engineering-unit value to the raw value of an AO module channel (`zero` maps
to `0`, `span` to `27648`), clamped with `overflow`/`underflow` set when
beyond the range given by `overflow_SP`/`underflow_SP`, backed by the
`AO_Proc` FB.

- Platforms: `step7`, `portal`, `pcs7`.
- Aliases: none (must be `AO`).
- Built-in symbols: `AO_Proc` (`FB515`), `AO_Loop` (`FC515`); their
  addresses can be redefined in the document's `symbols`.
- `list` item keys:
  - `DB`: the instance DB, type pinned to `AO_Proc`. An item without `DB` is
    not processed (as in `AI`).
  - `comment` (optional): used for the DB comment and the item comment in the
    loop.
  - `PV` (optional): a REAL value (symbol, variable or SCL expression) — the
    engineering-unit value to output. When present, `<DB>.PV := <PV>;` is
    generated every cycle before the FB call; when omitted, the upper system
    (HMI) writes PV directly into the instance DB.
  - `$PV`/`$zero`/`$span`/`$overflow_SP`/`$underflow_SP` are always written
    to the same-named instance DB members, with the defaults when omitted
    (as in `AI`, independent of the defaults declared in the FB).
  - `$PV` (optional): REAL, the initial value of `PV` in the instance DB,
    defaulting to `$zero`.
  - `$zero`/`$span` (optional): REAL, the engineering values that raw
    `0`/`27648` map to, defaulting to `0.0`/`100.0`. The conversion always maps
    `zero` to raw `0` and `span` to `27648`; `$span` below `$zero` therefore
    means reverse output and is allowed.
  - `$overflow_SP`/`$underflow_SP` (optional): the clamp high/low limits,
    converted to channel raw values (INT), defaulting to `28000`/`-500`.
    Two forms are accepted:
    - a number: the raw value itself, e.g. `28000`, `-500`;
    - a string with `%`: a percentage of the nominal full scale, `27648`
      being `100%`, rounded to the raw value, e.g. `'105%'` is `29030` and
      `'-5%'` is `-1382`.

    The result must lie within the output range `-6912` (0 mA)–`32511` —
    `AO_Proc` supports the 4–20 mA output only. A high limit below `27648` or
    a low limit above `0` confines the output within the range (e.g. a
    minimum drive frequency) and is allowed.
  - `output` (optional): an assignable `WORD` — a symbol definition, symbol
    reference or single variable, never a constant or compound expression
    (rejected at conversion). Its main use is an AO module channel (a `PQW`
    address or its symbol). When present, `<output> := <DB>.AO;` is generated
    after the FB call.
  - `extra_code` (optional): a string of SCL code inserted verbatim, for
    additional per-item logic (e.g. making the setpoint track the feedback in
    local mode).
- Each item is generated in `AO_Loop` in this fixed order, skipping any step
  that is not configured:
  1. `<DB>.PV := <PV>;`
  2. `extra_code`
  3. the FB call (Step 7/PCS7: `"AO_Proc".<DB>();`, Portal: `<DB>();`),
     without parameters — all inputs are passed through instance DB members.
  4. `<output> := <DB>.AO;`

  `extra_code` comes after the PV assignment and before the FB call, so it can
  override the `PV` assignment and whatever it writes takes effect in the same
  cycle. This differs from `interlock`'s `extra_code` (placed after the
  logic).
- Conversion-time checks:
  - Equal `zero` and `span` (defaults when omitted) are a configuration
    error (at run time the FB would only output `0` and set `invalid`).
  - A `$overflow_SP`/`$underflow_SP` raw value outside the output range, or
    a malformed `%` string, is a configuration error.
  - A clamp high limit not above the low limit is a configuration error
    (defaults when omitted).
  - An explicitly configured `$PV` that would be clamped — i.e. outside the
    engineering-unit interval converted back from the clamp limits — raises
    a warning, not an error; the FB clamps it and sets
    `overflow`/`underflow`/`invalid` at run time.
- Library file name: `AO_Proc(<platform>).scl`, copied as `AO_Proc.scl`.

## interlock

**Purpose**: the simplest protective-interlock pattern — one or more input
conditions (with configurable rising/falling/change/level trigger type,
optionally AND-combined) OR together to set one or more BOOL outputs, with
optional reset conditions and an `enable` gate.

- Platforms: `step7`, `portal` only (no `pcs7`).
- Aliases: `il`.
- Organization: each `list` item is one interlock DB holding one or more
  interlock groups. The DB is the unit of enabling, data and HMI
  visibility; the group is the unit of "inputs → outputs" logic. Related
  interlocks (e.g. start the pump on high level, stop it on low level) go
  under the same DB.
- DB-level keys: `DB` (required; a global DB, whose symbol type is forced
  to itself, a user-defined type such as an FB is corrected with a warning;
  must not repeat within a document, a repeat is an error), `comment`,
  `enable`/`$enable` (the DB's only enable, gating all of its groups;
  `enable` must be an assignable address), `data` (named fields the DB
  carries, with `S7_m_c`, each with optional `read`/`write` expressions and
  an initial value `$value`, referable by name from all of its groups),
  `groups`.
- Group-level keys: `comment`, `input` (required, ≥1 item; each item is a
  data-field reference, symbol, SCL expression, or an object with
  `trigger: rising|falling|change|on|off`, `and: [...]`, `value`,
  `comment`), `reset`, `output` (each item may set `inversion`, `default`,
  and its own `reset`), `extra_code`.
- `groups` is an array of groups (≥1 item). Shorthand: without `groups`,
  the `list` item's own group-level keys form its single group. `groups`
  and DB-level group keys (`input`/`reset`/`output`/`extra_code`) must not
  appear together; doing so is an error.
- Comments: the `list` item's `comment` is always the DB comment (also in
  the shorthand form, whose single group then has no comment of its own).
  The DB comment in the generated code is `comment`, else the DB symbol's
  comment; a DB symbol without a comment takes that DB comment. A group
  without a `comment` takes the DB comment.
- There is no group-level enable. A group that needs to be enabled on its
  own goes into a separate DB, or combines a data item with an `and` input.
- See [design-converter-interlock.md](design-converter-interlock.md) for
  the internal data model.
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
