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
- `$zero`/`$span`/`$PV`: `nullable_value(REAL, ...)`. `AO.explicit_PV`
  (whether `$PV` was configured explicitly) is recorded for the range check.
  When `$PV` is omitted, the engineering value that raw `0` maps to,
  `zero + (0 - cat.raw_zero) * (span - zero) / (27648 - cat.raw_zero)`, is
  computed after `$mode` is parsed (`zero`/`span`/`cat` taking the FB
  defaults when omitted; done here, since all are static values;
  `(zero + span) / 2` for bipolar); when the result is `0.0`, `AO.$PV` stays
  `undefined` so the template does not write it.
- `$overflow_SP`/`$underflow_SP`: converted to `INT` by the module's
  `raw_SP(value)` — a string matching
  `/^\s*([+-]?\d+(\.\d+)?)\s*%\s*$/` becomes
  `Math.round(27648 * pct / 100)`, any other string is an `elog`; a number
  becomes `new INT(value)`. The `%` must be recognized first, because
  `Integer`'s `parseInt` would silently read `'105%'` as `105`. When `AI`
  later supports the `%` form, `raw_SP` moves to a shared module.
- `$mode`: converted to `INT` by the module's `mode_of(value)` — an integer
  must be an index `0`–`5` of `MODES`, a string is looked up by name in
  `MODES` case-insensitively, anything else is an `elog`. `undefined` when
  omitted.
- `extra_code`: `nullable_value(STRING, ...)?.value`, as in `interlock`.

`MODES` is the module's table indexed by `mode`, each entry being
`{ name, raw_zero, raw_min, def_low }`, with values matching the constants of
`AO_Proc` 0.2 (names `4-20mA`, `0-20mA`, `0-10V`, `1-5V`, `+-10V`,
`+-20mA`):

| Category | `raw_zero` | `raw_min` | `def_low` |
|---|---|---|---|
| 1 unipolar with offset (`mode` 0, 3) | `0` | `-6912` | `-500` |
| 2 unipolar (`mode` 1, 2) | `0` | `0` | `0` |
| 3 bipolar (`mode` 4, 5) | `-27648` | `-32512` | `-28000` |

## 3. `build_list`

- `output` assignability: calls `is_assignable(expr)` exported from
  `src/symbols.js` (extracted from RP's original check, shared by RP and AO);
  `elog` when not assignable.
- Range check: `zero = $zero?.value ?? 0.0`, `span = $span?.value ?? 100.0`
  (the FB defaults); `zero === span` is an `elog`.
- Category: `cat = MODES[$mode?.value ?? 0]` (the FB default `mode` is `0`).
- Clamp limits: `high = $overflow_SP?.value ?? 28000`,
  `low = $underflow_SP?.value ?? cat.def_low` (the FB default and the
  category default). An explicitly configured value outside
  `[cat.raw_min, 32511]` is an `elog`; `high <= low` is an `elog`. Since the
  range is validated, the FB's hardware limit bounding need not be modeled.
  An omitted `$underflow_SP` is not written to the DB; the FB's sentinel
  `-32768` takes the default from `mode`.
- Conversion direction: `AO_Proc` computes
  `raw_zero + (PV - zero) * (27648 - raw_zero) / (span - zero)`, so `zero`
  always maps to `raw_zero` and `span` to `27648`. The generator writes
  `$zero`/`$span` as given and never swaps them by magnitude, so reverse
  output works naturally.
- `$PV` range check: only when `AO.explicit_PV`, `high`/`low` are converted
  back to engineering units,
  `zero + (raw - cat.raw_zero) * (span - zero) / (27648 - cat.raw_zero)`, and a
  `$PV` outside the interval they bound prints a warning via
  `console.error('warning: 警告：...')` following the pipeline's existing
  convention, without aborting the conversion.

Unlike `motor`/`valve`, the AO FB call has no parameters, so `build_list`
does not pre-render a parameter list and all platform branching stays in the
template.

## 4. Template

- One `DATA_BLOCK {{AO.DB.value}}` per item with a `DB`, with
  `{ S7_Optimized_Access := 'FALSE' }` on Portal; the `BEGIN` section writes
  only the defined `PV`/`mode`/`zero`/`span`/`overflow_SP`/`underflow_SP` initial
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
