# S7_SCL_Gen 规格说明

> 本文是 [spec.md](spec.md) 的中文译本。

## 1. 目的

S7_SCL_Gen 是一个面向西门子 S7 PLC 项目的命令行代码生成器。用户用一种
YAML 配置语言（称为 **GCL**，Generative Configuration Language，生成式配置
语言）描述 I/O 点、通信链路和控制逻辑，工具据此生成可直接导入 Step 7、
TIA Portal 或 PCS7 的 SCL（Structured Control Language，结构化控制语言）
源文件。

大型 PLC 项目中，同一功能块往往存在数百个几乎相同的实例（AI 通道量程
转换与报警、Modbus 轮询、电机联锁、阀门控制、定时器等）。本工具的目的
就是消除为这些重复模式手写 SCL 时的繁琐与易错。

## 2. 范围

范围之内：

- 一种基于 YAML 的配置语言（GCL），涵盖 CPU 全局设置以及 12 种受支持的
  "feature"（功能类别）：`CPU`、`AI`、`AO`、`interlock`、`limit`、
  `motor`、`ModbusTCP`（`MT`）、`PI`、`RP`、`SC`、`timer`、`valve`。
- S7 符号/地址管理：对属于同一 CPU 的所有文档进行解析、校验、自动分配
  和冲突检测。
- 基于模板生成 SCL 源文件（组织块、函数、数据块），并生成 Step 7
  （`symbols.asc`）或 Portal（`symbols.sdf`）符号表。
- 将各功能的静态 SCL 库源文件（以独立的 git 子模块提供，见
  [§5](#5-外部依赖)）复制到每个 CPU 的输出目录，并复制/合并用户提供的
  `includes` 和 `files`。
- 一个后处理**规则引擎**，由外部规则 YAML 文件驱动，可在不改动 GCL 源的
  前提下改写生成的复制/转换任务列表（见
  [design-rules-engine.zh-cn.md](design-rules-engine.zh-cn.md)）。
- 一个命令行工具（`s7scl`），提供 `convert`、`watch` 以及
  `gcl`/`init`/`template` 子命令。

范围之外：

- 生成的 `.scl`/`.asc`/`.sdf` 文件的所有下游环节：导入 Step 7 /
  TIA Portal / PCS7、编译、下载到 PLC。
- 各功能 SCL 功能块库（`AI_Proc`、`AO_Proc`、`CP_Poll`、`Limit_Proc`、
  `MT_Poll`、`Motor_Proc`、`PI_Proc`、`RP_Trigger`、`Timer_Proc`、
  `Valve_Proc`）的内部实现——它们在各自的仓库中另有文档。
- 图形界面；本工具仅为 CLI/库。

## 3. 文档地图

| 文档 | 内容 |
|---|---|
| `spec.zh-cn.md`（本文） | 目的、范围、工具，以及到其余文档的链接 |
| [spec-gcl-format.zh-cn.md](spec-gcl-format.zh-cn.md) | GCL YAML 配置语言：文档、指令、值类型 |
| [spec-cli.zh-cn.md](spec-cli.zh-cn.md) | `s7scl` 命令行接口及其选项 |
| [spec-converters.zh-cn.md](spec-converters.zh-cn.md) | 12 种受支持功能各自的作用及生成内容 |
| [design-pipeline.zh-cn.md](design-pipeline.zh-cn.md) | GCL 目录如何变成 SCL 输出目录：两遍处理流水线、CPU/Area 模型、符号解析时机、build.js 自生成 |
| [design-symbols.zh-cn.md](design-symbols.zh-cn.md) | S7 地址/类型系统、分配、冲突检测、内置符号、符号表导出 |
| [design-rules-engine.zh-cn.md](design-rules-engine.zh-cn.md) | 后处理规则引擎：模式匹配与动作 |
| [design-converters.zh-cn.md](design-converters.zh-cn.md) | 转换器插件接口、模板引擎约定以及各功能的实现说明 |
| `design-converter-<feature>.zh-cn.md` | 单个功能转换器的详细实现说明（按需提供，由 design-converters 的对应条目链接） |

需求与行为属于 `spec*.md`；内部机制与算法属于 `design*.md`（见
`d:/codes/AGENTS.md`）。代码生成只能依据这些文档——若文档对某一点有歧义
或未作说明，应先与维护者澄清再编写代码。

## 4. 工具、依赖、构建

- **运行时**：Node.js >= 21.2.0，仅 ESM（`"type": "module"`）。
- **包管理器**：pnpm。
- **语言**：JavaScript（无 TypeScript 编译步骤，仅使用 JSDoc 类型）。
- **主要依赖**：
  - `yaml` —— GCL 解析（在其之上有自定义的合并键处理，见
    `src/gcl.js`）。
  - `gooplate` —— 模板引擎，既用于 SCL 模板，也用于 `build.js` 自身的
    代码生成。
  - `iconv-lite` —— SCL 输出的 GBK/UTF-8 编码转换（Step 7 工具链要求
    GBK）。构建时打包进 `lib/`，不是运行时依赖。
  - `globby`、`matcher`、`mri`、`nodemon`、`rimraf`、`rolldown` —— 构建/
    CLI 基础设施。
  - 以上均为开发依赖，运行时用到的都由构建打包进 `lib/`，发布的包没有运行时
    依赖。`watch` 子命令调用的是用户自行全局安装的 `nodemon` 命令。
- **构建**：`node build.js`（别名 `pnpm build`）通过 rolldown 将
  `src/index.js` 和 `src/cli.js` 打包到 `lib/`；在打包之前，会根据
  `src/converters/` 的内容重新生成 `src/converter.js` 和
  `src/symbols_buildin.yaml`。见
  [design-pipeline.zh-cn.md §5](design-pipeline.zh-cn.md#5-构建时自生成)。
- **测试**：`node --test` 运行 `test/` 下的全部测试（`node:test`、
  `node:assert/strict`）。测试会转换 `example/` GCL 目录，并与固定样例
  比对或检查产出的任务列表——`example/` 既是文档示例也是回归测试样例，
  因此其配置文件与期望输出必须与转换器保持同步。

## 5. 外部依赖

以下是独立的 git 仓库，以子模块（`.gitmodules`）形式接入，检出在仓库
根目录。每个仓库保存一个功能的手写 SCL/AWL 功能块库；对应转换器的
`gen_copy_list()` 会把其中相关文件从这些目录复制（文本文件同时转码）到
GCL 的输出目录：

| 子模块 | 使用它的功能 |
|---|---|
| `AI_Proc` | `AI` |
| `AO_Proc` | `AO` |
| `CP_Poll` | `SC`（包含 `CP340_Poll.scl`、`CP341_Poll.scl`、`CRC16.awl`） |
| `Limit_Proc` | `limit` |
| `MT_Poll` | `MT`（ModbusTCP） |
| `Motor_Proc` | `motor` |
| `PI_Proc` | `PI` |
| `RP_Trigger` | `RP`（包含 `CP.scl`、`DP.scl`） |
| `Timer_Proc` | `timer` |
| `Valve_Proc` | `valve` |

这些库的内部设计（FB/FC 接口、实例数据结构）由各库自行负责，此处不再
重复；本规格只记录生成器所依赖的约定（各平台的文件命名规则，见
[spec-converters.zh-cn.md](spec-converters.zh-cn.md)）。
