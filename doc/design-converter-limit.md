# Design: limit converter

For the behavioral specification see
[spec-converters.md](spec-converters.md#limit); for the interface and
lifecycle shared by all converters see
[design-converters.md](design-converters.md).

## 1. Files

| File | Content |
|---|---|
| `src/converters/converter_limit.js` | `platforms = ['step7', 'portal', 'pcs7']`; `NAME = 'Limit_Proc'`, `LOOP_NAME = 'Limit_Loop'`; `is_feature` matches `limit`, `limitcheck` or `LC` case-insensitively |
| `src/converters/limit.yaml` | Built-in symbols `[{{NAME}}, FB519, ...]`, `[{{LOOP_NAME}}, FC519, ...]` |
| `src/converters/limit.template` | Instance DBs and the `Limit_Loop` function |
| `src/converters/analog_common.js` | `make_fake_DB`, `make_limit` (limit-check and scaling keys), shared with `AI` |
| `Limit_Proc/` (submodule) | `Limit_Proc(<platform>).scl` |

The feature name is the converter file name (`converter_limit.js`), so
`document.feature`, the copy/convert items and rules patterns all use
`limit`, whatever name the GCL document used.

## 2. `initialize_list`

Follows the per-item skeleton of
[design-converters.md §3](design-converters.md#3-common-per-item-lifecycle);
each YAML item becomes one `LC` object:

- `location`/`type`/`comment` are strings; `comment` defaults to
  `location + type`.
- An item with neither `DB` nor `input` is returned as is and not processed.
- `DB`: a placeholder `{ name }` from `make_fake_DB(DB)` first (needed by the
  descriptions in `make_limit`), then
  `make_s7_expression(DB, { disallow_s7express: true, force: { type: NAME } })`.
- `input`: `make_s7_expression` with `force: { type: 'REAL' }` — an
  engineering value, unlike the raw `WORD` input of `AI`.
- `invalid`: `make_s7_expression` with `force: { type: 'BOOL' }`.
- The limit-check keys are handled by `make_limit(LC, node, document)`
  (see [§2.1](#21-make_limit)).

### 2.1 `make_limit`

`src/converters/analog_common.js` exports
`make_limit(item, node, document)`, which writes onto `item`:

- `$zero`/`$span`: `REAL`, defaulting to `DEFAULT_ZERO`/`DEFAULT_SPAN`
  (`0.0`/`100.0`).
- For each level `HH`/`H`/`L`/`LL`:
  - `$<level>_limit`: `REAL` or `undefined`.
  - `$enable_<level>`: `BOOL`, defaulting to whether `$<level>_limit` is
    defined.
  - `enable_<level>`: `make_s7_expression` with `force: { type: 'BOOL' }`,
    assigned in its `.then()`.
- `$enable_AH`/`$enable_WH`/`$enable_WL`/`$enable_AL`: `BOOL`, default
  `true`. They are read by rules only; the template never writes them.
- Limit order: the defined limits must satisfy `LL <= L <= H <= HH`, an
  undefined `H`/`L`/`LL` taking the value of the level above it and an
  undefined `HH` the highest defined limit; otherwise
  `elog('定义的限制值有错误 ...')`. The check looks at the limits only, not
  at `$enable_*`. It runs in pass 1, where `gen_data` catches and logs the
  error, then stops the conversion.
- `$dead_zone`: `REAL` or `undefined`; `$FT_time`: `TIME` or `undefined`.

## 3. `build_list`

For every item, `input_paras` joins the configured `input` (as `PV`),
`invalid` and `enable_HH`/`enable_H`/`enable_L`/`enable_LL` into a
`name := value` list for the call in the template. There are no further
conversion-time checks.

## 4. Template

- One `DATA_BLOCK {{LC.DB.value}}` of type `"{{NAME}}"` per item with `DB`,
  plus `{ S7_Optimized_Access := 'FALSE' }` on Portal; the `BEGIN` section
  always writes the `enable_HH`…`enable_LL`, `zero` and `span` initial
  values, the other members (the `*_limit`s, `dead_zone`, `FT_time` as
  `DINT`) only when defined.
- `Limit_Loop` supports `loop_begin`/`loop_end`; an item with `DB` gets an FB
  call (prefixed with `"{{NAME}}".` off Portal), and every item gets a
  `// {{LC.comment}}` comment.

## 5. `gen` / `gen_copy_list`

`gen` writes `<output_dir>/Limit_Loop.scl` (overridable by
`options.output_file`); `gen_copy_list` copies
`Limit_Proc/Limit_Proc(<platform>).scl` to `<output_dir>/Limit_Proc.scl`
with `IE: 'utf8'`.

## 6. Tests

`test/limit_test.js` covers the accepted and rejected feature names,
the rendered instance DB and loop on step7 and Portal, the copied library
file, the built-in symbols and the limit order check.
