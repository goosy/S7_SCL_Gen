# Design: Post-Processing Rules Engine

Implemented in `src/rules/` (`parse.js`, `match.js`, `apply.js`). This
subsystem rewrites the flat `copy`/`convert` task list produced by
`gen_data()` (see [design-pipeline.md §4](design-pipeline.md#4-from-area-to-output-files-gen_list))
*without* touching the GCL source — driven instead by a separate rules YAML
file passed via `--rules` (see [spec-cli.md §5](spec-cli.md#5---rules-mode); the format and behavior of
rule files are specified in [spec-rules.md](spec-rules.md)).
It exists to let deployment-specific tweaks (merge several CPUs' loop calls
into one file, inject extra items, drop unwanted output) live outside the
tracked GCL configuration.

## 1. Rules file structure (`parse.js`)

A rules YAML file is one or more documents, each describing one **task**:

```yaml
config_path: <relative path>   # optional, default '.'
attributes: { ... }            # optional template variables of this task
rules:
  - pattern: { ... }
    scope: applied | origin    # optional, default 'applied'
    actions: [ ... ]
  - sort_by: [ 'field', '@field' ]   # '@' prefix = descending
```

`get_rules(filename)` reads the file and returns an array of `{ path, rules,
attributes }` tasks — one per document — where `path` is `config_path`
resolved against the rules file's own directory. The CLI runs
`convert({ rules, attributes })` once per task, `chdir`-ing into `path` first.

`get_attributes` checks `attributes` at parse time: when it is not a plain
object, a warning is emitted and `{}` is used; when it contains any of
`cpu_name`, `feature` or `platform`, a `SyntaxError` naming the rules file and
the key is thrown. The attributes are kept on the task only and are not copied
into the actions.

Each `rule.actions` entry is normalized (`regularize`) before use:

- The string `'delete'` shorthand expands to `{ action_type: 'delete' }`.
- A bare array shorthand expands to `{ action_type: 'inner_rules', rules:
  <array> }`.
- `action_type` defaults to `'replace'` unless `rules` is present
  (`'inner_rules'`).
- `action_scope` defaults to `'matched'`.
- `delete`/`merge` are only valid with `action_scope: 'matched'`.
- A rule with no `pattern` may only contain `add` actions (nothing to match
  against).
- `inner_rules` actions are parsed recursively as **document rules**: the
  same rule grammar, but `merge` and nested `inner_rules` are rejected
  there (`using_inner_rules` flag) since they only make sense against the
  top-level task list.

## 2. Pattern matching (`match.js`)

`match(obj, pattern_object)` recursively compares a task-list item against a
pattern object. Pattern values support:

| Pattern | Matches |
|---|---|
| `'*'` | any non-null value |
| `'%u'` | `null`/`undefined` |
| `'%b'` / `'%s'` / `'%n'` / `'%a'` / `'%o'` | any boolean / string / number / array / plain object |
| `'%O'` | any other object (not null/bool/string/number/array/plain-object) |
| plain string, e.g. `'AS*'` | glob match (via `matcher`) against a string value |
| `'!pattern'` | negated glob match |
| array of strings | union of positive globs ∩ intersection of negated globs — e.g. `['AS*', '!*2', '!*3']` matches strings starting with `AS` but not ending in `2` or `3` |
| plain object | recurses: every key must match the corresponding property |

For an array-valued property, `match` matches if **any** element matches the
pattern (`Array.prototype.some`). `match_all(list, pattern)` filters a list
down to items where `match(item, pattern)` is true.

## 3. Actions (`apply.js`)

`apply_rules(list, rules, attributes)` calls the internal `run_rules` with
`env = { attributes, parent_item: null }`; `run_rules(list, rules, env)` runs
each rule against a working
`Set` (`applied_list`, initialized from the input list so later rules see
earlier rules' effects) in order, either applying `sort_by` (via
`multi_sort`) or calling `apply_rule`.

For a rule with a `pattern`, `matched_items = match_all(source, pattern)`
where `source` is `applied_list` (`scope: 'applied'`, default — sees prior
rules' output) or the original untouched `list` (`scope: 'origin'`). Actions
then run against one of three scope buckets: `matched` (the pattern matches),
`merged` (items created by a `merge` action earlier in the *same* rule), or
`new` (items created by an `add` action earlier in the same rule) — or
`all` (their union).

| Action | Applies to | Effect |
|---|---|---|
| `replace` | `matched`/`merged`/`new` | Overwrite the target's properties with the action's properties (including whole arrays, e.g. `files`). |
| `join` | same | Merge instead of overwrite: object properties merge key-by-key, array properties append. |
| `merge` | `matched` only, `convert` items only | Combine several matched `convert` tasks into **one new** task (added to `merged`), in two phases: phase 1 folds each matched item's `tags`/`template`/`distance`/`output_dir`/`cpu_name`/`feature`/`platform`/`OE`/`line_ending` into the new item (mismatched non-tag fields collapse to `''`/`'utf8'`/`'CRLF'`; mismatched `template`/`distance`/`output_dir` cancel the whole merge); phase 2 applies the action's own properties on top (action values win). Originals are left untouched — pair with a `delete` if they should stop being emitted independently. |
| `add` | none needed (works even with `pattern: null`) | Create one new item per source item (or one item, sourced from `{}`, when there's no pattern) via a **fresh** `replace`-style application (`$` in template expressions refers to the source item under `action_type: 'add'`, unlike the target under every other action type). The new item does not inherit the source item's fields; without an `OE` or `line_ending` it is written as `utf8` or `CRLF` respectively (see [design-pipeline.md §4.1](design-pipeline.md#41-output-encoding), [§4.2](design-pipeline.md#42-output-line-ending)). |
| `delete` | `matched` only | Remove matched items from the task list entirely; must be the only/last action in its rule (subsequent actions in the same rule are dropped with a warning), and cancels any `replace`/`join`/`inner_rules` action with `action_scope: matched` in the same rule. |
| `inner_rules` | the rule's own action target, `convert` items whose `tags.list` is itself a nested per-item list (see below) | Recursively apply a nested rules array to `target.tags.list`, as **document rules** (see §4). |

Property values inside an action (aside from a handful of reserved keys:
`action_type`, `action_scope`, `action_target`, `rules_path`, `tags`,
`cpu_name`, `feature`, `platform`, `input_dir`, `output_dir`, `template`) are
template-substituted via `gooplate`'s `convert(tags, value)` before being
applied. `tags` is a context built for this action only and never written
into any item:

- Outer rules: `{ ...attributes, ...source.tags, cpu_name, feature, platform, $ }`,
  where `source` is the item acted on (the source item in `add` actions,
  otherwise the target) and `cpu_name`, `feature`, `platform` come from
  `source`'s own properties; `$` is a copy of the source item in `add`
  actions, otherwise the target. `cpu_name`/`feature`/`platform` set by the
  action itself are substituted, written into the target and its `tags`, and
  update the context for the later properties.
- Inner rules: `{ ...attributes, ...parent_item.tags, $ }`.

`layer_tags(attributes, tags, item)` lays the attributes under the tags: the
tags win on a name clash, and each shadowed key is reported once per item
(recorded in a `WeakMap`). An action's `tags` property is joined into the
target's `tags` by `update_tags`, with `cpu_name`/`feature`/`platform`
removed from it.
`template`, if given as an action property, is read from a file (path
resolved relative to the rules file, `action.rules_path`) via `get_template`
and cached.

## 4. Document rules (`inner_rules`)

A `convert`-type task's `tags.list` is the same per-item array a template
iterates over (e.g. an `AI` document's list of channels — see
[design-pipeline.md §2](design-pipeline.md#2-core-data-model-srcgen_datajs)).
An `inner_rules` action applies a nested rules array to exactly that array,
using the same `apply_rule`/`match`/action machinery, but:

- `env.parent_item` is set to the enclosing item, and the template context
  of nested actions is `{ ...attributes, ...parent_item.tags, $ }`, so
  `cpu_name`/`feature`/`platform` come from the parent. These three values are not written into
  the inner element (`$`); `$.cpu_name` etc. have a value only when the
  element itself has those properties (see
  [spec-rules.md §5](spec-rules.md#5-template-substitution)).
- `merge` and further `inner_rules` actions are rejected during parsing.
- Each inner item gets a `__original_index` stamped on it first, preserving
  original ordering information across rule application for later use if
  needed.

This is the mechanism for reaching *inside* a generated file's item list
(e.g. reordering or filtering individual AI channels) without touching the
GCL source.

## 5. Practical notes

- `merge` + `delete` is the standard pattern for combining several CPUs'
  (or features') loop-call functions into a single new file while
  suppressing the originals.
- `multi_sort` pops the entries from the end of a copy of `sort_by` (leaving
  `sort_by` itself intact, so a sorting rule can be applied repeatedly) and
  runs one stable sort per entry, so the entry sorted last, i.e. the
  **first** one listed, is the primary key, as
  [spec-rules.md §3.3](spec-rules.md#33-sorting) requires.
- All property values run through gooplate template substitution, so plain
  strings containing `{{`/`}}` need escaping if they aren't meant as
  template expressions.
