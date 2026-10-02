# Design: interlock Converter

For the behavioral spec see
[spec-converters.md](spec-converters.md#interlock); for the interface and
lifecycle shared by all converters see
[design-converters.md](design-converters.md); for the user guide see
[guide-interlock.zh-cn.md](manual/guide-interlock.zh-cn.md).

`interlock` is the only feature that does not rely on an FB library block:
the converter writes all of the logic itself. Each interlock group combines
`data`/`input`/`reset`/`output` into one piece of latching logic, and
everything ends up in a single self-contained `Interlock_Loop.scl`.

## 1. Files

| File | Content |
|---|---|
| `src/converters/converter_interlock.js` | `platforms = ['step7', 'portal']`; `LOOP_NAME = 'Interlock_Loop'`; `is_feature` matches `interlock` or `il` case-insensitively |
| `src/converters/interlock.yaml` | Built-in symbol `[{{LOOP_NAME}}, FC518, ...]`, no FB |
| `src/converters/interlock.template` | The `DATA_BLOCK` of every interlock DB and the `Interlock_Loop` function |

No submodule, no library file: `gen_copy_list` returns `[]`.

## 2. Data model: the DB and group levels

Each item of the YAML `list` is one **interlock DB** holding one or more
**interlock groups** ("group" below): each item of `groups` is a group;
without `groups`, the `list` item itself is the single group.
`initialize_list` parses each `list` item into one DB object (`parse_DB`),
so `area.list` corresponds one-to-one to the YAML `list`. The two levels:

| Level | Object | Owns |
|---|---|---|
| DB | `{ name, comment, symbol, fields, data_dict, interlocks, edges }` | the `enable` field, the field namespace, the data name table, edge fields, the read/write phases, resettable clearing |
| group | `{ node, comment, extra_code, input_list, reset_list, output_list }` | the group's inputs, group reset, outputs and extra code |

**A DB is not just storage.** The following semantics are DB-level and
shared by every group of the DB:

1. **`enable` is DB-level.** `create_fields()` creates one `enable` field per
   DB, and `enable` (read source) and `$enable` (initial value) can only be
   written at DB level. In the template every group starts with
   `IF NOT "<DB>".enable`, so all groups of a DB are enabled and disabled
   together. There is no group-level enable: a group that needs to be
   enabled on its own goes into a separate DB, or combines a data item with
   an `and` input.
2. **The field namespace is DB-level**: `fields` (see §4).
3. **The data name table `data_dict` is DB-level**: data is parsed before
   any group, so every group can reference any data item of its DB by name
   (see §3.2).
4. **Read/write and resettable clearing are DB-level**: every `read` runs
   before the DB's first group, and every resettable clear and `write` runs
   after its last group (see §6).
5. **Execution order follows the configuration**: DBs in `list` order,
   groups in `groups` order.

## 3. `initialize_list`

`initialize_list` keeps a `Set` (`DB_names`) of the DB names parsed so far,
used only for the duplicate DB check, and calls
`parse_DB(document, node, DB_names)` for each `list` item. `parse_DB`
parses the DB, `enable`/`$enable` and `data`, then the groups;
`parse_IL_expression`, `conv_rest` and `parse_group` are closures inside
`parse_DB` sharing the DB's `fields`/`data_dict`.

### 3.1 DB

- A missing `DB` `elog`s (`interlock转换必须有DB块!`).
- `get_DB_name(document, DB)`: when `DB` is an array/sequence (symbol
  definition) it first calls `add_symbol` to get the name, otherwise takes
  the string value; anything but a string `elog`s.
- A name already in `DB_names` `elog`s (`interlock 的 DB "…" 重复！…`),
  pointing the user to `groups`. `DB_names` holds name strings: the symbol
  name for a symbol definition, the string as written for a symbol
  reference; the latter must resolve to an existing symbol because of
  `disallow_s7express`, so both are symbol names, compared
  case-sensitively. The check covers this document, i.e. this CPU (a CPU
  can have only one interlock document). So whether the DB is defined in
  `symbols` and referenced in `list`, or defined in `list`, two `list` items
  using the same symbol name are rejected here. The symbol table separately
  rejects the same symbol defined twice (duplicate name) and two different
  symbols with the same DB number (duplicate address).
- `make_s7_expression(name, { disallow_s7express: true, disallow_symbol_def: true, force: { type: name } })`
  is called on the name and the result stored in `DB.symbol`. The `force`
  pins the symbol's type to itself, i.e. a global DB (not an FB instance
  DB), the same mechanism by which `AI` pins its DB to an `AI_Proc`
  instance. When the user defined another type, the symbol joins
  `WRONGTYPESYMBOLS`, is warned about at the end of the conversion and
  treated as a global DB. The `force` takes effect when the symbol
  resolves (for a forward reference, on the `_added` event), before the
  `complete_type` check in `build_symbols` on `finished`. When the address
  is a bit/byte/word memory area (e.g. `M10.0`), the `force` fails at once
  with an incompatible type; when it is an FB/FC or similar block, whose
  type is already itself, the `force` cannot catch it and the DB block
  check of `build_list` rejects it (§5).
- `DB.comment`: the `list` item's `comment` (`nullable_value(STRING)`), may
  be empty.

### 3.2 Value resolution: `parse_IL_expression`

Every single boolean value in `input`, `reset` and `output` goes through
this function, which checks in order:

1. `null`/`undefined` → returned as is.
2. A string (including a YAML Scalar):
   - equal to `enable` case-insensitively after trimming → `elog` (`enable`
     may not be used in input, reset or output);
   - hitting `data_dict` → `elog` when the data `type` (default `BOOL`) is
     not `BOOL`; otherwise returns
     `{ ref, value: { value: '"<DB>".<name>' }, trigger_type, comment }`,
     with `ref` pointing at the data field object.
3. A string or sequence → `make_s7_expression(expr, { force: { type: 'BOOL' }, ... })`,
   assigned asynchronously to `ret.value`. A symbol reference is forced to
   type `BOOL`; an undefined name ends up as a verbatim SCL expression
   (unquoted, no error).
4. Anything else (a map, etc.) → returns `null`, and the caller handles the
   full object form.

The step 2 lookup happens at parse time; since data is parsed before every
group, `data_dict` already holds all data items of the DB by then.

### 3.3 `enable` / `$enable`

- `enable`: when `node.get('enable')` is not null (literals such as
  `false` included), `make_s7_expression(enable, { force: { type: 'BOOL' } })`
  → `fields.enable.read`. It must be an assignable address, checked in
  `build_list` (§5).
- `$enable`: `nullable_value(BOOL, ...)`; when present, sets
  `fields.enable.init` to `'TRUE'`/`'FALSE'` (default `'TRUE'`).

### 3.4 Splitting into groups

The group keys are `GROUP_KEYS = ['input', 'reset', 'output', 'extra_code']`,
plus `comment`. The `list` item's `comment` is always the DB comment.

- When the `list` item has a `groups` key:
  - any group key at DB level `elog`s (`… 有 groups 时，不能在 DB 层设置 …`,
    listing the keys present);
  - `groups` that is not a sequence of at least one item `elog`s;
  - an item that is not a map `elog`s, otherwise `parse_group(item)`.
- Without `groups`: `parse_group(node, true)`; the `list` item itself is the
  single group. Its `comment` then belongs to the DB, and the group is
  treated as having no comment of its own.

`parse_group` reads:

- `comment`: `nullable_value(STRING, ...)?.value`, may be empty; not read in
  the shorthand form. When empty, `build_list` takes the DB comment (§5).
- `extra_code`: `nullable_value(STRING, ...)?.value`.
- `input`/`reset`/`output`: see §3.6–§3.8.

### 3.5 `data`

`data` is parsed before the groups and must be a sequence, otherwise
`elog`. Each item:

- String shorthand: `{ name: <Scalar>, s7_m_c: true }` (`name` holds the
  YAML Scalar node itself and relies on its `toString()` when concatenated).
- Map: `name` (`ensure_value(STRING)`, required), `comment`, `type` (used
  when `is_common_type` accepts it, otherwise `BOOL`), `read`/`write` (both
  via `make_s7_expression` with `force: { type }`), `$value` (initial
  value, see below).
- `$value`: when not null, it is converted to an SCL literal through
  `INIT_FORMATTERS`, keyed by the upper-cased `type`, and stored in
  `data.init`, which `build_list` writes into the declaration: `BOOL` →
  `TRUE`/`FALSE`; `BYTE`/`WORD`/`DWORD` → `B#16#`/`W#16#`/`DW#16#` hex
  (unsigned, range checked by width); `INT` → decimal (16-bit range); `DINT`
  → `L#…`; `REAL` → decimal with a point. A failed conversion (wrong type or
  range) `elog`s. A string-shorthand data item has no initial value.
- Anything else `elog`s.
- Then `fields.push(data)` and `data_dict[name] = data`.

### 3.6 `input`

`input` must be a sequence with at least one item, otherwise `elog` (every
group needs its own `input`). Each item:

- Shorthand: `parse_IL_expression(item, { trigger_type: 'rising' })`.
- Map: `trigger` (lower-cased, default `rising`, `elog` when not in
  `TRIGGER_TYPES = ['rising', 'falling', 'change', 'on', 'off']`),
  `comment`, and either `and` or `value`:
  - `and` must be a sequence; each item goes through `parse_IL_expression`,
    an empty result (a map, a null) `elog`s, giving
    `{ items, trigger_type, comment }`;
  - otherwise `parse_IL_expression(value, { trigger_type, comment })`; an
    empty result (no `value`, or a map `value`) `elog`s.
  - A `name` in the map is not read.
- Every input object (including a data-hit reference object, which is a new
  object rather than the data field itself) is passed to
  `fields.push(input)` and so gets an automatic `b_<n>` name (see §4).

### 3.7 Group `reset` and `conv_rest`

`reset` must be a sequence. Each item goes through `conv_rest(item, false)`;
an output item's `reset` goes through `conv_rest(reset, true)`:

- `elog` unless it is a JS string, a YAML string Scalar or a sequence.
- A Scalar gives `item.value`; a JS string is used as is; a sequence
  (symbol definition) is passed as is to `parse_IL_expression`, where
  `make_s7_expression` defines the symbol.
- When a string contains the special variable `inputs` (`INPUTS_REGEX`,
  case-insensitive, not preceded by an identifier character, `.` or `"`,
  not followed by an identifier character or `"`, so `NOT(inputs)` is
  recognized while `"X".inputs` and `"inputs"` are not):
  - a group `reset` (`allow_inputs` false) `elog`s: the group reset is
    evaluated before the inputs, so `inputs` has no meaning there;
  - an output's `reset` replaces it with `output` (the template's
    `VAR_TEMP output`, i.e. this group's input OR result for the cycle).
- Then `parse_IL_expression(expr)`.

This is only regex-based recognition; a thorough solution relies on a
future SCL parser.

### 3.8 `output`

`output` must be a sequence. Each item:

- Shorthand: `parse_IL_expression(item)`.
- Map: `comment`, `value` (`parse_IL_expression`, `elog` on an empty
  result), `reset` (`conv_rest(reset, true)`).
- `inversion`: `ensure_value(BOOL, ... ?? false)`; `default`:
  `nullable_value(BOOL, ...)`.
- Three literals are derived: `setvalue = inversion ? 'FALSE' : 'TRUE'`,
  `resetvalue = inversion.toString()`, and `defaultvalue` is `default` when
  given, otherwise `resetvalue`.

Outputs are not registered in `fields`, and assignability is not checked
(unlike the `is_assignable` check of `AO`/`RP`).

## 4. Field namespace and duplicate names

`create_fields()` creates one dictionary-like `fields` object per DB
(name → field), pre-populated with `enable`, with a non-enumerable
`push(item)`:

- Names are compared case-insensitively (S7 identifiers are
  case-insensitive); used names are kept in lower case in `lower_names`,
  pre-populated with `enable`.
- When `item.name` is empty it is named `b_<++index>` automatically,
  skipping the numbers whose `b_<n>` or `b_<n>_fo` is already taken;
  `index` is a DB-level counter. Since data is registered before every
  input, automatic names and edge field names never collide with data
  names.
- A taken name `elog`s (`interlock 项属性 name:… 重复定义或已保留!请改名`).

Only `enable`, data fields and input objects enter `fields`; reset and
output items do not. Hence within one DB (across all its groups):

| Case | Result |
|---|---|
| Duplicate data names | error |
| A data item named `enable` | error |
| Names differing only in case (`reset`/`Reset`, `Enable`) | error |
| A data item named `b_<n>` or `b_<n>_fo` | fine; automatic input names skip that number |
| The same data name in different DBs | fine, independent |
| Several groups referencing the same data | fine, same field |
| Several groups using the same output target | not checked; within a cycle the later group's assignment wins |

The `<n>` in `b_<n>` is the input's running number across all groups of the
DB (including `on`/`off` inputs that need no edge field and numbers
skipped because data took them, so edge field numbers may have gaps).

## 5. `build_list`

For each DB, first the DB block check: `DB.symbol.type` must equal the
DB name and `DB.symbol.block_name` must be `DB`, otherwise `elog` (it must
be a global DB block). The `force` already pins the type to itself, so this
step mainly rejects symbols whose address is an FB/FC or similar block.
The `enable` read source is checked too: `fields.enable.read` failing
`is_assignable` (a literal or a compound expression) `elog`s, pointing to
`$enable` for an initial value. Then:

1. Comments:
   - `DB.comment ||= DB.symbol.comment ?? ''`: the DB comment shown in the
     template is the `list` item's `comment`, else the symbol comment;
   - `DB.symbol.comment ||= DB.comment`: the symbol table comment is the
     symbol's own comment, else the DB comment above;
   - for each group: `interlock.comment ||= DB.comment`, i.e. a group
     without its own comment takes the DB comment.
2. For each of `Object.values(fields)` (enable, data, inputs):
   - `expression = '"<DB>".<name>'`;
   - with `read` → `assign_read = '<expression> := <read>;'`;
     with `write` → `assign_write = '<write> := <expression>;'`;
   - when `s7_m_c` (enable and data) →
     `declaration = '<name> {S7_m_c := 'true'} : <type>[ := <init>] ;'`,
     `type` defaulting to `BOOL`; `init` comes from `$enable` (enable) or
     `$value` (data).
3. `declarations` = the `s7_m_c` fields; `read_list`/`write_list` are their
   subsets with `read`/`write`.
4. For each input of each group:
   - `and` form: item values (expressions parenthesized) joined with
     ` AND `, the whole parenthesized again in the trigger; `input.value` is
     overwritten with `{ value: <and string>, isExpress: false }` for edge
     maintenance.
   - Plain form: an expression value is parenthesized.
   - `trigger` is built from `trigger_type`; edge kinds also set
     `edge_field = '<name>_fo'` and join `DB.edges`:

     | `trigger_type` | `trigger` | edge field |
     |---|---|---|
     | `rising` | `v AND NOT "DB".b_n_fo` | yes |
     | `falling` | `NOT v AND "DB".b_n_fo` | yes |
     | `change` | `v XOR "DB".b_n_fo` | yes |
     | `on` | `v` | no |
     | `off` | `NOT v` | no |

5. Data fields **without `read`** referenced by a group `reset` or an output
   `reset` are marked `resettable = true`.
6. An output referencing a data field with `read` `elog`s.
7. A data field referenced by an output and also marked resettable gets a
   warning in the pipeline's `console.error('warning: 警告：…')` style: it
   is cleared at the end of every cycle, so HMI and `write` only see
   `FALSE`. Not an error, since group A's output reset by group B can be a
   pulse valid within one cycle.

## 6. Template and execution order

`DATA_BLOCK`: one per DB, with `{ S7_Optimized_Access := 'FALSE' }` on
Portal and `{ S7_m_c := 'true' }` otherwise; `STRUCT` lists `declarations`
first (enable, then data in registration order), then one
`<b_n>_fo : BOOL` per edge field (its comment always says "rising edge",
whatever the trigger kind). No `BEGIN` initial values are written.

`FUNCTION "Interlock_Loop" : VOID`, with `VAR_TEMP reset, output : BOOL`;
after `loop_begin`, each DB starts with a section header line
`// ===== DB "<DB>": <DB.comment>` (`: <DB.comment>` omitted when the DB
comment is empty); the group comment lines below it form the
"DB → groups" hierarchy, and the read, reset and write comment lines no
longer repeat the DB name. Then:

1. Read: the `assign_read` of `read_list` (including `enable`'s read).
2. For each group:
   1. With a group reset: `reset := r1 OR r2 ...;`
   2. `IF NOT "DB".enable THEN` outputs := `defaultvalue`;
      (with a group reset) `ELSIF reset THEN` outputs := `resetvalue`;
      `ELSE` `output := trigger1 OR trigger2 ...;`, `IF output THEN`
      outputs := `setvalue`; then for each output with its own `reset`:
      `IF <reset> THEN output := resetvalue`.
   3. Edge maintenance: `"DB".b_n_fo := v;` — runs every cycle regardless of
      enable or reset, so an edge occurring while reset or disabled is
      swallowed.
   4. `extra_code` verbatim.
3. Every `resettable` field `:= FALSE`.
4. Write: the `assign_write` of `write_list`.

Finally `loop_end`. Because reading comes first and clearing and writing
come last, a resettable data item is seen by every group of its DB within
the cycle before it is cleared.

## 7. `gen` / `gen_copy_list`

`gen` returns one descriptor:
`distance = <CPU.output_dir>/<options.output_file ?? 'Interlock_Loop.scl'>`,
`output_dir = context.work_path`, `tags = { LOOP_NAME }`,
`template = 'interlock.template'`. `gen_copy_list` returns `[]`.

## 8. Known limitations

1. **Unknown keys are silently ignored**: unknown keys at DB level and in
   groups (including the old group `name`) are not reported. Other features
   do not check either; this is a project-wide topic.
2. **Assignability is only a rough check**: the `enable` address check
   reuses `is_assignable`, which only tells literals and compound
   expressions from single variables and cannot confirm the variable
   exists.
3. **Initial value of an inverted output**: with `inversion: true` the
   reset value is `TRUE`, but the DB field starts as `FALSE`; without a
   group or per-output reset, the output can never return to `TRUE` once
   activated. The initial value is not changed automatically, since that
   would be harder to predict when several groups write one field with
   different values; the guide points it out.
4. **Timing of writing another DB's field**: a DB processed earlier sees
   the value only on the next cycle.
5. **SCL expressions are not parsed**: undefined or misspelled names, data
   names inside expressions and the recognition of `inputs` can only be
   handled as strings, pending a future SCL parser. Likewise, only a bare
   `enable` is caught in input/reset/output; the full address of the DB's
   own enable (e.g. `'"IL_pump".enable'`) passes as an ordinary expression.
