# Design: Converter Plugin Interface

Each feature in [spec-converters.md](spec-converters.md) is implemented as a
self-contained module under `src/converters/converter_<feature>.js`,
discovered and wired together automatically at build time (see
[design-pipeline.md §5](design-pipeline.md#5-build-time-self-generation)).
This document covers the interface contract every converter must satisfy,
the template-rendering convention, and notable per-feature implementation
details that don't belong in the behavioral spec. A fuller implementation
write-up for a single feature lives in its own
`design-converter-<feature>.md`.

## 1. Required exports

| Export | Required | Signature | Purpose |
|---|---|---|---|
| `platforms` | yes | `string[]` | Which of `step7`/`portal`/`pcs7` this feature supports; `parse_doc` skips (with a warning) any document whose CPU's platform isn't in this list. |
| `is_feature(name)` | yes | `(string) => boolean` | Case-insensitive match against the document's `feature` directive, including any aliases (e.g. `MT`/`modbusTCP`, `SC`/`MB`, `interlock`/`il`). |
| `initialize_list(area)` | yes | `(Area) => void` | Pass-1: mutates `area.list` in place from raw YAML nodes to plain objects; registers/resolves symbols via `make_s7_expression`/`add_symbol`. |
| `gen(area)` | yes | `(Area) => ConvertDescriptor[]` | Returns zero or more `{ distance, output_dir, tags, template, OE?, line_ending? }` descriptors describing generated output file(s). The optional `OE`/`line_ending` override the owning CPU's defaults (see [design-pipeline.md §4.1](design-pipeline.md#41-output-encoding), [§4.2](design-pipeline.md#42-output-line-ending)). `template` names a key in the generated `templates` map (§2), conventionally `<feature>.template`. |
| `gen_copy_list(area)` | yes | `(Area) => CopyDescriptor[]` | Returns zero or more `{ source, input_dir, distance, output_dir, IE, OE?, line_ending? }` descriptors for static library files to copy (see [spec.md §5](spec.md#5-external-dependencies)). The optional `OE`/`line_ending` behave as above. |
| `build_list(area)` | no | `(Area) => void` | Pass-2, run after all CPUs' symbols are fully resolved (see [design-pipeline.md §3](design-pipeline.md#3-two-pass-processing)); only needed if the feature has cross-item or cross-symbol derived data. |
| `<feature>.yaml` | no | — | Built-in symbol declarations for this feature, see [design-symbols.md §3](design-symbols.md#3-built-in-symbols). |
| `<feature>.template` | conventionally required | — | The gooplate template `gen()`'s descriptor(s) reference by name. |

`build.js` enforces the four required functions exist for every
`converter_*.js` file at build time and throws if one is missing — this is
the authoritative list, not merely a convention.

A converter is free to export additional named constants (`NAME`,
`LOOP_NAME`, `POLLS_NAME`, etc. — see individual converters); these are
commonly reused both in `gen()`'s `tags` and in the feature's own
`<feature>.yaml` (rendered with the converter module itself as gooplate
tags, so e.g. `AI.yaml` can write `{{NAME}}`/`{{LOOP_NAME}}`).

## 2. The `templates` map

`gen()` never reads a template file itself; it just names one
(`template: 'AI.template'`). `gen_list()` (`src/gen_data.js`) looks that name
up in the `templates` object exported by the generated `src/converter.js`,
which embeds every `src/converters/*.template` file's contents as a string
constant at build time. This means:

- Templates are plain [gooplate](https://www.npmjs.com/package/gooplate)
  syntax — consult gooplate's own docs/API for the templating language
  itself (`{{if}}`/`{{for}}`/`{{_...}}` line-continuation, `{{// comment}}`,
  etc.); this project only supplies the tags.
- A template's available tags are the union of: the common tags `gen_list()`
  always injects (`context`, `gcl`, `pad_left`/`pad_right`/`fixed_hex`,
  `cpu_name`, `feature`, `platform`), everything on the `Area` (`includes`,
  `list`, `loop_begin`, `loop_end`, `options`, ...), and whatever `gen()`
  put in its descriptor's own `tags`.
- Changing a `.template` file's content takes effect on the next `pnpm
  build` (or automatically under `pnpm watch`, which rebuilds on `.scl`/
  `.yaml` changes) — not immediately, since the content is baked into
  `src/converter.js`.

## 3. Common per-item lifecycle

Nearly every converter (excluding `CPU` and `interlock`, which have
CPU/DB-centric rather than one-object-per-item shapes) follows the same
`initialize_list` skeleton:

```js
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const item = { node, comment: new STRING(node.get('comment') ?? '') };
        const DB = node.get('DB');
        if (!DB) return item; // an item without a DB is left inert
        make_s7_expression(DB, {
            document, disallow_s7express: true,
            force: { type: NAME },      // pin the instance DB's type to this feature's FB
            default: { comment: item.comment.value },
        }).then(symbol => { item.DB = symbol; });
        // ...resolve the remaining fields the same way...
        return item;
    });
}
```

Because `make_s7_expression` may return a `Promise` (forward reference), the
assignment always happens in a `.then()` — by the time `build_list`/`gen`
run, every promise the pipeline queued has already resolved (see
[design-pipeline.md §3](design-pipeline.md#3-two-pass-processing)), so
downstream code can read `item.DB.value`/`item.DB.block_no`/etc.
synchronously. **A converter must never read a `make_s7_expression` result
synchronously right after calling it** — only from within pass 2
(`build_list`) or later.

## 4. Notable per-feature deviations

- **`CPU`**: `list` items are raw `OB`/`FC` blocks (`block` + `code`), not a
  DB-per-item pattern; `build_list` validates `block.block_name` is `OB` or
  `FC`. It also derives the standard clock-bit symbols from a `Clock_Byte`
  built-in symbol, and resolves `options.output_dir` (which the rest of the
  pipeline reads as `CPU.output_dir`), `options.OE` (platform default
  when unset; read as `CPU.OE`, see
  [design-pipeline.md §4.1](design-pipeline.md#41-output-encoding)), and
  `options.line_ending` (`LF` when unset; read as `CPU.line_ending`, see
  [design-pipeline.md §4.2](design-pipeline.md#42-output-line-ending)).
- **`AI`/`limit`**: share their limit/scaling-field parsing via
  `make_limit()`/`make_fake_DB()` in `src/converters/analog_common.js`
  rather than duplicating it — see that file's own docstring for the full
  field list. `make_fake_DB` lets templates render a placeholder `AI.DB`
  even before the real symbol promise resolves (needed because `gen()` can
  run before all promises settle for informational rendering paths). For
  the `AI` details see [design-converter-ai.md](design-converter-ai.md), for
  the `limit` details
  [design-converter-limit.md](design-converter-limit.md).
- **`AO`**: see [design-converter-ao.md](design-converter-ao.md). `AI` and
  `AO` share the raw setpoint conversion (`raw_SP`, including the `%` form)
  in `src/converters/analog_common.js`.
- **`interlock`**: the only feature that does not rely on an FB; the
  converter writes all of the logic itself. Each `list` item is one
  interlock DB (DB names must not repeat) holding one or more interlock
  groups (`groups`, or the item itself as the single group), so each
  `area.list` entry is a DB object rather than a single group. See
  [design-converter-interlock.md](design-converter-interlock.md).
- **`MT`/`SC`**: both pack multiple polls' request/response frames into a
  shared struct DB (`MT_polls_DB`/`SC_polls_DB`) with hand-computed byte
  offsets (`poll_index`, advanced by each poll's frame length, word-aligned)
  — this bookkeeping lives entirely in `build_list`, since it requires
  knowing every poll's final frame length across the whole CPU first.
- **`RP`**: the only feature whose instance DB name and copied library file
  aren't parallel to `NAME`/`LOOP_NAME` constants — `RP.FB` is picked per
  item from `FB_dict` based on the item's `type`, and `gen_copy_list` always
  copies both `CP.scl` and `DP.scl` regardless of which types are actually
  used.
- **`motor`/`valve`**: parameter-list rendering branches on
  `document.CPU.platform` inside `build_list` itself (Portal: one combined
  in+out positional call; Step 7/PCS7: input-only call plus separate output
  assignment statements) rather than pushing the branching into the
  template — see each converter's `build_list`.
