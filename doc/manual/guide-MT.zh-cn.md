# MT 使用指南

MT（别名 `modbusTCP`）让 PLC 作为 ModbusTCP 主站，通过 CPU 的 PN 口轮询远程设备。每个连接对应一个远程 `IP:端口`，每个连接下可以有多个轮询（poll）。

- 支持平台：`step7`
- 生成文件：`MT_Loop.scl`，内含各连接的背景 DB、轮询定义块 `MT_polls_DB` 和主循环 `MT_Loop`；另外复制库文件 `MT_Poll.scl`
- 使用方法：在 OB 中调用 `MT_Loop`
- 依赖：Step 7 项目中需要引入标准库的 `TSEND`(FB63)、`TRCV`(FB64)、`TCON`(FB65)、`TDISCON`(FB66)
- 前提：CPU 文档中必须正确填写 `device`，见第 4 节

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/MT.yaml](../../example/MT.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-MT

list:
- comment: 智能流量计
  DB: [conn_flow, DB891]
  host: 192.168.10.10
  port: 502
  polls:
  - comment: 读取过程值
    unit_ID: 1
    func_code: 4
    address: 0
    length: 28
    recv_DB: [Flow01, DB802]
    recv_start: 0
...
```

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `MT_Poll` | `FB344` | ModbusTCP 轮询 FB |
| `MT_Loop` | `FC344` | 主循环函数 |
| `MT_polls_DB` | `DB881` | 轮询定义块，存放所有轮询的控制项和请求报文 |

## 3. 连接（list 项）属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 连接的背景 DB，自动设为 `MT_Poll` 的背景块 |
| `host` | 是 | 字符串 \| 数组 | 远程 IP，如 `192.168.10.10` 或 `[192, 168, 10, 10]` |
| `port` | 是 | 正整数 | 远程端口 |
| `polls` | 是 | 数组 | 轮询列表，至少 1 项，见第 5 节 |
| `ID` | 否 | 正整数 | 连接号，省略时自动分配；同一 CPU 内不能重复 |
| `local_device_id` | 否 | SCL 字节字面量 | 直接指定通信设备号，如 `B#16#02`；优先级最高，见第 4 节 |
| `device` | 否 | 字符串 | 本连接使用的 CPU 型号，省略时取 CPU 文档的 `device`，见第 4 节 |
| `rack` | 否 | 正整数 | 机架号，冗余 CPU 使用，见第 4 节 |
| `xslot` | 否 | 正整数 | 通信接口插槽号，如接口名为 "X2" 则填 2，见第 4 节 |
| `$interval_time` | 否 | TIME \| 整数毫秒 | 轮询间隔初始值，FB 默认 200 毫秒 |
| `interval_time` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 运行期间的轮询间隔，DINT 毫秒（不能写 TIME 字面量） |
| `comment` | 否 | 字符串 | 注释 |

- **`DB` 的名称必须是合法标识符**（字母或下划线开头，只含字母、数字、下划线），因为它同时用作 `MT_polls_DB` 中的字段名。`conn_flow` 合法，`conn-flow` 不合法。
- 每个连接的 `DB` 必须不同。
- 同一 CPU 内 `host:port` 组合不能重复。

## 4. 通信设备号：device、rack、xslot

`TCON` 需要知道本地通信接口的设备号，按以下优先级确定：

1. 连接的 `local_device_id`：直接使用该值，忽略 `device`、`rack`、`xslot`；
2. 连接的 `device`，配合 `rack`、`xslot` 查下表；
3. CPU 文档的 `device`，配合 `rack`、`xslot` 查下表；
4. 都没有时，设备号为 `B#16#02`。

建议不写 `local_device_id`，使用直观的 `device`、`rack`、`xslot`，由生成器查表并校验。`device` 必须与下表**完全一致**，`rack`、`xslot` 也必须是表中列出的取值；表中为"—"的参数不能填写（例如 `CPU317-2_PN/DP` 填了 `rack: 0`），否则报错 `指定的通信设备号"..."不存在！`。

| device | rack | xslot | 设备号 |
|---|---|---|---|
| `IM151-8_PN/DP` | — | — | 01 |
| `CPU31x-2_PN/DP`、`CPU314C-2_PN/DP`、`IM154-8_PN/DP` | — | — | 02 |
| `CPU315T-3_PN/DP`、`CPU317T-3_PN/DP`、`CPU317TF-3_PN/DP` | — | — | 03 |
| `CPU412-2_PN`、`CPU414-3_PN/DP`、`CPU416-3_PN/DP` | — | — | 05 |
| `CPU317-2_PN/DP` | — | 省略或 2 / 4 | 02 / 04 |
| `CPU319-3_PN/DP` | — | 省略或 3 / 4 | 03 / 04 |
| `CPU412-5H_PN/DP`、`CPU414-5H_PN/DP`、`CPU416-5H_PN/DP`、`CPU417-5H_PN/DP` | 省略或 0 / 1 | 省略或 5 | 05 / 15 |
| `CPU410-5H` | 省略或 0 / 1 | 省略、5 或 8 | rack 0：05（X8 为 08）；rack 1：15（X8 为 18） |

`rack`、`xslot` 在 Step 7 硬件组态中可以看到。

## 5. 轮询（polls 项）属性

每个轮询发送一个 Modbus 请求，并把响应写入接收块。请求报文有两种来源：

1. **由生成器构造**：填写 `unit_ID`、`func_code`、`address`、`length`，报文存放在 `MT_polls_DB` 中，运行中不能修改；
2. **外部发送块**：填写 `send_DB` + `send_start`，报文由用户程序在发送块中准备，可以动态修改。

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `recv_DB` | 是 | S7符号定义 \| S7符号引用 | 接收块 |
| `recv_start` | 是 | 正整数 | 接收块中的起始字节 |
| `unit_ID` | 方式 1 必填 | 正整数 | 从站地址 |
| `func_code` | 方式 1 必填 | 正整数 | 功能码 |
| `address`（或 `started_addr`） | 方式 1 必填 | 正整数 | 起始地址 |
| `length`（或 `data`） | 方式 1 必填 | 正整数 | 读取/写入个数；对 05、06 功能码为写入值 |
| `extra_data` | 功能码 15/16 必填 | 字符串 | 写入的数据字节，空格分隔的十六进制，如 `42 FF 33 33` |
| `send_DB` | 方式 2 必填 | S7符号定义 \| S7符号引用 | 外部发送块 |
| `send_start` | 方式 2 必填 | 正整数 | 发送块中报文的起始字节 |
| `enable` | 否 | 布尔 | 是否启用本轮询的初始值，默认 `true` |
| `custom_trigger` | 否 | 布尔 | 设置后本轮询改为**手动触发**，值为触发位的初始值 |
| `try_times` | 否 | 正整数 | 连续失败多少次后标记设备无效，默认 10 |
| `extra_code` | 否 | 字符串 | 本轮询的附加 SCL 代码，见 5.3 |
| `comment` | 否 | 字符串 | 注释 |

`unit_ID`、`func_code`、`address`、`length` 可以写成十六进制，如 `0x10`。

### 5.1 运行中控制轮询

每个轮询在 `MT_polls_DB` 中有一组控制项，路径为 `"MT_polls_DB".<连接DB名>[<序号>]`，序号从 0 开始：

| 字段 | 说明 |
|---|---|
| `enable` | 启用本轮询 |
| `timeout` | 通讯超时（只读） |
| `periodicity` | 按 `interval_time` 周期轮询；配置了 `custom_trigger` 时为 `FALSE` |
| `custom_trigger` | 手动触发：置位后发送一次，成功后自动复位 |
| `try_times` | 最大失败次数 |

例如 `"MT_polls_DB".conn_flow[2].custom_trigger := TRUE;` 触发一次写操作。写操作通常应使用 `custom_trigger`，避免周期性重复写入。

### 5.2 接收块格式

响应写入 `recv_DB` 从 `recv_start` 开始的位置：

| 偏移 | 内容 |
|---|---|
| +0.0 | 设备正常 |
| +0.1 | 设备数据无效（超时） |
| +0.2 | 本周期收到数据 |
| +0.3 | 轮询暂停 |
| +1 | 从站地址 |
| +2 | 功能码 |
| +3 | 数据字节数 |
| +4 起 | 数据 |

接收块通常定义为某个 FB 的背景块，由该 FB 解析数据，例如 `recv_DB: [Flow01, DB802, JS_flow]`。

### 5.3 extra_code

- 写成字符串时，作为 SCL 代码原样插入到该连接的调用之后；
- 写成 `FB` 时，自动调用发送块和接收块中类型为 FB 的背景块，例如生成 `"JS_flow"."Flow01"();`。同一个背景块只能自动调用一次，多个轮询共用接收块时，只在其中一个上写 `extra_code: FB`。

## 6. 示例：读写同一台设备

```yaml
list:
- comment: 智能流量计
  DB: [conn_flow, DB891]
  host: [192, 168, 10, 10]
  port: 502
  rack: 1
  xslot: 8
  $interval_time: 1000
  polls:
  - comment: 读取过程值
    unit_ID: 1
    func_code: 4
    address: 0
    length: 28
    recv_DB: [Flow01, DB802, JS_flow]
    recv_start: 0
    extra_code: FB
  - comment: 写两个寄存器（一个浮点数）
    custom_trigger: false      # 手动触发
    unit_ID: 1
    func_code: 16
    address: 17
    length: 2
    extra_data: 42 FF 33 33
    recv_DB: [Flow01_paras, DB+]
    recv_start: 8
```

## 7. 常见错误

| 报错 | 原因 |
|---|---|
| `...'s DB is not defined correctly!` | 连接缺少 `DB` |
| `DB name must be a valid identifier!` | 连接 DB 名称不是合法标识符 |
| `DB name "..." is not unique!` | 两个连接使用了同一个 DB |
| `配置项"host: ..."有误` / `IP地址越界` | IP 格式错误 |
| `配置项"polls"必须为数组且个数大于0!` | 缺少 `polls` |
| `配置项 send_DB 或 unit_ID 必须有一个!` | 轮询既没有外部发送块也没有请求参数 |
| `When the function code is 15 or 16, the extra_data ...` | 15/16 功能码缺少 `extra_data` |
| `指定的通信设备号"..."不存在！` | `device`/`rack`/`xslot` 组合不在第 4 节的表中 |
| `DB "..." is called repeatedly!` | 多个轮询对同一背景块使用了 `extra_code: FB` |
