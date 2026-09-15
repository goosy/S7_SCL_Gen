# Design: Conversion Pipeline

This document describes how a GCL folder becomes an SCL output folder —
the mechanics behind [spec.md](spec.md) and [spec-gcl-format.md](spec-gcl-format.md).

## 1. High-level flow

```
GCL YAML files
  -> gcl.js: parse to yaml Documents (+ custom merge-key handling)
  -> gen_data.js pass 1 (parse_conf/parse_doc): build CPU/Area model, register symbols
  -> gen_data.js pass 2 (build_list per area): complete cross-referencing data
  -> gen_data.js gen_list: ask each converter for its copy/convert task list
  -> [optional] rules/apply.js: rewrite the task list per an external rules file
  -> index.js process(): render templates (gooplate) / copy files, write output
```

Entry points: `src/cli.js` (CLI) calls `convert()` in `src/index.js`, which
calls `gen_data()` then `process()`. Anything importing `s7-scl-gen` as a
library gets the same `convert` function from `src/index.js`.

## 2. Core data model (`src/gen_data.js`)

- **`CPU`**: one per distinct CPU name. Holds `platform`, `device`,
  `output_dir`, a private `#areas` map keyed by feature name (one `Area` per
  feature), the CPU-wide `S7SymbolEmitter` (`symbols`), pending
  `async_symbols` promises, `non_symbols` (values that could not be resolved
  to a real symbol and are passed through as raw SCL expressions, reported
  as warnings), and the CPU-wide address allocators (`conn_ID_list`,
  `conn_host_list`, used by `MT`).
- **`Cpu_Pool`**: a `Map<string, CPU>` with `get()` overridden to
  lazily create a `CPU` on first reference — so a document can reference a
  CPU before that CPU's own `CPU` document has been parsed.
- **`Area`**: the per-(CPU, feature) working set: the parsed `document`,
  its `attributes`, `includes` (already resolved to an SCL string),
  `files`, `list` (mutated in place from raw YAML nodes to converter-owned
  objects — see [design-converters.md](design-converters.md)), `loop_begin`/
  `loop_end`, and `options`.

## 3. Two-pass processing

Each feature converter (`src/converters/converter_<feature>.js`) implements
`initialize_list(area)` (pass 1) and, optionally, `build_list(area)` (pass
2). The split exists because symbol references can be **forward** — a
document may reference a symbol name that is only defined later in the same
CPU, or even in a document that hasn't been parsed yet — so no converter can
safely assume all symbols exist yet during pass 1.

1. **Pass 1** (`parse_doc`, invoked once per document, in file/CPU order
   with `CPU` documents forced first): registers the document's own
   `symbols`, invokes `initialize_list(area)` to turn each `list` YAML node
   into a plain-object representation the templates can consume. Any
   configuration value that might be a symbol (see
   [design-symbols.md §4](design-symbols.md#4-resolving-configuration-values))
   is resolved via `make_s7_expression`, which returns either the resolved
   value immediately or a `Promise` queued on `cpu.async_symbols` if the
   referenced symbol hasn't been added yet.
2. Once every document has run pass 1, each CPU's symbol emitter emits
   `'finished'`, which (a) triggers `build_symbols()` — final address
   allocation and duplicate detection (see
   [design-symbols.md §2](design-symbols.md#2-conflict-detection)) — and (b)
   resolves any still-pending forward references as an S7 expression
   fallback (a name that never turns out to be a real symbol is treated as a
   literal SCL expression, and is listed in the "non-symbols" warning).
   `gen_data()` awaits all queued `async_symbols` promises before continuing.
3. **Pass 2** (`build_list(area)`, only if the converter defines it): runs
   after all symbols are finalized, so it can safely read fields like
   `symbol.block_no`, `symbol.type_name`, or values from other features'
   areas on the same CPU. This is where derived/aggregate fields are
   computed (e.g. `interlock`'s per-field SCL statements, `MT`/`SC`'s poll
   byte-offset packing, `motor`'s per-platform parameter string assembly).

A `CPU` document that doesn't exist yet, but is referenced by a non-`CPU`
document, is synthesized on demand (`create_fake_CPU_doc`) with default
platform `step7` so the pipeline never has to special-case a missing CPU
document — the feature simply reads the CPU's defaults.

## 4. From Area to output files (`gen_list`)

For every `(CPU, feature, Area)` triple, `gen_list()`:

- Expands `area.files` into concrete `copy` task entries (`{ source,
  input_dir, distance, output_dir, IE, OE, line_ending, ... }`), resolving
  globs and the `//`-split path-preservation syntax.
- Calls the converter's `gen_copy_list(area)` for feature-library files
  (e.g. `AI_Proc(step7).scl`) and appends those as `copy` entries too.
- Calls the converter's `gen(area)`, which returns one or more `{ distance,
  output_dir, tags, template }` descriptors; `gen_list` merges in common
  tags (`context`, `gcl`, string-padding helpers, `cpu_name`/`feature`/
  `platform`, and everything on `area` itself — `includes`, `list`,
  `loop_begin`, `loop_end`, `options`) and looks the named template string up
  in the generated `templates` map (see
  [design-converters.md §2](design-converters.md#2-the-templates-map)),
  producing a `convert` task entry.
- After all CPUs/areas are processed, appends one more `convert` task per
  CPU for the symbol table itself (`gen_symbols`, see
  [design-symbols.md §5](design-symbols.md#5-symbol-table-export)).

The result is a flat list of `copy` and `convert` task objects — this is the
list the rules engine operates on (see
[design-rules-engine.md](design-rules-engine.md)) before `index.js`'s
`process()` actually renders templates (via `gooplate`'s `convert()`) and
writes files with the configured encoding/line-ending.

## 5. Build-time self-generation

`src/converter.js` is **generated**, not hand-written (its header says so).
`build.js`:

1. Scans `src/converters/` for `converter_<feature>.js` files, validates
   each exports `is_feature`/`initialize_list`/`gen`/`gen_copy_list`, and
   collects the matching `<feature>.template` and `<feature>.yaml` files.
2. Renders each feature's `.yaml` (built-in symbol list) through `gooplate`
   using the converter module's own exports as tags (so a `.yaml` file can
   reference e.g. `{{NAME}}`/`{{LOOP_NAME}}` constants exported by its
   converter), concatenates them into one multi-document
   `src/symbols_buildin.yaml` (and copies it to `lib/`).
3. Renders `src/converter.template` (itself a gooplate template) with the
   discovered feature list and template contents, writing the result as
   `src/converter.js` — this is what produces the `import * as X from
   './converters/converter_X.js'` block, the `supported_features` array, and
   the `templates` map embedding every `.template` file's contents as a
   string constant.
4. Bundles `src/index.js` -> `lib/index.js` and `src/cli.js` -> `lib/cli.js`
   with rolldown.

Practical consequence: **adding a new converter or renaming a converter/
template file requires re-running the build** (`pnpm build`/`pnpm watch`)
before the change takes effect, and `src/converter.js` should never be
hand-edited — edit `src/converter.template` instead if the generation logic
itself needs to change.

## 6. The `context` object (`src/util.js`)

A single mutable module-level object holding cross-cutting run state:
`module_path` (package root, used to locate templates and library
submodules), `work_path` (current GCL folder, mutated by the CLI on `chdir`),
`version`, and the I/O defaults (`output_zyml`, `no_convert`, `no_copy`,
`silent`, `IE`, `OE`, `line_ending`). CLI flags mutate it directly; library
consumers of `src/index.js` can do the same before calling `convert()`.
