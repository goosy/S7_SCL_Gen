---
id: 4gfw14fy
opened: 2026-11-21T01:13:06.062Z
closed: 2026-11-21T01:23:23.738Z
title: sort_by is emptied after its first use, so inner rules sort only the first item
status: fixed       # open | accepted | fixed | rejected | wontfix
labels: [rules]
remote:
---

## Problem

`run_rules` passes a sorting rule's `rule.sort_by` as it is to `apply_sort_criteria`, which passes it on to `multi_sort`. `multi_sort` takes the sort keys out one by one with `sort.pop()`, and when it is done the array is empty. A sorting rule is parsed only once, and every later application shares the same array object, so after the first application `sort_by` has become `[]`, and further applications do no sorting at all.

Inner rules are executed once for each item acted on, so only the `tags.list` of the first item acted on gets sorted. This does not conform to `doc/spec-rules.md` §3.3 and §4.6: a sorting rule must sort by the listed properties on every application, and inner rules are executed for each item acted on separately.

Reproduction: two convert items A and B, whose `tags.list` both hold three elements with `n` being 3, 1, 2, and the rules:

```yaml
rules:
- pattern: { type: convert }
  actions:
  - rules:
    - sort_by: [ n ]
```

After applying them, A's list is 1, 2, 3 while B's list is still 3, 1, 2; the parsed inner `sort_by` has become `[]`. The outer `sort_by` likewise becomes `[]` after its first application, so the same parsed rules no longer sort when used for another conversion.

Impact: when inner rules sort the items of several files (e.g. task 4 of `test/rules.rml` sorting the alarms by `oo`), only the first file is sorted; the other files keep their original order, and no error is reported.

## Proposal

`multi_sort` no longer modifies the array of sort keys passed in: it first makes a copy and then takes the sort keys out of the copy one by one. The root cause is that this utility function modifies its caller's argument; copying inside it protects every caller, and `rule.sort_by` stays intact on every application.

Test: two outer items use the same inner `sort_by`, and both lists are asserted to be sorted.

Rejected alternatives:

- Passing only a copy of `rule.sort_by` to `apply_sort_criteria` in `run_rules`: it fixes this issue as well, but `multi_sort` would still modify its caller's array, and other callers could still run into it later.

## Decision

Accepted. `multi_sort` modifies the array of sort keys passed in by its caller, so `sort_by` is emptied after its first use, which violates spec-rules §3.3 and §4.6; it must be fixed by using a copy inside `multi_sort`.
