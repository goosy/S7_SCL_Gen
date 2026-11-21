# Rule File Specification

A rule file (rml) is a YAML file passed with `s7scl --rules <file>` (see
[spec-cli.md](spec-cli.md)). **Without touching** the GCL source, it
post-processes the output task list produced by the conversion: merging
several files, adding or removing outputs, changing output locations and
templates, rewriting the item lists inside files, and so on. This lets
deployment-related adjustments live outside the GCL configuration.

This document specifies the format and behavior of rule files. The
implementation is described in [design-rules-engine.md](design-rules-engine.md).

## 1. Task list

A GCL conversion produces a **task list**, in which each task (item)
corresponds to one output file. Rules act on this list; only after all rules
have been applied is each item remaining in the list actually copied or
generated.

There are two item types:

- `copy` items: copy a source file into the output folder.
- `convert` items: generate an output file from a template.

Item properties that rules can match and modify:

| Property | Item type | Meaning |
|---|---|---|
| `type` | both | `copy` or `convert` |
| `cpu_name` | both | name of the owning CPU |
| `feature` | both | owning feature, e.g. `AI`, `CPU`; `symbol` for the symbol-table item |
| `platform` | both | `step7`, `portal` or `pcs7` |
| `output_dir` | both | output folder |
| `distance` | both | output file path relative to `output_dir` |
| `OE` | both | output encoding |
| `line_ending` | both | output line ending, `LF` or `CRLF` |
| `input_dir` | `copy` | source folder |
| `source` | `copy` | source file path relative to `input_dir` |
| `IE` | `copy` | source file encoding; empty means a byte-for-byte copy |
| `template` | `convert` | template used to generate the file |
| `tags` | `convert` | variables of that template (template tags); `list` among them is the item list of the feature, from which the template generates content entry by entry |

## 2. File structure

A rule file consists of one or more YAML documents. Each document is a
**rule task**, executed independently:

```yaml
config_path: <relative path>   # optional, default '.'
attributes: { ... }            # optional, template variables of this task
rules:                         # list of rules, applied in order
  - pattern: { ... }
    scope: applied | origin    # optional, default applied
    actions: [ ... ]
  - sort_by: [ field, '@field' ]
```

- `config_path`: the GCL folder to convert, relative to the folder of the
  rule file. For each rule task, the generator converts that folder and then
  applies `rules` to the resulting task list.
- `attributes`: template variables of this task, see
  [§6](#6-attributes).
- `rules`: the list of rules. Rules are applied one after another in the
  order written; later rules see the results of earlier ones.

Malformed rules or actions are ignored with a warning.

## 3. Rules

There are two kinds of rules:

- **Matching rules**: `pattern` (may be omitted, see below), `scope` and
  `actions`. `pattern` first selects the matching items from the list, then
  `actions` are executed in order.
- **Sorting rules**: only `sort_by`, which sorts the current list, see
  [§3.3](#33-sorting).

### 3.1 Patterns

`pattern` is an object whose keys correspond to item properties; an item
matches when every corresponding property matches. `pattern` can also be
written directly as a string or an array of strings, which is then matched
against the item as a whole (`'*'` is commonly used for all items).

Pattern values:

| Pattern | Matches |
|---|---|
| `'*'` | any non-null value |
| `'%u'` | `null` or absent |
| `'%b'` / `'%s'` / `'%n'` / `'%a'` / `'%o'` | any boolean / string / number / array / plain object |
| `'%O'` | any other object (not null, boolean, string, number, array or plain object) |
| plain string, e.g. `'AS*'` | glob match against a string value |
| `'!pattern'` | negated glob match |
| array of strings | satisfies at least one positive pattern and all negated patterns; e.g. `['AS*', '!*2', '!*3']` matches values starting with `AS` but not ending in `2` or `3` |
| object | recursive: each key matches the corresponding sub-property |

When a property value is an array, it matches as soon as any element matches.

A rule without `pattern` matches no item and may contain only `add` actions
(see [§4.4](#44-add)), used to create items from nothing.

### 3.2 Match source `scope`

- `applied` (default): matches against the current list, i.e. the list after
  the earlier rules have been applied, including items added or merged by
  earlier rules.
- `origin`: matches against the original list before any rule was applied,
  unaffected by earlier rules.

### 3.3 Sorting

```yaml
- sort_by: [ feature, '@cpu_name' ]
```

Sorts the current list by the listed properties: the first property is the
primary sort key, and each following one is the next secondary key. A `@`
before a property name means descending order. A property name may use `.`
to reach a sub-property, e.g. `DB.name`.

## 4. Actions

Each action is an object, in which:

- `action_type`: the action type, `replace`, `join`, `merge`, `add`,
  `delete` or `inner_rules`. When omitted it is `replace`; when the action
  has `rules` it is `inner_rules`.
- `action_scope`: the items the action acts on, default `matched`:
  - `matched`: the items matched by this rule's `pattern`;
  - `merged`: the items merged by earlier `merge` actions of this rule;
  - `new`: the items added by earlier `add` actions of this rule;
  - `all`: the union of the three above.
- The remaining keys are the **properties** to write into items.

Shorthands:

- An action written as the string `delete` is the same as
  `{ action_type: delete }`; `actions: delete` is the same as
  `actions: [delete]`.
- An action written as an array is the same as
  `{ action_type: inner_rules, rules: <that array> }`.

Property values are written after template substitution per
[§5](#5-template-substitution).

### 4.1 replace

Overwrites the item's properties of the same name with the action's
properties, including whole arrays and objects. A property value of `null`
deletes that property from the item.

### 4.2 join

Combines instead of overwriting: object properties are merged key by key,
array properties get elements appended, other values are simply replaced. A
property value of `null` deletes that property from the item.

### 4.3 merge

Merges the `convert` items matched by this rule into **one new** `convert`
item, which is added to the list and can be processed further with
`action_scope: merged`. Only valid with `action_scope: matched`; matched
items that are not `convert` are skipped.

How items are merged:

- `tags`: the `tags` of the items are merged one after another in join mode,
  so arrays such as `list` are concatenated. The `cpu_name`, `feature` and
  `platform` of the items are not merged into `tags`.
- `template`, `distance`, `output_dir`: when consistent across the items,
  that value is taken; when inconsistent, the action itself must give it,
  otherwise this merge is cancelled.
- `cpu_name`, `feature`, `platform`: the value when consistent, `''` when
  inconsistent.
- `OE`: the value when consistent, `utf8` when inconsistent.
- `line_ending`: the value when consistent, `CRLF` when inconsistent.
- Finally the action's own properties are applied to the new item, and the
  action's values win.

The original items stay unchanged and are still output individually; when
they are not wanted, remove them with `delete` (for how to write this
together with inner rules, see [§4.5](#45-delete)).

After a merge, the `cpu_name`, `feature` and `platform` of the original items
are lost. When they, or values derived from them, are needed after the
merge, the rules keep them themselves, see
[§7](#7-keeping-values-before-a-merge).

### 4.4 add

Adds one new item for each item acted on; when the rule has no `pattern`,
adds a single item. The new item **inherits nothing** from the item acted on:
all its properties come from the action, so a `copy` item must spell out
`type`, `source`, `input_dir` and so on, and a `convert` item `type`,
`template` and so on. A new item that does not specify `OE` or `line_ending`
is output with `utf8` or `CRLF` respectively.

In an `add` action, the template variable `$` refers to the item acted on
(the source of the new item), not to the new item.

### 4.5 delete

Removes the matched items from the list; they are neither copied nor
generated. Only valid with `action_scope: matched`.

`delete` should be the last action of its rule: actions after it are ignored
with a warning. `replace`, `join` and `inner_rules` actions of the same rule
that act on `matched` are not executed, since those items have been deleted;
`merge` and `add` are executed as usual, so "merge, then delete the
originals" can be written in a single rule.

### 4.6 inner_rules

Applies a set of **inner rules** to the `tags.list` of a `convert` item (the
item list inside the file, e.g. the channels of an AI document):

```yaml
- pattern: { feature: AI, type: convert }
  actions:
  - rules:
    - pattern: { $enable_AH: { value: true } }
      actions:
      - action_type: add
        tagname: '{{$.DB.name}}.HH_flag'
    - sort_by: [ tagname ]
```

Inner rules are written like outer rules; patterns, `scope` and actions act
on the elements of `tags.list`, and the result is written back to
`tags.list`. The differences:

- The `merge` and `inner_rules` actions cannot be used; they are ignored with
  a warning.
- Each element carries an `__original_index` property giving its position in
  the original list, usable for sorting.
- For the context of template substitution, see
  [§5](#5-template-substitution).

The inner rules are executed once for each item acted on.

## 5. Template substitution

Before an action's property values are written into an item, they go
through gooplate template substitution: `{{...}}` in strings is evaluated
against the template variables. Substitution applies to strings at every
level of objects and arrays. When the item's original value is a boolean and
the substituted result is `true`/`false`, a boolean is written.

Strings not meant as templates must not contain `{{` or `}}`.

The template variables consist of the following parts; on a name clash,
**the later part wins**:

| Where the action is | Template variables |
|---|---|
| outer rule | the task's `attributes`, the `tags` of the item acted on (none for `copy` items), the `cpu_name`, `feature` and `platform` of the item acted on, `$` |
| inner rule | the task's `attributes`, the `tags` of the outer item, `$` |

- `$` refers to the item being processed: in outer rules the item acted on;
  in inner rules an element of `tags.list`; in `add` actions, in both cases,
  the source item of the new item. `$` exists only in the template
  substitution of actions; it is never written into items and is not
  available in output templates.
- In inner rules, `cpu_name`, `feature` and `platform` come from the `tags`
  of the outer item; they are not written into inner elements, and
  `$.cpu_name` etc. have a value only when the element itself has those
  properties.
- When an outer action specifies `cpu_name`, `feature` or `platform`, these
  values are substituted first and written into the item, and later
  properties and actions see the new values.
- The values of `template`, `input_dir` and `output_dir` are paths relative
  to the folder of the rule file, and are also substituted.
- An action's `tags` property is joined into the item's `tags`, whatever the
  action type.

## 6. attributes

`attributes` holds the template variables of this task, written as an
object:

```yaml
attributes:
  link_names:
    GD1: CCProgram
    GD2: GDProgram
```

Requirements:

- They are available in every template substitution of this task: the
  property values of actions in outer and inner rules, and the template of
  every `convert` item when it is output after the rules have been applied,
  whether or not an action modified that item.
- On a name clash with the item's own `tags`, the item's `tags` win:
  `attributes` only add variables missing from `tags` and never override
  variables produced by the generator (such as `list`). When shadowing
  occurs, a warning is emitted naming the key and the item.
- They must not contain the keys `cpu_name`, `feature` or `platform`. When
  parsing the rule file finds any of these three keys, an error is reported
  naming the rule file and the key, and the conversion stops. These three
  values always come from the item itself; to change them, specify them in a
  rule action (see [§5](#5-template-substitution)).
- `attributes` serve only as template variables and are never written into
  item properties.

## 7. Keeping values before a merge

After a `merge`, the `cpu_name`, `feature` and `platform` of the original
items are no longer available (see [§4.3](#43-merge)). The generator does not
keep them on behalf of the rules: when these values, or values derived from
them, are needed after the merge, the rule author must write them explicitly
into some property of the elements with inner rules **before** the `merge`.

For example, to merge the alarm lists of several CPUs and give every alarm
the program name of its CPU:

```yaml
attributes:
  link_names:
    GD1: CCProgram
    GD2: GDProgram
rules:
- pattern: { feature: AI, type: convert }
  scope: origin
  actions:
  - rules:                       # before the merge: each element records its program name
    - pattern: '*'
      actions:
      - link_name: '{{link_names[cpu_name]}}'
  - action_type: merge           # the merged template uses the elements' link_name directly
    cpu_name: dist
    template: alarms.template
    output_dir: dist
    distance: alarms.csv
- pattern: { feature: AI, type: convert }
  scope: origin                  # matches only the original items, not the merged one
  actions: delete
```

Deleting the original items must be written as a separate rule: if it were
in the same rule as the inner rules, the inner rules would not be executed
(see [§4.5](#45-delete)).
