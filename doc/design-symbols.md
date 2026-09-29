# Design: Symbol and Address System

Implemented in `src/symbols.js` (allocation, conflict detection, export) and
`src/s7data.js` (address arithmetic, typed value classes). This is the
subsystem behind [spec-gcl-format.md §3.5–3.6](spec-gcl-format.md#35-s7-symbol-definition).

## 1. Address model

S7 addresses are `<block_name><block_no>[.<block_bit>]`, e.g. `DB100`,
`M100.0`, `FB512`. Prefixes are grouped by how they're allocated/typed
(`src/symbols.js`):

| Group | Prefixes | Notes |
|---|---|---|
| `INDEPENDENT_PREFIX` | `OB FB FC SFB SFC UDT` | block-numbered; type is always itself |
| `INTEGER_PREFIX` | independent + `DB` | block-numbered via `IntHashList` |
| `DWORD_PREFIX` | `MD ID PID QD PQD` | 4-byte; type must be `DWORD`/`DINT`/`REAL` |
| `WORD_PREFIX` | `MW IW PIW QW PQW` | 2-byte; type must be `WORD`/`INT` |
| `BYTE_PREFIX` | `MB IB PIB QB PQB` | 1-byte; type must be `BYTE` |
| `BIT_PREFIX` | `M I Q` | bit-addressed; type must be `BOOL` |

`DB` symbols are special: their type is either themselves (a stand-alone DB)
or the name of an `FB`/`SFB`/`UDT` symbol they are an instance/typed view of
(`check_type_compatibility`, `complete_type`). Writing a `type` value that
is incompatible with a symbol's address prefix is a hard error
(`throw_type_incompatible`).

Numeric ↔ byte.bit conversion helpers: `dec2foct`/`foct2dec` (decimal offset
↔ `[byte, bit]`), `foct2S7addr`/`s7addr2foct` (`[byte, bit]` ↔ the `12.3`
style float S7 addresses are internally represented as), `get_boundary`
(word/dword alignment).

## 2. Conflict detection

Two independent allocator families, both under `S7SymbolEmitter`
(`src/symbols.js`), one instance per `CPU`:

- **`IntHashList`** (`src/s7data.js`): tracks used integers for
  block-numbered areas (`OB_list`, `DB_list`, `FB_list`, `FC_list`,
  `SFB_list`, `SFC_list`, `UDT_list`). `push(null)` (i.e. address `+` in
  GCL) finds the next free integer; `push(n)` reserves `n` or throws
  `HLError` if already taken.
- **`S7HashList`** (`src/s7data.js`): tracks used byte.bit ranges for
  `M`/`I`/`Q`/`PI`/`PQ` areas (`MA_list`, `IA_list`, `QA_list`, `PIA_list`,
  `PQA_list`), respecting operand size (`BOOL` = 0.1 byte i.e. 1 bit up to
  `DWORD` = 4 bytes) and word/dword alignment (`get_boundary`). Same
  auto-allocate-or-reserve-or-throw contract as `IntHashList`.

`S7SymbolEmitter.build_symbols()` runs once per CPU, after every document's
pass 1 has registered its symbols (triggered by the `'finished'` event, see
[design-pipeline.md §3](design-pipeline.md#3-two-pass-processing)). For each
symbol it resolves `+`/omitted addresses through the matching allocator,
detects duplicate explicit addresses (`#dict_by_address`), and finalizes
`type_name`/`type_no` via `complete_type()`. Any conflict aborts the whole
run with `throw_symbol_conflict`, printing both the current and the
previously-registered symbol's source location (file:line:col + the
offending YAML snippet, via `GCL.get_pos_info`).

Symbol **names** are checked for duplicates earlier, at registration time
(`add_symbol`) — except that re-declaring a *built-in* symbol's name is
allowed and is treated as an address/comment override
(`symbols.is_buildin(name)`), which is how [spec-gcl-format.md §1.2 `symbols`](spec-gcl-format.md#symbols)'s
override mechanism works.

## 3. Built-in symbols

`src/symbols_buildin.yaml` is generated at build time (see
[design-pipeline.md §5](design-pipeline.md#5-build-time-self-generation)) by
concatenating each converter's optional `<feature>.yaml`. Each such file
declares:

- `symbols`: exported built-in symbols for that feature (e.g. `AI.yaml`
  registers the `AI_Proc` FB and `AI_Loop` FC at fixed default numbers,
  templated with the converter's own `NAME`/`LOOP_NAME` exports).
- `reference_symbols` (CPU-only, e.g. standard `SFB`/`FB`/`FC` system
  function blocks like `TON`, `GET`, `PUT`, `TCON`): registered into the
  symbol table so other code can reference them by name, but marked
  `exportable = false` so they never appear in the emitted symbol table file
  (they already exist in every Step 7/Portal project by default).

Every document's `parse_doc` step (`src/gen_data.js`) clones and registers
its feature's built-in doc from `BUILDIN_SYMBOLS` before processing the
document's own `symbols`, so built-ins are always present but can be
overridden.

## 4. Resolving configuration values

`make_s7_expression(value, infos)` (`src/symbols.js`) is the single
dispatcher behind every "this config value might be a symbol definition, a
symbol reference, or a raw SCL expression" field described in
[spec-gcl-format.md §3.8](spec-gcl-format.md#38-union-types). Given a raw
YAML value it:

1. Returns `undefined` immediately (or throws, if `disallow_null`) for an
   absent value.
2. If it's an array/YAML sequence and symbol definitions are allowed,
   registers it as a new symbol (`add_symbol`) and returns that symbol.
3. If it's a string matching an already-registered symbol name, returns that
   symbol (applying `force`/`default` type/comment overrides via
   `apply_default_force`).
4. If it's a string that *isn't* registered yet, returns a `Promise` that
   resolves either when that name is later registered (listens for
   `<name>_added`) or, once all documents are done (`'finished'`), falls
   back to treating it as a raw SCL expression (recorded in
   `cpu.non_symbols` for the end-of-run warning) — unless
   `disallow_s7express` is set, in which case it's a hard error.
5. Otherwise (a literal number/boolean, or a string that already looks like
   an SCL expression) wraps it as a plain `{ value, isExpress }` ref object.

`infos.force`/`infos.default` let a converter pin a field's type (e.g. AI's
`DB` field must be type `AI_Proc`) or supply a fallback comment without
overriding a value the user did provide.

## 5. Symbol table export

`gen_symbols(cpu)` (`src/symbols.js`) produces one more `convert` task per
CPU, rendering the CPU's full symbol list (sorted by address, then name) into
whichever text format the target tool expects:

- **Step 7** (`platform !== 'portal'`): fixed-column `126,<name> <address>
  <type> <comment>` lines, written as `symbols.asc`.
- **Portal**: CSV-like quoted lines
  `"name","%address","type","True","True","False","comment","","True"`,
  written as `symbols.sdf`. `OB`/`FB`/`FC`/`SFB`/`SFC`/`UDT` symbols are
  omitted from the Portal export (they aren't tag-table entries).

Only symbols with `exportable !== false` are included in either format. The
symbol-table file is written in the owning CPU's `cpu.OE` encoding (see
[design-pipeline.md §4.1](design-pipeline.md#41-output-encoding)).
