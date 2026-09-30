# Design: AO converter

For the behavioral specification see
[spec-converters.md](spec-converters.md#ao); for the interface and lifecycle
shared by all converters see [design-converters.md](design-converters.md).

## 1. Files

| File | Content |
|---|---|
| `src/converters/converter_AO.js` | `platforms = ['step7', 'portal', 'pcs7']`; `NAME = 'AO_Proc'`, `LOOP_NAME = 'AO_Loop'`; `is_feature` matches `AO` case-insensitively |
| `src/converters/AO.yaml` | Built-in symbols `[{{NAME}}, FB515, ...]`, `[{{LOOP_NAME}}, FC515, ...]` |
| `src/converters/AO.template` | Instance DBs and the `AO_Loop` function |
| `src/converters/analog_common.js` | Shared with `AI`: raw-value constants (`S7_*`), default constants (`DEFAULT_*`), `raw_SP` |
| `AO_Proc/` (submodule) | `AO_Proc(<platform>).scl` |

## 2. `initialize_list`

Follows the per-item skeleton of
[design-converters.md §3](design-converters.md#3-common-per-item-lifecycle);
each YAML item becomes one `AO` object:

- An item without `DB` is returned as is and not processed (as in `AI`);
  both the template and `build_list` skip it based on whether `AO.DB` exists.
- `DB`: `make_s7_expression(DB, { disallow_s7express: true, force: { type: NAME } })`.
- `PV`: `make_s7_expression` with `force: { type: 'REAL' }`, SCL expressions
  allowed; `AO.PV` may be `undefined`.
- `output`: `make_s7_expression` with `force: { type: 'WORD' }`.
- Defaults: `$zero`/`$span`/`$PV`/`$overflow_SP`/`$underflow_SP` get their
  defaults here (`DEFAULT_ZERO`, `DEFAULT_SPAN`, `$zero`,
  `DEFAULT_OVERFLOW_SP`, `DEFAULT_UNDERFLOW_SP`, i.e.
  `0.0`/`100.0`/`$zero`/`28000`/`-500`), so they always have a value, the
  template always writes them and `build_list` reads them directly. The
  instance DB therefore never depends on the defaults declared in `AO_Proc`.
- `$zero`/`$span`: `new REAL(...)`. `$PV`: `nullable_value(REAL, ...)`,
  defaulting to `$zero`, and `AO.explicit_PV` (whether `$PV` was configured
  explicitly) is recorded for the range check.
- `$overflow_SP`/`$underflow_SP`: converted to `INT` by
  `raw_SP(value, desc)` of `src/converters/analog_common.js`, shared with
  `AI`, without `zero_raw`/`span_raw` (i.e. `0`/`27648`), so a `%` string
  becomes `Math.round(27648 * pct / 100)`. For the format and INT range
  checks see
  [design-converter-ai.md §2.1](design-converter-ai.md#21-raw_sp).
- `extra_code`: `nullable_value(STRING, ...)?.value`, as in `interlock`.

## 3. `build_list`

- `output` assignability: calls `is_assignable(expr)` exported from
  `src/symbols.js` (extracted from RP's original check, shared by RP and AO);
  `elog` when not assignable.
- Range check: `zero = $zero.value`, `span = $span.value`; `zero === span`
  is an `elog`.
- Clamp limits: `high = $overflow_SP.value`, `low = $underflow_SP.value`;
  a value outside `[-6912, 32511]` is an `elog`; `high <= low` is an
  `elog`. Since the range is validated, the FB's `S7_AO_MIN`/`S7_AO_MAX`
  bounding need not be modeled.
- Conversion direction: `AO_Proc` computes
  `(PV - zero) * 27648 / (span - zero)`, so `zero` always maps to `0` and
  `span` to `27648`. The generator writes `$zero`/`$span` as given and never
  swaps them by magnitude, so reverse output works naturally.
- `$PV` range check: only when `AO.explicit_PV`, `high`/`low` are converted
  back to engineering units, `zero + raw * (span - zero) / 27648`, and a
  `$PV` outside the interval they bound prints a warning via
  `console.error('warning: 警告：...')` following the pipeline's existing
  convention, without aborting the conversion.

Unlike `motor`/`valve`, the AO FB call has no parameters, so `build_list`
does not pre-render a parameter list and all platform branching stays in the
template.

## 4. Template

- One `DATA_BLOCK {{AO.DB.value}}` per item with a `DB`, with
  `{ S7_Optimized_Access := 'FALSE' }` on Portal; the `BEGIN` section always
  writes the `PV`/`zero`/`span`/`overflow_SP`/`underflow_SP` initial
  values.
- `AO_Loop` supports `loop_begin`/`loop_end`; each item is emitted in the
  fixed order of the spec: `{{AO.DB.value}}.PV := {{AO.PV.value}};` (if
  `AO.PV`) → `{{AO.extra_code}}` (verbatim, if any) → the FB call (prefixed
  with `"{{NAME}}".` except on Portal) →
  `{{AO.output.value}} := {{AO.DB.value}}.AO;` (if `AO.output`).

## 5. `gen` / `gen_copy_list`

Same as `AI`: `gen` outputs `<output_dir>/AO_Loop.scl` (overridable via
`options.output_file`); `gen_copy_list` copies
`AO_Proc/AO_Proc(<platform>).scl` to `<output_dir>/AO_Proc.scl` with
`IE: 'utf8'`. `AO_Proc(pcs7).scl` carries its own `S7_tasklist := 'OB100'`,
so the generator needs no extra handling.
