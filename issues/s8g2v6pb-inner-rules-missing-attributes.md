---
id: s8g2v6pb
opened: 2026-11-20T23:21:58.150Z
closed: 2026-11-21T00:49:11.750Z
title: Visibility and precedence of rml attributes do not conform to the spec
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: [rules]
remote:
---

## Problem

`doc/spec-rules.md` §5 and §6 specify for the `attributes` of an rml document:

- Within a task, attributes can be used in the template substitution of every action property value (in outer and inner rules); after the rules are applied, the output template of every convert item of that task can use them too.
- Attributes are the lowest layer of the lookup and are not written into items. Names in a template are looked up in this order: `$`, the item's own `cpu_name`, `feature` and `platform` (outer rules only), the item tags (including those modified by rule actions), attributes. When a key of the attributes is shadowed by the item tags, a warning is emitted naming the key and the item.
- Attributes must not contain `cpu_name`, `feature` or `platform`; to change them, specify them in a rule action. When parsing the rules file finds any of these three keys, it fails with an error naming the file and the key.

The current implementation does not conform in the following places.

### Inner rules cannot read attributes

At parse time, `regularize` copies `attributes` into each action's `action.tags`, including the actions of inner rules. But when `apply_action` has `parent_tags`, the template context is `{ ...parent_tags, $ }`, and `action.tags` is not used at all. `parent_tags` is the outer task's `tags`, which contains the attributes only after some outer action has called `update_tags(target, action.tags)`. The `inner_rules` branch returns before calling `update_tags`.

So whether inner rules can read attributes depends on whether some outer action happened to run before:

- When the first action of the outer rule is `inner_rules`, its inner rules cannot read attributes.
- Inner rules after `merge` with `action_scope: merged` can read them, only because `merge` calls `update_tags` as a side effect.

Reproduction (`all.rml` of the GCL project, GD section):

```yaml
attributes:
  link_names:
    GD1: CCProgram
rules:
- pattern:
    feature: [AI, limit]
    type: convert
  scope: origin
  actions:
  - rules:
    - pattern: '*'
      actions:
      - action_type: replace
        link_name: '{{link_names[cpu_name]}}'
  - action_type: merge
    ...
```

Running it fails with `TypeError: Cannot read properties of undefined (reading 'GD1')`: `cpu_name` has evaluated to `GD1`, while `link_names` is `undefined`. Writing `{{link_names[$.cpu_name]}}` gives the same result.

Impact: inner rules before the merge cannot compute a derived value from attributes directly; the rml has to store `cpu_name` into the item first and write `{{link_names[$.link_name]}}` after the merge, when the attributes happen to be available, which makes it hard to read.

### Output templates can use attributes only on some items

Attributes are merged into the item tags only by the `update_tags` of an outer action. The output template of a convert item that no outer action has modified cannot read the attributes.

### Attributes are written into item tags, with the precedence reversed

`update_tags` permanently merges the attributes into the item tags with join:

- On a name clash the attributes override the item tags, the reverse of the specified precedence.
- Join is a deep merge: an array key such as `list` or `files` in the attributes is appended to the generated data.
- Once written, the attributes have become item tags and the layers can no longer be told apart.

### No warning on shadowing

When a key of the attributes has the same name as an item tag, nothing is reported.

### cpu_name, feature and platform are silently ignored

When the attributes contain these three keys, the outer branch strips them in `update_tags`, and the inner branch does not use `action.tags` at all; neither reports an error.

### `$` is left on the item tags

The outer branch runs `tags.$ = $`, where `tags` is the item's own tags, so `$` stays on the item permanently (`$` points to the item itself, forming a circular reference), and output templates can see it as well. spec-rules §5 specifies that `$` exists only in the template substitution of actions, is never written into items and is not available in output templates.

## Proposal

Fix the handling of attributes according to the spec:

- Attributes are a task-level layer of read-only variables and are not written into the item tags. The template context of action property values (outer and inner) and that of output templates are made of the following layers, the later winning on a name clash:
  - Inner rules: `{ ...attributes, ...parent_tags, $ }`.
  - Outer rules: `{ ...attributes, ...item.tags, cpu_name, feature, platform, $ }`, where `cpu_name`, `feature` and `platform` come from the item's own properties; `copy` items have no tags, so they have only the attributes, these three properties and `$`.
  - Output templates: `{ ...attributes, ...item.tags }`, without `$`.
- `$` is put only into the temporarily built template context, never into the item tags.
- Check the attributes when parsing the rules file: fail with an error if they contain `cpu_name`, `feature` or `platform`; when applying, emit a warning for keys shadowed by the item tags.
- Update the description of the template context and of `update_tags` in `doc/design-rules-engine*.md` accordingly.

Inner rules writing `cpu_name`, `feature` and `platform` onto `$` is covered by issue#vpb7rvnd.

Rejected alternatives:

- Exposing individual properties (such as `S7Program`) to the rules as needed: the problem lies in the rules engine itself, and exposing them one by one only treats the symptom.
- Writing the attributes onto `$` one by one: it pollutes the item data.

## Decision

Accepted. Inner rules failing to read attributes, and attributes being written into and overriding the item tags, are defects of the rules engine and must be fixed according to the spec, rather than exposing properties one by one as they are needed.
