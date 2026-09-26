# 功能（转换器）规格说明

> 本文是 [spec-converters.md](spec-converters.md) 的中文译本。

每个 GCL 文档声明一种**功能**（feature）。本文描述 11 种受支持功能各自的
用途、平台支持、关键 `list` 条目配置键以及生成内容。它们共用的底层机制
见 [design-converters.zh-cn.md](design-converters.zh-cn.md)。

除 `CPU` 外，所有功能都遵循相同的输出约定：

- `<Feature>_Loop.scl` —— 生成的主循环 `FUNCTION`，为每个配置条目实例化/
  调用一次该功能的功能块，外加该功能所需的每条目 `DATA_BLOCK`（参数/实例
  数据）。
- `<Feature>_Proc.scl`（或该功能自己的库文件名）—— 从该功能的外部 SCL
  库子模块原样复制（带编码转换）而来（见
  [spec.zh-cn.md §5](spec.zh-cn.md#5-外部依赖)）；不是由 GCL 生成的。

## CPU

**用途**：同一 CPU 的所有其他功能文档共享的 CPU 级设置（平台、设备型号、
输出目录、共享的 symbols/includes/files），同时也是声明由原始 SCL 构成的
任意自定义 `OB`/`FC` 块的地方。

- 平台：`step7`、`portal`、`pcs7`。
- `device`：固定列表中的某个西门子 CPU 型号字符串（见
  `src/converters/converter_CPU.js` 中的 `devices`）；它会影响内置符号的
  默认值（例如在 CPU31x 上 `GET`/`PUT` 映射到 `SFB14`/`SFB15`），以及
  （对 `MT` 而言）`TCON` 中使用的通信设备 ID。
- `list` 条目各需一个 `block`（`OB` 或 `FC` 符号）和一个 `code` 字符串
  （块体的原始 SCL 语句）；`title` 可选（仅 `OB`）。
- 若 CPU 有 `Clock_Byte` 内置符号地址，会自动派生标准时钟位子符号
  （`Clock_10Hz` … `Clock_0.5Hz`）。
- 输出：`CPU.scl`（或 `options.output_file`），仅当存在 `includes` 或非空
  `list` 时才生成。不复制库文件。

## AI

**用途**：模拟量输入通道处理——原始值到工程单位的量程转换，以及超上/下限
和高高/高/低/低低报警，由 `AI_Proc` FB 支撑。

- 平台：`step7`、`portal`、`pcs7`。
- 别名：无（必须为 `AI`）。
- 关键 `list` 条目键：`DB`（实例 DB）、`input`（源 WORD，如某个 `PIW`
  通道），以及 [alarm](#alarm) 下记述的共享报警/量程键（`$zero`、`$span`、
  `$zero_raw`、`$span_raw`、`$overflow_SP`、`$underflow_SP`、
  `$AH_limit`/`$WH_limit`/`$WL_limit`/`$AL_limit` 及其对应的
  `enable_*`/`$enable_*`、`$dead_zone`、`$FT_time`）。
- 库文件名：`AI_Proc(<platform>).scl`。

## alarm

**用途**：为**不是**来自已由 `AI` 文档处理的原始 AI 通道的过程值（例如
经串口/Modbus 接收的值）做阈值报警，由 `Alarm_Proc` 支撑。

- 平台：`step7`、`portal`、`pcs7`。
- 别名：`pv_alarm`、`pv`、`pvalarm`。
- 关键 `list` 条目键：`DB`、`input`（REAL 工程单位值，而非原始计数值）、
  `invalid`（可选的质量/有效性位），以及共享报警键（`$zero`、`$span`、
  `$AH_limit`/`$WH_limit`/`$WL_limit`/`$AL_limit`、
  `enable_AH`/`enable_WH`/`enable_WL`/`enable_AL` 及其对应的 `$enable_*`
  初始值、`$dead_zone`、`$FT_time`）。限值必须满足
  `AL <= WL <= WH <= AH`；违反即为配置错误。
- 库文件名：`Alarm_Proc(<platform>).scl`。

## interlock

**用途**：最简单的保护联锁模式——一个或多个输入条件（触发类型可配置为
上升沿/下降沿/变化/电平，可选地进行 AND 组合）相 OR，置位一个或多个 BOOL
输出，并支持可选的复位条件和 `enable` 使能门控。多个 `interlock` 列表
条目可以指向同一个 DB，按 `DB` 名称把字段累积到同一个共享实例 DB 中。

- 平台：仅 `step7`、`portal`（不支持 `pcs7`）。
- 别名：`il`。
- 关键 `list` 条目键：`DB`（必需，用于分组条目）、`enable`/`$enable`、
  `data`（DB 需要携带的额外命名字段，各自带有 `read`/`write` 表达式）、
  `input`/`input_list`（必需，至少 1 项；每项可以是数据字段引用、符号、
  SCL 表达式，或带有 `trigger: rising|falling|change|on|off`、
  `and: [...]`、`value`、`comment` 的对象）、`reset`、`output`（每项可设置
  `inversion`、`default` 以及自己的 `reset`）。
- 内部的 `DB`/`Interlock`/`Field` 对象模型见
  [design-converters.zh-cn.md](design-converters.zh-cn.md#5-interlock-数据模型)
  （迁移自原先的 `interlock_class.md`）。
- 无外部库文件——生成的 `Interlock_Loop.scl` 完全自包含（没有
  `Interlock_Proc` 子模块）。

## motor

**用途**：标准的电机启动/停止/急停控制与状态反馈，由 `Motor_Proc` 支撑。

- 平台：`step7`、`portal`。
- 关键 `list` 条目键：`DB`、`enable`、`run`、`error`、`remote`（状态
  输入）、`run_action`/`start_action`/`stop_action`/`estop_action`（命令
  输出）、`$stateless`、`$over_time`。
- 输出参数的布局因平台而异：Portal 以一个位置参数列表调用 FB，包含全部
  参数（输入+输出）；Step 7/PCS7 在 FB 调用中只传入输入参数，然后逐个从
  DB 中为各输出参数赋值。
- 库文件名：`Motor_Proc(<platform>).scl`。

## MT (ModbusTCP)

**用途**：通过 CPU 板载 PN 接口进行 Modbus TCP 主站轮询，每个 `list`
条目对应一个基于 `TCON` 的连接，每个连接有自己的 Modbus 轮询列表，由
`MT_Poll` 支撑。

- 平台：仅 `step7`。
- 别名：`modbusTCP`。
- 连接级关键键：`DB`（连接实例 DB，类型为 `MT_Poll`）、`host`（点分四段
  IP 字符串或 4 元素数组）、`port`、`local_device_id`/`device`/`rack`/`xslot`
  （确定供 `TCON` 使用的通信设备 ID）、`$interval_time`/`interval_time`。
- 通信设备 ID 优先级：连接的 `local_device_id`（SCL 字节字面量，如
  `B#16#02`，原样使用）；否则取连接的 `device`，缺省时取 CPU 文档的
  `device`，再配合 `rack`/`xslot` 查内置表（组合不存在则报错）。查表按
  `device`/`rack`/`xslot` 完整组合精确匹配：表中有缺省项时 `rack`/`xslot`
  可省略，为不需要的型号填写 `rack`/`xslot` 会报错。
- 每条轮询的关键键：要么是 `send_DB` + `send_start`（轮询报文位于外部
  管理的 DB 中），要么是 `unit_ID` + `func_code` + `address`/`started_addr`
  + `data`/`length`（功能码 15/16 另加 `extra_data`），由生成器自行构建
  Modbus 请求报文并打包进共享的 `MT_polls_DB`；此外还有
  `recv_DB`/`recv_start`、`try_times`、`enable`、`custom_trigger`、
  `extra_code: FB`（若 send/recv 为 FB 类型，则自动调用其实例）。
- 连接 ID 和 TCP 端口按 CPU 分配/检查（`conn_ID_list`、`conn_host_list`）
  以避免重复。
- 库文件名：`MT_Poll.scl`（与平台无关）。

## PI

**用途**：通过西门子 FM350-2 计数模块进行高速脉冲计数，由 `PI_Proc`
支撑。

- 平台：仅 `step7`。
- 关键 `list` 条目键：`DB`（通道实例，类型为 `PI_Proc`）、`module`
  （硬件模块地址符号）或 `module_addr`（原始地址，自动包装为符号）、
  `count_DB`（FM350-2 专用参数 DB，类型为 `FM350-2`）、`model`（目前仅
  支持 `FM350-2`）。
- 库文件名：`PI_Proc.scl`（与平台无关）。

## RP

**用途**："近期变化"信号整形——基于标准 `TON`/`TOF`/`TP`（以及本项目
自己的变化脉冲 FB `CP`/`DP`）构建的接通延时、断开延时和脉冲（单脉冲或
包含下降沿）定时器。

- 平台：`step7`、`portal`、`pcs7`。
- 别名：`RELAY`、`PULSE`。
- 关键 `list` 条目键：`DB`、`type`（`onDelay`、`offDelay`、`onPulse`、
  `onDPulse`、`changePulse`、`changeDPulse` 之一——决定使用哪个 FB）、
  `input`、`output`、`$time`（脉冲/延时时长，`TIME` 字面量）。
- 库文件：`CP.scl`、`DP.scl`（来自 `RP_Trigger`）；`TON`/`TOF`/`TP` 来自
  CPU 内置的 `SFB` 库，而非复制的文件。

## SC

**用途**：通过 CP340/CP341 串口模块进行 Modbus RTU（或原始串口）主站
轮询，结构上与 `MT` 平行，但走 RS232/422/485，由 `CP_Poll`
（`CP340_Poll`/`CP341_Poll`/`CRC16`）支撑。

- 平台：仅 `step7`。
- 别名：`MB`、`modbusRTU`。
- `list` 条目（模块）关键键：`DB`（模块实例，类型视 `model` 而定为
  `CP340_Poll`/`CP341_Poll`）、`module`/`module_addr`、
  `try_times`/`retry_times`。
- 每条轮询的关键键：`mode`（`continuous`（默认）| `periodicity` |
  `custom`），以及以下三者之一：`send_data`（原始十六进制字节串，非
  Modbus 帧格式）、`unit_ID`+`func_code`+`address`/`started_addr`+
  `data`/`length`（Modbus 帧格式，自动追加 CRC）、`send_DB`+`send_start`
  （外部报文）；另有 `recv_DB`、`timeout`、`enable`、`custom_trigger`、
  `extra_code: FB`。
- 库文件：始终复制 `CRC16.awl`；`CP340_Poll.scl`/`CP341_Poll.scl` 仅在
  存在对应型号的模块时才复制。

## timer

**用途**：由时钟脉冲（`PPS`，默认 `Clock_1Hz`）驱动的简单计数/计时工具
块，由 `Timer_Proc` 支撑。

- 平台：`step7`、`portal`、`pcs7`。
- 关键 `list` 条目键：`DB`、`enable`、`reset`、`PPS`。
- 库文件名：Portal 上为 `Timer_Proc(portal).scl`，其他平台为
  `Timer_Proc.scl`。

## valve

**用途**：开关型或调节型阀门控制，带反馈、远程/就地模式以及开/关/停命令
输出，并可选基于 AI 的阀位量程转换，由 `Valve_Proc` 支撑。

- 平台：`step7`、`pcs7`、`portal`。
- 关键 `list` 条目键：`DB`、`AI`（阀位反馈 WORD，可选）、`CP`/`OP`
  （关到位/开到位限位开关输入）、`error`、`remote`、
  `close_action`/`open_action`/`stop_action`/`control_action`（命令
  输出——方向取决于平台：Portal 上为 `=>` FB 输出参数，Step 7/PCS7 上为
  DB 字段到符号的赋值语句）、`$zero_raw`/`$span_raw`/`$overflow_SP`/
  `$underflow_SP`（AI 量程转换）、`$FT_zone`、`$action_time`、
  `$signal_time`。
- 输出中还会定义与平台相适应的 `VAR CONSTANT`/`CONST` 状态字常量
  （`STOP_STATUS`、`OPEN_STATUS` 等），供循环函数使用。
- 库文件名：`Valve_Proc(<platform>).scl`。
