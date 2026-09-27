# GCL 配置基础

GCL 是本工具使用的 YAML 配置格式。本文介绍所有 feature 共用的规则，各 feature 的具体用法见同目录下的 `guide-<feature>.zh-cn.md`。

| feature | 别名 | 用途 | 指南 |
|---|---|---|---|
| `CPU` | — | CPU 级公共设置、自定义 OB/FC | [guide-CPU](guide-CPU.zh-cn.md) |
| `AI` | — | 模拟量通道转换与限值报警 | [guide-AI](guide-AI.zh-cn.md) |
| `alarm` | `pv`、`pv_alarm`、`pvalarm` | 过程值（REAL）限值报警 | [guide-alarm](guide-alarm.zh-cn.md) |
| `interlock` | `IL` | 联锁与事件触发 | [guide-interlock](guide-interlock.zh-cn.md) |
| `motor` | — | 电机控制 | [guide-motor](guide-motor.zh-cn.md) |
| `valve` | — | 电动阀门控制 | [guide-valve](guide-valve.zh-cn.md) |
| `timer` | — | 运行时间计时 | [guide-timer](guide-timer.zh-cn.md) |
| `PI` | — | FM350-2 计数模块 | [guide-PI](guide-PI.zh-cn.md) |
| `RP` | `relay`、`pulse` | 脉冲、延时、边沿等触发器 | [guide-RP](guide-RP.zh-cn.md) |
| `MT` | `modbusTCP` | ModbusTCP 轮询 | [guide-MT](guide-MT.zh-cn.md) |
| `SC` | `MB`、`modbusRTU` | CP340/CP341 串口轮询 | [guide-SC](guide-SC.zh-cn.md) |

## 1. 文件与文档

- `s7scl convert <目录>` 读取该目录下（不含子目录）所有 `*.yaml`/`*.yml` 文件。
- 一个文件可以包含多个 YAML 文档，以 `---` 分隔，可用 `...` 结束。
- 每个文档描述**一个 CPU 的一个 feature**，同一 CPU 的同一 feature 只能有一个文档。
- 同一 CPU 的文档可以分散在多个文件中，转换时会合并符号表、统一分配地址、统一检查冲突。

## 2. 文档级指令

### 2.1 必需：CPU 与 feature

两种写法任选其一：

```yaml
name: AS1-AI        # 推荐：<CPU>-<feature>
```

```yaml
CPU: AS1
feature: AI
```

CPU 名必须以字母开头、只含字母数字和下划线；feature 不区分大小写。

### 2.2 通用指令

| 指令 | 说明 |
|---|---|
| `symbols` | 符号定义数组，见第 4 节 |
| `list` | 本 feature 的配置项列表，格式见各 feature 指南 |
| `includes` | 插入到生成文件顶部的 SCL 源码，见 2.3 |
| `files` | 原样复制到输出目录的文件，见 2.4 |
| `attributes` | 自定义属性（对象），供 `includes` 中的 `{{ }}` 占位符使用 |
| `loop_begin` / `loop_end` | 插入到主循环函数开头/末尾的 SCL 代码 |
| `options.output_file` | 修改生成文件名，可使用 `{{cpu_name}}` 占位符 |

`platform`、`device`、`options.output_dir` 只在 CPU 文档中有效，见 [guide-CPU](guide-CPU.zh-cn.md)。

### 2.3 includes

```yaml
includes: |-          # 字符串：直接作为 SCL 源码
  FUNCTION "foo" : VOID
  ...

includes:             # 数组：文件列表，路径相对于 GCL 文件
- JSFlow.scl                              # 默认 UTF-8
- {filename: legacy.scl, encoding: gbk}   # 指定编码
```

- 文件中可以使用 `{{ 表达式 }}` 占位符，可用的值包括 `attributes` 中的属性、`cpu_name`、`feature`、`platform`。
- 单独成行的 `(**` 与 `**)` 之间的内容会被删除，可用来写不进入最终代码的说明。
- 占位符替换和 `(** **)` 删除只对文件形式有效，字符串形式原样插入。
- 生成器不检查 SCL 语法，也不会从中提取符号；includes 中定义的块若要被其它配置引用，需在 `symbols` 中另行定义。

### 2.4 files

```yaml
files:
- README.md                       # 复制到 <输出目录>/README.md
- os//ab/c.scl                    # 复制到 <输出目录>/ab/c.scl，// 标记保留路径的起点
- lib/*.scl                       # 支持 glob
- {filename: legacy.awl, IE: gbk} # 转换编码
```

- 路径分隔符必须用 `/`。
- 字符串形式按字节原样复制；对象形式会转换编码（`IE` 输入编码、`OE` 输出编码、`line_ending` 换行符）。

## 3. 值的类型

| 类型 | 示例 | 说明 |
|---|---|---|
| 布尔 | `true`、`FALSE` | 不区分大小写 |
| 数值 | `12.5`、`0x4A98` | |
| 字符串 | `泵进口` | 通常不需要引号 |
| TIME | `T#3S`、`TIME#10M`，或整数毫秒 `3000` | |
| SCL 表达式 | `'NOT "TIT001".LL_flag'` | 生成器不检查语法；含双引号时整体用单引号包起来 |
| S7 符号定义 | `[PIT001, DB100]` | 见第 4 节 |
| S7 符号引用 | `PIT001` | 引用已定义的符号，允许向前引用 |

以 `$` 开头的属性（如 `$zero`、`$enable`）约定为**初始值**，写入 DB 的初始值，运行中可由 HMI 修改；同名但不带 `$` 的属性（如 `enable_HH`）约定为**运行期间的赋值**，每个周期都会覆盖。

## 4. 符号

符号定义格式：`[名称, 地址, 类型?, 注释?]`

```yaml
symbols:
- [Clock_Byte, MB10]
- [recvDB, DB100, FB512, 接收块]   # FB512 的背景 DB
- [length, M100, INT, 长度]
- [TIT002, DB+]                      # 自动分配块号
- [auto_bit, M+]                     # 自动分配地址
```

- 地址中的 `+` 表示自动分配，适用于 `OB`/`DB`/`FB`/`FC`/`SFB`/`SFC`/`UDT` 块号以及 `M`/`I`/`Q`/`PI`/`PQ` 区地址。
- 类型可省略：块符号的类型就是它自己；DB 省略类型时为全局 DB。在 feature 的 `list` 中定义的 DB 会自动设为该 feature FB 的背景 DB。
- 同一 CPU 内符号名和地址都不能重复，否则报错。
- 符号可以在 `symbols` 中定义，也可以在 `list` 项中直接定义；定义后在同一 CPU 的任何文档中都可以用名称引用。

### 4.1 内置符号

每个 feature 都有内置符号（主处理 FB、主循环 FC 等），默认地址见各 feature 指南。地址冲突时，在 `symbols` 中用**相同名称**重新定义即可修改地址：

```yaml
symbols:
- [AI_Proc, FB600]
- [AI_Loop, FC600]
```

### 4.2 未定义的名称

在接受"符号引用或 SCL 表达式"的地方，如果名称既不是已定义的符号，也不是 feature 内部的名称，它会被**原样**当作 SCL 表达式输出，不会报错。拼写错误通常要到 Step 7/博途编译时才会暴露，请留意生成代码中不带引号的名称。

## 5. 复用配置：YAML 锚点

可以用 YAML 的锚点 `&` 和合并键 `<<:` 复用一组参数。为了便于阅读，建议把锚点集中定义在一个不被读取的键下（如 `template`）：

```yaml
template:
- &tubepress
  $zero: -0.2
  $span: 2.6
  $HH_limit: 2.5

list:
- DB: [PIT002, DB101]
  input: [AI01-01, PIW512]
  $HH_limit: 2.4       # 覆盖锚点中的值
  $LL_limit: ~         # 设为 null 相当于删除
  <<: *tubepress
```

## 6. 生成结果

- 所有文件输出到 CPU 的输出目录，默认为 CPU 名，可在 CPU 文档中用 `options.output_dir` 修改。
- 每个 feature 通常生成 `<Feature>_Loop.scl`（背景 DB + 主循环 FC），并复制对应的库文件 `<Feature>_Proc.scl`。
- 需要在 OB 中调用各 feature 的主循环 FC，可以直接在 CPU 文档的 `list` 中写，见 [guide-CPU](guide-CPU.zh-cn.md)。
