# Design: AI converter

For the behavioral specification see
[spec-converters.md](spec-converters.md#ai); for the interface and lifecycle
shared by all converters see [design-converters.md](design-converters.md).

## 1. Files

| File | Content |
|---|---|
| `src/converters/converter_AI.js` | `platforms = ['step7', 'portal', 'pcs7']`; `NAME = 'AI_Proc'`, `LOOP_NAME = 'AI_Loop'`; `is_feature` matches `AI` case-insensitively |
| `src/converters/AI.yaml` | Built-in symbols `[{{NAME}}, FB512, ...]`, `[{{LOOP_NAME}}, FC512, ...]` |
| `src/converters/AI.template` | Instance DBs and the `AI_Loop` function |
| `src/converters/analog_common.js` | Analog shared library: raw-value constants (`S7_*`) and default constants (`DEFAULT_*`); `make_fake_DB`, `make_limit` (limit-check and scaling keys) shared with `limit`; `raw_SP` (see [§2.1](#21-raw_sp)) shared with `AO` |
| `AI_Proc/` (submodule) | `AI_Proc(<platform>).scl` |

## 2. `initialize_list`

Follows the per-item skeleton of
[design-converters.md §3](design-converters.md#3-common-per-item-lifecycle);
each YAML item becomes one `AI` object:

- `location`/`type`/`comment` are strings; `comment` defaults to
  `location + type`.
- An item with neither `DB` nor `input` is returned as is and not processed.
- `DB`: a placeholder `{ name }` from `make_fake_DB(DB)` first (needed by the
  descriptions in `make_limit`), then
  `make_s7_expression(DB, { disallow_s7express: true, force: { type: NAME } })`.
- `input`: `make_s7_expression` with `force: { type: 'WORD' }`.
- Defaults: `$zero_raw`/`$span_raw`/`$overflow_SP`/`$underflow_SP` get their
  defaults here (`DEFAULT_ZERO_RAW`, `DEFAULT_SPAN_RAW`,
  `DEFAULT_OVERFLOW_SP`, `DEFAULT_UNDERFLOW_SP`, i.e.
  `0`/`27648`/`28000`/`-500`); `$zero`/`$span` get theirs in `make_limit`
  (`DEFAULT_ZERO`/`DEFAULT_SPAN`). From then on they always have a value,
  the template always writes them and `build_list` reads them directly, so
  the instance DB never depends on the defaults declared in `AI_Proc`.
- `$zero_raw`/`$span_raw`: `new INT(...)`.
- `$overflow_SP`/`$underflow_SP`: `raw_SP(value, desc, zero_raw, span_raw)`
  with `zero_raw`/`span_raw` taken from the above. All of them are static
  values, so the conversion is done in this pass and the template prints the
  result directly.
- The remaining limit-check keys are handled by
  `make_limit(AI, node, document)`.

### 2.1 `raw_SP`

`src/converters/analog_common.js` exports
`raw_SP(value, desc, zero_raw = 0, span_raw = S7_SPAN)`, returning an `INT`
or `undefined`:

- `undefined`/`null` → `undefined` (key omitted).
- A string must match `/^\s*([+-]?\d+(\.\d+)?)\s*%\s*$/`, otherwise `elog`;
  the raw value is
  `Math.round(zero_raw + pct * (span_raw - zero_raw) / 100)`. The `%` must be
  recognized first, because `Integer`'s `parseInt` would silently read
  `'105%'` as `105`.
- A number must be an integer, otherwise `elog`; it is the raw value itself.
- The result goes through `ensure_value(INT, ...)`; beyond INT it fails with
  `SyntaxError('... 超出 INT 范围')`.

`AO` calls it without the last two arguments (i.e. `0`/`27648`), so both
features share one formula for the `%` form. All these errors happen in
pass 1, where `gen_data` catches and logs them, then stops the conversion.

## 3. `build_list`

For every item with `DB`, `check_raw` runs first, then the FB call arguments
are assembled:

- `check_raw`:
  - `elog` when `zero_raw` and `span_raw` are equal.
  - `elog` when an `$overflow_SP`/`$underflow_SP` raw value is
    `<= -32768` or `>= 32767` — these two values are the non-measurement
    markers of `AI_Proc`, so a threshold on them makes the overflow check
    meaningless (the FB treats them as `AI_error` first).
  - `elog` when the overflow `high = $overflow_SP.value` is not above the
    underflow `low = $underflow_SP.value`.
- `input_paras`: the configured `input` (as `AI`) and
  `enable_HH`/`enable_H`/`enable_L`/`enable_LL` joined as a `name := value`
  list for the call in the template.

Error messages start with `<CPU>:AI (<comment>)`.

## 4. Template

- One `DATA_BLOCK {{AI.DB.value}}` per item with `DB`, plus
  `{ S7_Optimized_Access := 'FALSE' }` on Portal; the `BEGIN` section always
  writes the `enable_HH`…`enable_LL`, `zero_raw`, `span_raw`, `overflow_SP`,
  `underflow_SP`, `zero` and `span` initial values, the other members (the
  `*_limit`s, `dead_zone`, `FT_time`) only when defined.
- `AI_Loop` supports `loop_begin`/`loop_end`; an item with `DB` and non-empty
  `input_paras` gets an FB call (prefixed with `"{{NAME}}".` off Portal), and
  every item gets a `// {{AI.comment}}` comment.

## 5. `gen` / `gen_copy_list`

`gen` writes `<output_dir>/AI_Loop.scl` (overridable by
`options.output_file`); `gen_copy_list` copies
`AI_Proc/AI_Proc(<platform>).scl` to `<output_dir>/AI_Proc.scl` with
`IE: 'utf8'`.
