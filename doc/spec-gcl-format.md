# GCL Configuration Language Specification

GCL (Generative Configuration Language) is the YAML dialect this tool reads.
A GCL file lives in a "GCL folder"; `convert` reads every `*.yaml`/`*.yml`
file directly inside that folder (non-recursive).

## 1. Documents

A single YAML file may contain multiple documents, separated by `---` and
optionally terminated by `...` (standard YAML multi-document syntax):

```yaml
--- # document 1
name: AS1-CPU
platform: step7
device: CPU410-5H
symbols:
- [Clock_Byte, MB10]
options:
  output_dir: SCL

--- # document 2
name: AS1-AI
list:
- comment: temperature
  DB: [TIT002, DB+]
  input: [AI01-03, PIW516]
  $zero: "-40.0"
  $span: "80.0"
...
```

- Each document is one indivisible configuration unit.
- Documents can be split across multiple files; there is no requirement that
  one CPU's documents live in one file.
- The root-level keys of a document are called **directives** (`name`,
  `feature`, `CPU`, `list`, `options`, ...).
- Directive/document compatibility is versioned; `s7scl -v` reports the
  generator's version.

### 1.1 Required directives

Every document must identify which CPU it belongs to and which feature it
configures, via **one** of:

- `name`: a single string of the form `<CPU>-<feature>` (recommended — one
  value, and the name doubles as a uniqueness key), e.g. `name: AS1-AI`.
- `CPU` + `feature`: the two parts given separately, e.g. `CPU: AS1` /
  `feature: AI`.

`<CPU>-<feature>` combinations must be unique across the whole GCL folder —
i.e. a given CPU may have at most one document per feature. `feature` is
case-insensitive. See [spec-converters.md](spec-converters.md) for the full
list of supported features and their aliases (e.g. `MT`/`modbusTCP`,
`SC`/`MB`, `interlock`/`il`).

### 1.2 Optional directives (all document types)

#### `options`

A map of extra settings. Currently recognized keys include
`output_file` (override the generated file's base name) and, on the `CPU`
document only:

- `output_dir`: override the CPU's output folder, itself
  template-substitutable with `cpu_name`/`platform`/`device`.
- `OE`: the default output encoding for the output files of this CPU.
  When omitted, the platform default applies: `gbk` for `step7`/`pcs7`,
  `utf8bom` for `portal`. Valid values are the encoding names supported by
  `iconv-lite` (e.g. `gbk`, `utf8`), plus `utf8bom` (alias `utf8-bom`)
  meaning "UTF-8 with BOM".

  Every output file of the CPU — feature library copies, feature-generated
  SCL files, the symbol table, and `files` copies that are re-encoded —
  uses this value unless it specifies its own OE; `files` entries copied
  byte-for-byte involve no encoding (see [`files`](#files) below).
- `line_ending`: the default line ending for the output files of this CPU,
  `LF` or `CRLF`. When omitted it is `LF` (on every platform). It applies
  to the same files as `OE`: every output file that does not specify its
  own line ending uses this value; `files` entries copied byte-for-byte
  involve no line ending.

#### `symbols`

An array of [S7 symbol definitions](#45-s7-symbol-definition). Every feature
has built-in symbols with default addresses (see
[design-symbols.md](design-symbols.md#3-built-in-symbols)); you normally
don't write them, but if a default address collides with something else in
your project you may re-declare the same **name** with a different address
(and/or comment) here — the name itself cannot be changed.

#### `includes`

Extra SCL source merged verbatim at the top of the generated output file for
this document. One of:

1. **A string**: used directly as SCL source.
2. **An array**: each element is either a filename (string, relative to the
   GCL file's directory, assumed UTF-8) or an object
   `{ filename, encoding }` naming the file's encoding explicitly.

Included files may use `{{ expression }}` template placeholders (substituted
against the document's `attributes` map plus `cpu_name`/`feature`/`platform`),
and may wrap explanatory text that should not appear in the final SCL between
a pair of lines exactly `(**` and `**)` — everything between such a pair is
stripped before inclusion (see `parse_SCL` in `src/gen_data.js`). The
generator does not otherwise validate the included SCL.

#### `files`

An array of extra files/folders (SCL, AWL, or anything else) to copy
verbatim into the output directory, each entry relative to the GCL file's
directory using `/` as the separator (never `\`). Rules:

- A bare filename copies to `<output_dir>/<basename>` — the source path is
  not preserved.
- To preserve part of the relative path, mark the split point with `//`:
  `os//ab/c.scl` copies `os/ab/c.scl` to `<output_dir>/ab/c.scl`.
- A folder entry copies the whole folder (recursively) to
  `<output_dir>/<foldername>`.
- Glob patterns (`*`, `**`) are supported, matched with `globby`.
- An entry is either a string (the path above) or an object
  `{ filename, IE, OE, line_ending }`, where `filename` is the path above
  and the other keys are optional:
  - `IE`: encoding of the source file.
  - `OE`: encoding of the target file; accepts the same values as
    [`options.OE`](#options).
  - `line_ending`: line ending of the target file, `LF` or `CRLF`; defaults
    to the owning CPU's [`options.line_ending`](#options).
- String entries, and object entries with neither `IE` nor `OE`, are not
  converted but copied byte-for-byte. `line_ending` then has no effect; if
  such an object entry specifies `line_ending`, the generator emits a
  warning saying the entry is copied verbatim and `line_ending` is ignored.
- When at least one of `IE`/`OE` is present, the file is converted: decoded
  with `IE`, then written with `OE` and `line_ending`. `IE` defaults to
  `utf8`; `OE` defaults to the owning CPU's [`options.OE`](#options) (the
  platform default when unset). For example, `IE: utf8` alone on a step7
  CPU yields GBK output.
- The generator does not parse or validate copied file contents.

### 1.3 Other optional directives

- `list` — the feature's item list (array of objects); shape is
  feature-specific, see [spec-converters.md](spec-converters.md).
- `loop_begin` / `loop_end` — raw SCL strings spliced respectively at the
  start/end of the feature's generated main-loop function body.

## 2. The `CPU` document

Every CPU must have exactly one `CPU`-feature document (if omitted, an
internal blank one is synthesized so non-CPU documents still have a home —
see [design-pipeline.md](design-pipeline.md)). Besides the common directives
above, `platform` (`step7` (default) | `portal` | `pcs7`) and `device` are
only meaningful here; specifying `platform` on a non-CPU document logs a
warning and is ignored. All documents sharing a CPU name automatically
participate in that CPU's shared symbol table, address allocation, and
conflict checking.

## 3. Value types

### 3.1 Boolean

`true` / `false`, case-insensitive.

### 3.2 Number

Decimal or hexadecimal (`0x4A98`) literals, e.g. `zero`/`span` in AI
configuration.

### 3.3 String

Usually unquoted; standard YAML quoting rules apply when needed (e.g. to
disambiguate from another type, or to include special characters).

### 3.4 SCL expression

Same literal form as a string, but its content must be a valid SCL
expression (validity is the author's responsibility — the generator does
not check SCL syntax). If the expression contains a double quote, wrap the
whole value in single quotes per YAML rules, e.g. `'NOT "TIT001".LL_flag'`.

### 3.5 S7 symbol definition

`[name, address, type?, comment?]` — a YAML flow-sequence with 2 to 4
elements:

- `name`: the symbol's identifier.
- `address`: an S7 address like `DB100`, `M100.0`, `FB512`, or `DB+`
  (`+` requests automatic block-number allocation for `OB`/`DB`/`FB`/`FC`/
  `SFB`/`SFC`/`UDT`, or automatic address allocation within the `M`/`I`/`Q`/
  `PI`/`PQ` areas).
- `type` (optional): a valid S7 type. `FB`/`FC`/`UDT`/`OB`/`SFB`/`SFC`
  symbols are always their own type and may omit it; a `DB` symbol defaults
  to itself (a stand-alone DB) when omitted, or names the `FB`/`UDT` it is an
  instance/typed-view of.
- `comment` (optional): free text.

Example: `[recvDB, DB100, FB512, receive block]` defines a DB100 instance of
FB512 named `recvDB`. `[length, M100, INT, length]` defines an INT symbol at
`M100`.

Each symbol name and each symbol address must be unique within a CPU;
violating this is a hard error (see
[design-symbols.md](design-symbols.md#2-conflict-detection)).

### 3.6 S7 symbol reference

Once a symbol is defined (in `symbols`, or as a `list` item's own symbol
definition anywhere in the CPU), it can be referenced elsewhere by name
alone, e.g. `recvDB` refers back to the symbol defined above. References may
be **forward** — resolved once the whole GCL folder has finished its first
scan (see [design-pipeline.md](design-pipeline.md#3-two-pass-processing)).

### 3.7 Arrays and objects

Composed from the above, per the feature's own schema.

### 3.8 Union types

Some configuration items accept more than one of these types
interchangeably. Two common examples:

- `AI.DB` / `AI.input` (and their equivalents on other features): a symbol
  definition or a symbol reference.
- `interlock`'s `input` items: an object, a symbol definition, a symbol
  reference, or a raw SCL expression.

The converter for each feature performs this dispatch via
`make_s7_expression` (see [design-symbols.md](design-symbols.md#4-resolving-configuration-values)).
