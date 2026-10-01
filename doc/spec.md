# S7_SCL_Gen Specification

## 1. Purpose

S7_SCL_Gen is a CLI code generator for Siemens S7 PLC projects. A user
describes I/O points, communication links, and control logic in a YAML
configuration language (called **GCL**, Generative Configuration Language),
and the tool generates ready-to-import SCL (Structured Control Language)
source files for Step 7, TIA Portal, or PCS7.

The tool exists to remove repetitive, error-prone hand-authoring of SCL for
recurring patterns (AI channel scaling and alarms, Modbus polling, motor
interlocks, valve control, timers, etc.) across large PLC projects that may
contain hundreds of near-identical instances of the same function block.

## 2. Scope

In scope:

- A YAML-based configuration language (GCL) covering CPU-wide settings and
  twelve supported "features" (function categories): `CPU`, `AI`, `AO`,
  `interlock`, `limit`, `motor`, `ModbusTCP` (`MT`), `PI`, `RP`, `SC`,
  `timer`, `valve`.
- S7 symbol/address management: parsing, validation, automatic allocation,
  and conflict detection across all documents belonging to one CPU.
- Generation of SCL source files (organization blocks, functions, data
  blocks) from templates, plus generation of the Step 7 (`symbols.asc`) or
  Portal (`symbols.sdf`) symbol table.
- Copying of static per-feature SCL library sources (delivered as separate
  git submodules, see [§5](#5-external-dependencies)) into each CPU's output
  folder, and copying/merging of user-supplied `includes` and `files`.
- A post-processing **rules engine** that can rewrite the generated
  copy/convert task list (see [design-rules-engine.md](design-rules-engine.md))
  without touching the GCL source, driven by an external rules YAML file.
- A CLI (`s7scl`) with `convert`, `watch`, and `gcl`/`init`/`template`
  subcommands.

Out of scope:

- Anything downstream of the generated `.scl`/`.asc`/`.sdf` files: importing
  them into Step 7 / TIA Portal / PCS7, compiling, or downloading to a PLC.
- The internal implementation of the per-feature SCL function block
  libraries (`AI_Proc`, `AO_Proc`, `CP_Poll`, `Limit_Proc`, `MT_Poll`,
  `Motor_Proc`, `PI_Proc`, `RP_Trigger`, `Timer_Proc`, `Valve_Proc`) — these
  are documented in their own repositories.
- A GUI; this is a CLI/library tool only.

## 3. Document map

| Document | Covers |
|---|---|
| `spec.md` (this file) | Purpose, scope, tooling, and links to the rest of the doc set |
| [spec-gcl-format.md](spec-gcl-format.md) | The GCL YAML configuration language: documents, directives, value types |
| [spec-cli.md](spec-cli.md) | The `s7scl` command-line interface and its options |
| [spec-converters.md](spec-converters.md) | What each of the 12 supported features does and what it generates |
| [design-pipeline.md](design-pipeline.md) | How a GCL folder becomes an SCL output folder: the two-pass pipeline, CPU/Area model, symbol resolution timing, build.js self-generation |
| [design-symbols.md](design-symbols.md) | The S7 address/type system, allocation, conflict detection, built-in symbols, symbol table export |
| [design-rules-engine.md](design-rules-engine.md) | The post-processing rules engine: pattern matching and actions |
| [design-converters.md](design-converters.md) | The converter plugin interface, the template engine convention, and per-feature implementation notes |
| `design-converter-<feature>.md` | Detailed implementation of a single feature converter (provided as needed, linked from the matching entry in design-converters) |

Requirements and behavior belong in `spec*.md`; internal mechanics and
algorithms belong in `design*.md` (see `d:/codes/AGENTS.md`). Code generation
must follow these documents only — if they are ambiguous or silent on a
point, resolve the ambiguity with the maintainer before writing code.

## 4. Tools, dependencies, build

- **Runtime**: Node.js >= 21.2.0, ESM only (`"type": "module"`).
- **Package manager**: pnpm (see `pnpm-workspace.yaml`, `pnpm-lock.yaml`).
- **Language**: JavaScript (no TypeScript compilation step; JSDoc types only).
- **Key dependencies**:
  - `yaml` — GCL parsing (custom merge-key handling on top of it, see
    `src/gcl.js`).
  - `gooplate` — the template engine used both for SCL templates and for
    `build.js`'s own code generation.
  - `iconv-lite` — GBK/UTF-8 encoding conversion for SCL output (Step 7
    tooling expects GBK). Bundled into `lib/` at build time, not a runtime
    dependency.
  - `globby`, `matcher`, `mri`, `nodemon`, `rimraf`, `rolldown` — build/CLI
    plumbing.
  - All of the above are dev dependencies; whatever is needed at runtime is
    bundled into `lib/`, so the published package has no runtime
    dependencies. The `watch` subcommand invokes the `nodemon` command that
    the user installs globally.
- **Build**: `node build.js` (aliased as `pnpm build`) bundles `src/index.js`
  and `src/cli.js` into `lib/` via rolldown, and — before bundling —
  regenerates `src/converter.js` and `src/symbols_buildin.yaml` from the
  contents of `src/converters/`. See
  [design-pipeline.md §5](design-pipeline.md#5-build-time-self-generation).
- **Tests**: `node --test` runs everything under `test/` (`node:test`,
  `node:assert/strict`). Tests convert the `example/` GCL folder and compare
  against fixtures / check the emitted task list — `example/` is both the
  documentation sample and a regression fixture, so its config files and
  expected outputs must stay in sync with the converters.

## 5. External dependencies

The following are separate git repositories, wired in as submodules
(`.gitmodules`) and checked out at the repository root. Each one holds the
hand-written SCL/AWL function-block library for one feature; the matching
converter's `gen_copy_list()` copies (and for text files, transcodes) the
relevant file(s) from these folders into the GCL's output directory:

| Submodule | Used by feature |
|---|---|
| `AI_Proc` | `AI` |
| `AO_Proc` | `AO` |
| `CP_Poll` | `SC` (contains `CP340_Poll.scl`, `CP341_Poll.scl`, `CRC16.awl`) |
| `Limit_Proc` | `limit` |
| `MT_Poll` | `MT` (ModbusTCP) |
| `Motor_Proc` | `motor` |
| `PI_Proc` | `PI` |
| `RP_Trigger` | `RP` (contains `CP.scl`, `DP.scl`) |
| `Timer_Proc` | `timer` |
| `Valve_Proc` | `valve` |

Their internal design (FB/FC interfaces, instance data structure) is each
library's own concern and is not duplicated here; this spec only documents
the contract the generator relies on (file naming convention per platform,
see [spec-converters.md](spec-converters.md)).
