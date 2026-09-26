# CPU 使用指南

CPU 文档存放一个 CPU 的公共设置：平台、型号、输出目录、共享的符号，以及自定义的 OB/FC 块。

- 支持平台：`step7`、`portal`、`pcs7`
- 生成文件：`CPU.scl`，只有在配置了 `includes` 或非空的 `list` 时才生成
- 同一 CPU 的所有文档共享 CPU 文档中定义的符号

每个 CPU 最多只能有一个 CPU 文档。没有 CPU 文档时，系统会自动按 `step7` 平台创建一个空白的。

通用指令（`symbols`、`includes`、`files`、`attributes` 等）见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/CPU.yml](../../example/CPU.yml)。

## 1. 最小示例

```yaml
---
name: AS1-CPU
platform: step7
device: CPU410-5H

symbols:
- [Clock_Byte, MB10]

list:
- comment: 主循环
  block: [main, OB1]
  code: |-
    "AI_Loop"();
    "Interlock_Loop"();

options:
  output_dir: SCL_{{cpu_name}}
...
```

## 2. CPU 专有指令

| 指令 | 必填 | 说明 |
|---|---|---|
| `platform` | 否 | `step7`（默认）、`portal`、`pcs7`，只能在 CPU 文档中设置 |
| `device` | 否 | CPU 型号，见第 3 节 |
| `reference_symbols` | 否 | 项目中已存在的符号，见第 4 节 |
| `options.output_dir` | 否 | 该 CPU 所有生成文件的输出目录，默认为 CPU 名 |
| `options.output_file` | 否 | CPU 文档自身生成的文件名，默认 `CPU.scl` |
| `list` | 否 | 自定义 OB/FC 块，见第 6 节 |

在非 CPU 文档中写 `platform` 会产生警告，并被忽略。

不同 feature 支持的平台不同。CPU 的平台不在某个 feature 的支持范围内时，该 feature 的文档会产生警告并被跳过：

| 平台 | 不支持的 feature |
|---|---|
| `portal` | `PI`、`MT`、`SC` |
| `pcs7` | `interlock`、`motor`、`PI`、`MT`、`SC` |

`output_dir` 中可以使用占位符：

| 占位符 | 替换为 |
|---|---|
| `{{cpu_name}}` | CPU 名 |
| `{{platform}}` | 平台 |
| `{{device}}` | CPU 型号 |

例如 `output_dir: SCL_{{cpu_name}}_{{platform}}_{{device}}`。注意型号中的 `/`（如 `CPU31x-2_PN/DP`）会使输出目录多出一级子目录。

## 3. device 型号

`device` 影响两件事：

1. `CPU31` 开头的型号会把内置符号 `GET`/`PUT` 改为 `FB14`/`FB15`（其余型号为 `SFB14`/`SFB15`）；
2. 使用 [MT](guide-MT.zh-cn.md)（ModbusTCP）时，用于确定 `TCON` 的通信设备号。此时 `device` 必须是 [MT 指南第 4 节](guide-MT.zh-cn.md#4-通信设备号devicerackxslot)表中的型号，写法要完全一致，如 `CPU31x-2_PN/DP`、`CPU410-5H`。

省略 `device` 时按 `CPU31x-2_PN/DP` 处理，因此 `GET`/`PUT` 也是 `FB14`/`FB15`。没有 MT 文档时，`device` 只影响第 1 条，可以随意填写。

## 4. reference_symbols

`reference_symbols` 用来声明 Step 7 项目中**已经存在**的符号，例如库函数。它们参与名称与地址的冲突检查，但**不会**导出到生成的符号表中。

```yaml
reference_symbols:
- [ATH, FC94, FC94, Ascii To HEX]
```

以下符号已内置，无需重复声明：

| 符号 | 地址 | 符号 | 地址 |
|---|---|---|---|
| `TP` | SFB3 | `P_RCV` | FB2 |
| `TON` | SFB4 | `P_SEND` | FB3 |
| `TOF` | SFB5 | `P_RCV_RK` | FB7 |
| `GET` | SFB14 | `P_SND_RK` | FB8 |
| `PUT` | SFB15 | `TSEND` | FB63 |
| `CNT2_CTR` | FC2 | `TRCV` | FB64 |
| `CNT2_WR` | FC3 | `TCON` | FB65 |
| `CNT2_RD` | FC4 | `TDISCON` | FB66 |
| `DIAG_RD` | FC5 | | |

建议把项目中实际使用的其它符号也列在这里，以便转换器检查冲突。

## 5. 时钟存储器 Clock_Byte

在 CPU 文档的 `symbols` 中定义 `Clock_Byte`（地址必须是 `MB<n>`），会自动生成 8 个时钟位符号：

| 符号 | 地址 | 符号 | 地址 |
|---|---|---|---|
| `Clock_10Hz` | M<n>.0 | `Clock_1.25Hz` | M<n>.4 |
| `Clock_5Hz` | M<n>.1 | `Clock_1Hz` | M<n>.5 |
| `Clock_2.5Hz` | M<n>.2 | `Clock_0.625Hz` | M<n>.6 |
| `Clock_2Hz` | M<n>.3 | `Clock_0.5Hz` | M<n>.7 |

该地址必须与硬件组态中设置的时钟存储器字节一致。不定义 `Clock_Byte` 时不生成这些符号。

## 6. list：自定义 OB/FC

`list` 的每一项生成一个**无参数**的 OB 或 FC，常用来集中写出各块的调用关系。

| 属性 | 必填 | 说明 |
|---|---|---|
| `block` | 是 | OB 或 FC 的符号定义/引用，其它块类型会报错 |
| `code` | 否 | 块体的 SCL 代码，原样输出 |
| `title` | 否 | 块标题，仅对 OB 有效 |
| `comment` | 否 | 注释，作为符号注释 |

```yaml
list:
- comment: 初始化
  block: [init, FC10]
  code: |-
    M100.0 := TRUE;
- comment: 重启
  block: [COMPLETE RESTART, OB100]
  code: '"init"();'
- comment: 0.1S 循环
  block: [Cyclic interrupt, OB30]
  code: '"AI_Loop"();'
- comment: 主循环
  block: [main, OB1]
  title: Main Program Sweep (Cycle)
  code: |-
    "Interlock_Loop"();
    "Valve_Loop"();
```

块内建议只写简单的调用代码，更复杂的逻辑放到 `includes` 或 `files` 中。

## 7. 常见错误

| 报错 / 现象 | 原因 |
|---|---|
| `符号 Clock_Byte 的地址 "..." 无效！` | `Clock_Byte` 的地址不是 `MB<n>` 形式 |
| `转换配置项必须有block!` | list 项缺少 `block` |
| `转换配置项block必须是一个 OB 或 FC 符号!` | `block` 指向了 DB/FB 等 |
| 某个 feature 被跳过并提示平台不支持 | 该 feature 不支持当前 `platform`，见第 2 节 |
| `配置 xxx-yyy 重复存在!` 并中止转换 | 同一 CPU 下同一 feature 有多个文档 |
