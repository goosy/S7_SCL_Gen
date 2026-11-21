---
id: vpb7rvnd
opened: 2026-11-21T00:16:49.535Z
closed: 2026-11-21T00:37:40.025Z
title: Inner rules write cpu_name, feature and platform into items
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: [rules, breaking]
remote:
---

## Problem

When `apply_action` has `parent_tags` (that is, in inner rules), it unconditionally runs:

```js
$.cpu_name = cpu_name;
$.feature = feature;
$.platform = platform;
```

These three values come from `parent_tags` and already enter the template context through `...parent_tags`, so writing them onto `$` is redundant (it only makes `{{$.cpu_name}}` work too, as in the `add` actions of task 4 of `test/rules.rml`). It also has side effects:

- For `replace` and `join`, `$` is the item itself, so the three fields are permanently written into every inner item, polluting the item data; later matching, merging and template output all see them.
- The write overwrites unconditionally. In inner rules after a merge, `parent_tags` is the merged task's tags. The merge does not carry `cpu_name`, `feature` and `platform` over from the tags of each task; they are set only when the merge action itself specifies them, so they are usually `undefined`, and the item's original values are overwritten with `undefined` (or with the values the merge action specifies).

This does not conform to `doc/spec-rules.md` §5: `$` exists only in the template substitution of actions and is never written into items; in inner rules, `cpu_name`, `feature` and `platform` come from the tags of the outer item and are not written into inner elements, and `$.cpu_name` etc. have a value only when the element itself has those properties.

## Proposal

Remove the assignments to `$.cpu_name`, `$.feature` and `$.platform`; templates use `{{cpu_name}}`, `{{feature}}` and `{{platform}}` instead.

- When the pre-merge `cpu_name`, `feature` or `platform` is needed after a merge, the rml keeps it itself: before the merge, an inner rule writes these values or values derived from them (e.g. `link_name: '{{link_names[cpu_name]}}'`) explicitly into some property of the item. The converter does not keep these values on behalf of the rules. This is a requirement on rule authors, see `doc/spec-rules.md` §7.
- This is a breaking change: inner rules that use `{{$.cpu_name}}`, such as `test/rules.rml`, and the description of the inner template context in `doc/design-rules-engine*.md` must be updated, and the CHANGELOG must say so.

Rejected alternatives:

- Changing the assignment to `$.cpu_name ??= cpu_name` to keep the item's original value: it still writes data into items as a side effect, which is obscure; which values to keep, and in which property, is for the rml to decide explicitly.

## Decision

Accepted. Inner rules unconditionally writing `cpu_name`, `feature` and `platform` into items violates spec-rules §5 and overwrites the items' original values; when pre-merge values must be kept, the rml writes them explicitly as §7 describes.
