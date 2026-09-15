# CLI Specification

Entry point: `src/cli.js` (built to `lib/cli.js`, exposed as the `s7scl` bin).
Argument parsing uses `mri`.

## 1. Invocation

```
s7scl [subcommand] [path] [options]
```

- `path` is the folder containing the GCL YAML files (the "GCL folder").
  Defaults to `.` (the current working directory).
- `subcommand` defaults to `convert` — running `s7scl` with no arguments
  converts the current directory.

## 2. Subcommands

| Subcommand | Aliases | Behavior |
|---|---|---|
| `convert` | `conv` | Reads every `*.yaml`/`*.yml` file directly under `path`, generates SCL/symbol-table output, and (unless disabled) copies static files. This is the default. |
| `watch` | `monitor` | Runs the built CLI under `nodemon`, watching `*.yaml` and `*.scl` under `path`, re-running `convert` on change. Supports the `rs` restart keystroke. |
| `gcl` | `init`, `template` | Scaffolds a new GCL folder: copies the packaged `example/` directory and `README.md` to `path` (default `./GCL`) so a new user has sample configs to edit. |
| `help` | — | Prints usage text. Also triggered by `--help`/`-H`, or as the fallback for any unrecognized subcommand. |

## 3. Options

| Flag | Aliases | Effect |
|---|---|---|
| `--version` | `-V`, `-v` | Print the package version and exit; overrides any subcommand. |
| `--help` | `-H` | Print help and exit; overrides any subcommand. |
| `--output-zyml` | — | Also emit an uncommented copy of each CPU's merged configuration as `<output_dir>/<cpu_name>.zyml` (useful for diffing/debugging what the parser saw). |
| `--no-convert` | — | Skip writing generated SCL files (still runs the full pipeline and reports diagnostics). |
| `--no-copy` | — | Skip the file-copy step (`includes`/`files`/library sources). |
| `--silent` | `-s`, `-S` | Suppress progress/diagnostic console output. |
| `--line-ending` | — | Force output line endings: `CRLF` (default) or `LF`. |
| `--OE` | — | Output file encoding, e.g. `gbk` (default) or `utf8`. |
| `--rules` | — | Path to a rules YAML file (see [design-rules-engine.md](design-rules-engine.md)). When set, `path` is ignored: the rules file itself specifies, per task, which folder to convert and which rules to apply. |

Flags map directly onto the shared `context` object (`src/util.js`); anything
not overridden by a flag falls back to `context`'s defaults (`OE: 'gbk'`,
`line_ending: 'CRLF'`, `IE: 'utf8'`, `silent: false`, etc.).

## 4. Exit behavior

- Configuration errors (bad symbol, type conflict, duplicate feature
  document, etc.) are reported to stderr with source-location information
  (`file:line:col` plus the offending YAML snippet) and terminate the process
  with a non-zero exit code (see `elog`, `throw_symbol_conflict`,
  `throw_type_incompatible` in `src/symbols.js`).
- Successful `convert` prints a confirmation line unless `--silent`/`--no-convert`.

## 5. `--rules` mode vs. plain `convert`

Plain `convert` processes exactly one GCL folder (`path`) using only the
built-in converters. `--rules <file>` instead reads a list of `{ path, rules
}` tasks from the rules file (`get_rules`, `src/rules/parse.js`); for each
task the CLI `chdir`s into `path`, sets `context.work_path` accordingly, and
runs `convert({ rules })`, which applies the rules to the generated
copy/convert list before writing files. This allows one rules file to drive
multiple GCL folders with different post-processing per folder.
