# CLI 规格说明

> 本文是 [spec-cli.md](spec-cli.md) 的中文译本。

入口：`src/cli.js`（构建为 `lib/cli.js`，以 `s7scl` bin 暴露）。
参数解析使用 `mri`。

## 1. 调用方式

```
s7scl [subcommand] [path] [options]
```

- `path` 是包含 GCL YAML 文件的目录（"GCL 目录"），默认为 `.`（当前
  工作目录）。
- `subcommand` 默认为 `convert`——不带任何参数运行 `s7scl` 即转换当前
  目录。

## 2. 子命令

| 子命令 | 别名 | 行为 |
|---|---|---|
| `convert` | `conv` | 读取 `path` 下（仅直接子项）的所有 `*.yaml`/`*.yml` 文件，生成 SCL/符号表输出，并（除非禁用）复制静态文件。这是默认子命令。 |
| `watch` | `monitor` | 通过 shell 调用 `nodemon` 命令（需用户自行全局安装；找不到时由 shell 报错，并以非 0 退出码退出）运行构建后的 CLI，监视 `path` 下的 `*.yaml` 和 `*.yml`，变更时重新执行 `convert`（不监视 `*.scl`，因为转换本身会写出 SCL 文件，会导致无限重启）。支持 `rs` 重启按键。 |
| `gcl` | `init`、`template` | 搭建新的 GCL 目录：将包内附带的 `example/` 目录和 `README.md` 复制到 `path`（默认 `./GCL`），让新用户有可编辑的示例配置。 |
| `help` | — | 打印用法说明。`--help`/`-H` 也会触发，且是任何无法识别的子命令的回退行为。 |

## 3. 选项

| 标志 | 别名 | 作用 |
|---|---|---|
| `--version` | `-V`、`-v` | 打印包版本并退出；优先于任何子命令。 |
| `--help` | `-H` | 打印帮助并退出；优先于任何子命令。 |
| `--output-zyml` | — | 另外将每个 CPU 合并后的配置（去除注释）输出为 `<output_dir>/<cpu_name>.zyml`（便于比对/调试解析器实际看到的内容）。 |
| `--no-convert` | — | 不写出生成的 SCL 文件（仍完整运行流水线并报告诊断信息）。 |
| `--no-copy` | — | 跳过文件复制步骤（`includes`/`files`/库源文件）。 |
| `--silent` | `-s`、`-S` | 抑制进度/诊断控制台输出。 |
| `--rules` | — | 规则文件路径，按规则文件转换，见 [§5](#5---rules-模式)。 |

这些标志直接映射到共享的 `context` 对象（`src/util.js`）；未被标志覆盖的
项回退到 `context` 的默认值（`silent: false` 等）。

## 4. 退出行为

- 配置错误（错误的符号、类型冲突、重复的功能文档等）会输出到 stderr，
  附带源位置信息（`file:line:col` 以及出错的 YAML 片段），并以非零退出码
  终止进程（见 `src/symbols.js` 中的 `elog`、`throw_symbol_conflict`、
  `throw_type_incompatible`）。
- `convert` 成功时打印一行确认信息，除非指定了 `--silent`/`--no-convert`。

## 5. `--rules` 模式

```
s7scl [convert] --rules <file> [options]
```

按规则文件转换。规则文件中的每个规则任务各自指定要转换的 GCL 目录和要应用
的规则，命令行的 `path` 被忽略；各任务按文件中的顺序依次执行。一个规则文件
可以驱动多个 GCL 目录，并为每个目录指定不同的后处理。其余选项照常生效。

规则文件的格式和行为见 [spec-rules.zh-cn.md](spec-rules.zh-cn.md)。
