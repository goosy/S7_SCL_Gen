# SC 使用指南

SC（别名 `MB`、`modbusRTU`）通过 CP340/CP341 串口模块轮询串口设备。支持 ModbusRTU 主站，也支持自定义报文的普通串口通信，两者可以在同一模块中混用。

- 支持平台：`step7`
- 支持模块：CP340、CP341
- 生成文件：`SC_Loop.scl`，内含轮询定义块 `SC_polls_DB` 和主循环 `SC_Loop`；另外复制库文件 `CRC16.awl`，以及用到的 `CP340_Poll.scl`/`CP341_Poll.scl`
- 使用方法：在 OB 中调用 `SC_Loop`
- 依赖：Step 7 项目中需要引入标准库。CP340 使用 `P_RCV`(FB2)、`P_SEND`(FB3)；CP341 使用 `P_RCV_RK`(FB7)、`P_SND_RK`(FB8)

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/SC.yaml](../../example/SC.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-SC

list:
- comment: CP02 流量计
  model: CP341
  module: [CP02, IW752]
  DB: [CP_02, DB882]
  polls:
  - comment: 流量计30
    unit_ID: 30
    func_code: 4
    address: 12
    length: 28
    recv_DB: [Flow30, DB830]
    recv_start: 0
...
```

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `CP340_Poll` | `FB340` | CP340 轮询 FB |
| `CP341_Poll` | `FB341` | CP341 轮询 FB |
| `CRC16` | `FC464` | Modbus CRC16 校验 |
| `SC_Loop` | `FC341` | 主循环函数 |
| `SC_polls_DB` | `DB880` | 轮询定义块，存放所有轮询的控制项和发送报文 |

## 3. 模块（list 项）属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 模块的背景 DB，类型由 `model` 决定 |
| `module` | 二选一 | S7符号定义 \| S7符号引用 | 模块地址，如 `IW752` |
| `module_addr` | 二选一 | 正整数 | 模块地址的数字部分；会自动定义符号 `CP<序号>_addr` |
| `polls` | 是 | 数组 | 轮询列表，至少 1 项，见第 4 节 |
| `model` | 否 | 字符串 | `CP341`（默认）或 `CP340` |
| `name`（或 `polls_name`） | 否 | 字符串 | 模块轮询组的名称，供 rules 规则使用，默认 `polls_<模块地址>`；不影响生成的 SCL |
| `try_times` | 否 | 正整数 | 连续失败多少次后标记设备无效并暂停该轮询，FB 默认 5 |
| `retry_times` | 否 | 正整数 | 暂停后经过多少次再重试，FB 默认 50 |
| `comment` | 否 | 字符串 | 注释 |

- **`DB` 的名称必须是合法标识符**（字母或下划线开头，只含字母、数字、下划线），因为它同时用作 `SC_polls_DB` 中的字段名。
- 每个模块的 `DB` 必须不同。

## 4. 轮询（polls 项）属性

每个轮询发送一帧报文并接收响应。发送报文有三种来源，**只能选一种**：

| 方式 | 配置 | 说明 |
|---|---|---|
| Modbus | `unit_ID`、`func_code`、`address`、`length` | 生成器构造 ModbusRTU 请求，CRC 由运行时自动计算 |
| 自定义报文 | `send_data` | 原样发送的字节，如 `31 31 30 30 0D` |
| 外部发送块 | `send_DB` + `send_start` | 报文由用户程序在发送块中准备，可以动态修改 |

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `recv_DB` | 是 | S7符号定义 \| S7符号引用 | 接收块 |
| `recv_start` | 是 | 正整数 | 接收块中的起始字节 |
| `unit_ID` | Modbus | 正整数 | 从站地址 |
| `func_code` | Modbus | 正整数 | 功能码：01–06、15、16 |
| `address`（或 `started_addr`） | Modbus | 正整数 | 起始地址 |
| `length`（或 `data`） | Modbus | 正整数 | 读取/写入个数；对 05、06 功能码为写入值 |
| `extra_data` | 功能码 15/16 | 字符串 | 写入的数据字节，空格分隔的十六进制 |
| `send_data` | 自定义报文 | 字符串 | 空格分隔的十六进制字节 |
| `send_DB` / `send_start` | 外部发送块 | 符号 / 正整数 | 发送块及报文起始字节 |
| `mode` | 否 | 字符串 | 轮询模式，见 4.1 |
| `timeout` | 否 | 正整数（毫秒） | 超时时间或周期，默认 2000 |
| `enable` | 否 | 布尔 | 是否启用本轮询的初始值，默认 `true` |
| `custom_trigger` | 否 | 布尔 | 手动触发位的初始值，默认 `false` |
| `is_modbus` | 否 | 布尔 | 按 Modbus 校验响应；默认有 `send_data` 时为假，否则为真 |
| `extra_code` | 否 | 字符串 | 附加 SCL 代码，写 `FB` 时自动调用 FB 类型的背景块，规则同 [MT](guide-MT.zh-cn.md#53-extra_code) |
| `comment` | 否 | 字符串 | 注释 |

`unit_ID`、`func_code`、`address`、`length` 可以写成十六进制，如 `0x1e`。

### 4.1 轮询模式 mode

| `mode` | 行为 | `timeout` 的含义 |
|---|---|---|
| `continuous`（默认） | 不间断轮询，收到响应或超时后立即进行下一轮 | 最长等待时间 |
| `periodicity` | 按固定周期轮询 | 轮询周期 |
| `custom` | 不自动轮询，由程序触发 | 最长等待时间 |

`custom` 模式下，置位 `"SC_polls_DB".<模块DB名>[<序号>].custom_trigger` 发送一次。适合写操作。

### 4.2 运行中控制

每个轮询在 `SC_polls_DB` 中有一组控制项，路径为 `"SC_polls_DB".<模块DB名>[<序号>]`，序号从 0 开始：

| 字段 | 说明 |
|---|---|
| `enable` | 启用本轮询 |
| `pause` | 连续失败超过 `try_times` 后暂停（自动维护） |
| `continuous` / `periodicity` | 轮询模式 |
| `custom_trigger` | 手动触发 |
| `timeout` | 超时/周期（毫秒） |

### 4.3 接收块格式

| 偏移 | 内容 |
|---|---|
| +0.0 | 设备正常 |
| +0.1 | 设备数据无效 |
| +0.2 | 本周期收到数据 |
| +0.3 | 轮询暂停或未启用 |
| +1 起 | 收到的原始报文（Modbus 时依次为从站地址、功能码、数据…、CRC） |

Modbus 响应会校验功能码、从站地址和 CRC，任一不符都视为接收失败。

建议用一个 FB 定义接收块的结构，并在该 FB 中解析数据，例如 `recv_DB: [Flow30, DB830, JS_flow]` 配合 `extra_code: FB`。接收块的 FB 不能有必须赋值的参数。

## 5. 示例：同一模块混用多种报文

```yaml
list:
- comment: CP02
  module_addr: 752
  DB: [CP_02, DB882]
  polls:
  # Modbus 读
  - comment: 流量计30
    unit_ID: 0x1e
    func_code: 4
    address: 12
    length: 28
    recv_DB: Flow30
    recv_start: 0
    extra_code: FB

  # 自定义报文，1 秒一次
  - comment: 天然气3#流量计
    send_data: 03 03 00 00 0C 8E 5D
    recv_DB: GAS
    recv_start: 20
    mode: periodicity
    timeout: 1000

  # 动态写线圈：发送块由 FB 维护，手动触发
  - comment: 写线圈
    mode: custom
    send_DB: cmd_ret
    send_start: 20
    recv_DB: cmd_ret
    recv_start: 0
    extra_code: |-
      "write_SC"."cmd_ret"(writing := "SC_polls_DB".CP_02[3].custom_trigger);
```

## 6. 示例：Modbus 写多个寄存器

功能码 15、16 需要用 `extra_data` 给出写入的数据字节。写操作一般用 `custom` 模式，由程序在需要时触发：

```yaml
list:
- comment: CP03 变频器
  module: [CP03, IW768]
  DB: [CP_03, DB883]
  polls:
  - comment: 读运行参数
    unit_ID: 1
    func_code: 3
    address: 0
    length: 10
    recv_DB: [VFD1, DB850]
    recv_start: 0

  - comment: 写频率设定（一个浮点数，2 个寄存器）
    mode: custom
    unit_ID: 1
    func_code: 16
    address: 17
    length: 2
    extra_data: 42 48 00 00        # 50.0
    recv_DB: VFD1
    recv_start: 40
```

触发写入：`"SC_polls_DB".CP_03[1].custom_trigger := TRUE;`

`extra_data` 是固定的。写入值需要在运行中变化时，改用外部发送块（`send_DB` + `send_start`）。

## 7. 常见错误

| 报错 | 原因 |
|---|---|
| `SC 第n个 module 没有正确定义背景块!` | 缺少 `DB` |
| `SC:module(...) 未提供 module 或 module_addr!` | 两者都没有 |
| `SC:module(...) 模块地址有误!` | `module` 不是有效的模块地址 |
| `SC:module... 的类型 "..." 不支持` | `model` 不是 `CP340`/`CP341` |
| `DB name "..." is a invalid identifier!` | 模块 DB 名称不是合法标识符 |
| `DB name "..." is not unique!` | 两个模块使用了同一个 DB |
| `配置项 unit_ID、send_data 和 send_DB 只能存在1个!` | 同时配置了多种报文来源 |
| `send_DB、poll.unit_ID 和 poll.send_data 必须提供且只提供一个!` | 三种报文来源都没有 |
| `如果提供了配置项 unit_ID, is_modbus 只能为真!` | Modbus 轮询设置了 `is_modbus: false` |
