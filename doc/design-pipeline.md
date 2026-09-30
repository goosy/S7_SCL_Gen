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
  `output_dir`, `OE` (the default encoding of the CPU's output files, see
  [§4.1](#41-output-encoding)), `line_ending` (the default line ending of
  the CPU's output files, see [§4.2](#42-output-line-ending)), a private `#areas` map keyed by feature name (one `Area` per
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
  (e.g. `AI_Proc(step7).scl`) and appends those as `copy` entries too;
  fields given in the descriptor (including optional `OE`/`line_ending`)
  override the common fields.
- Calls the converter's `gen(area)`, which returns one or more `{ distance,
  output_dir, tags, template, OE?, line_ending? }` descriptors; `gen_list` merges in common
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
writes files with each entry's `OE`/`line_ending`.

### 4.1 Output encoding

`copy` entries expanded from `files`:

- A string entry, or an object entry with neither `IE` nor `OE`: `IE` is
  set to `null`, which makes `process()` copy the file byte-for-byte. If
  such an object entry specifies `line_ending`, `gen_list` emits a warning
  while expanding it (`console.error`, naming the GCL file and the entry's
  `filename`) that `line_ending` is ignored.
- At least one of `IE`/`OE` present: `IE` defaults to `utf8` and `OE` to
  `cpu.OE`; the file is decoded with `IE` and written with `OE`.

The `OE` of entries produced by a converter's `gen_copy_list`/`gen`, and of
the symbol-table entry, is determined by this priority:

1. The `OE` field of the converter's descriptor (the symbol-table entry has
   none).
2. The owning CPU's `cpu.OE`.

Re-encoded `files` entries and feature-library copy entries (descriptors
with `IE: 'utf8'` and no `OE`) thus follow one rule: when converting, `OE`
defaults to `cpu.OE`.

`cpu.OE` is resolved by the `CPU` converter's `build_list` from the CPU
document's `options.OE` (at the same point as `options.output_dir` →
`cpu.output_dir`); when unset it takes the platform default: `gbk` for
`step7`/`pcs7`, `utf8bom` for `portal`. A synthesized blank CPU document
has platform `step7` and therefore `gbk`. `gen_list` takes `cpu.OE` for
the common fields of every entry and for the symbol-table entry.

`utf8bom` (alias `utf8-bom`) is not an `iconv-lite` encoding name; it is
recognized by `write_file`, which encodes as `utf8` and prepends a BOM
(`iconv.encode(..., 'utf8', { addBOM: true })`). On read, `iconv-lite`
strips a source file's BOM by default, so copying a BOM-bearing source does
not produce a doubled BOM.

The rules engine can modify or add entries (see
[design-rules-engine.md](design-rules-engine.md)), so an entry reaching
`process()` may lack an `OE` (e.g. one created by `add` without an `OE`).
Such an entry is written by `write_file` as `utf8`. This is deliberate: the
fallback does not guess a platform; when another encoding is needed, the
rule must set `OE` explicitly.

### 4.2 Output line ending

The `line_ending` of every entry that writes text (re-encoded `copy`
entries and all `convert` entries) is determined by this priority:

1. The entry's own line ending: the `line_ending` key of an object-form
   `files` entry, or the `line_ending` field of a converter's
   `gen_copy_list`/`gen` descriptor (the symbol-table entry has none).
2. The owning CPU's `cpu.line_ending`.

`cpu.line_ending` is resolved by the `CPU` converter's `build_list` from
the CPU document's `options.line_ending` (at the same point as
`options.OE`); when unset it is `LF` on every platform. `gen_list` takes
`cpu.line_ending` for the common fields of every entry and for the
symbol-table entry. `files` entries copied byte-for-byte involve no line
ending (see [§4.1](#41-output-encoding)).

As with `OE`, an entry reaching `process()` may lack a `line_ending` (e.g.
one created by a rules `add` without it); `write_file` writes it with `LF`.

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
`silent`). CLI flags mutate it directly; library consumers of `src/index.js`
can do the same before calling `convert()`.
