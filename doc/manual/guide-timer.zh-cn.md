# timer 使用指南

timer 是按秒累计的运行时间计时器，常用于统计泵、风机等设备的运行时长。计时值以总秒数和时/分/秒两种形式提供，HMI 可以直接修改。

- 支持平台：`step7`、`portal`、`pcs7`
- 生成文件：`Timer_Loop.scl`，内含主循环 `Timer_Loop`；portal 平台还包含各计时器的背景 DB。另外复制库文件 `Timer_Proc.scl`
- 使用方法：在 OB 中调用 `Timer_Loop`

step7/pcs7 平台的生成文件中不包含背景 DB 的源码，背景 DB 只出现在符号表中。

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/timer.yaml](../../example/timer.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-timer

list:
- comment: 泵运行时间
  DB: [pump_runtime, DB501]
  enable: '"PUMP-001A".run'   # 泵运行时计时
...
```

省略了 `PPS`，所以使用 CPU 的时钟存储器 `Clock_1Hz` 作为秒脉冲，此时 CPU 文档中必须定义 `Clock_Byte`（见 [guide-CPU](guide-CPU.zh-cn.md#5-时钟存储器-clock_byte)）。

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `Timer_Proc` | `FB520` | 计时器 FB |
| `Timer_Loop` | `FC520` | 主循环函数 |

## 3. list 项属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 背景 DB，自动设为 `Timer_Proc` 的背景块 |
| `enable` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 允许计时，BOOL |
| `reset` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 计时清零，BOOL |
| `PPS` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 秒脉冲，默认 `Clock_1Hz` |
| `comment` | 否 | 字符串 | 注释 |

与其它 feature 不同，timer 的每个 list 项都**必须**有 `DB`。

- `enable` 未配置时，由 HMI 控制背景 DB 中的 `enable`（初始为 `FALSE`，即默认不计时）。
- `reset` 未配置时，计时一直累计，可由 HMI 清零。
- `PPS` 可以是时钟存储器、硬件秒脉冲输入或 GPS 秒脉冲。每个 PPS 上升沿计 1 秒。

## 4. 背景 DB 中的字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `enable` | BOOL | 允许计时 |
| `reset` | BOOL | 计时清零，本字段自动复位 |
| `count` | DINT | 总秒数 |
| `hours` | DINT | 小时 |
| `minutes` | INT | 分钟（0–59） |
| `seconds` | INT | 秒（0–59） |

HMI 可以修改 `count`，也可以修改 `hours`/`minutes`/`seconds`，FB 会自动同步另一种形式。

HMI 写一次 `reset` 即可清零，该字段会自动复位。若在配置中指定了 `reset`，它每个周期都会被覆盖，为真期间计时保持为 0。

## 5. 示例

```yaml
list:
# 泵运行时计时，停泵即清零（本次运行时长）
- comment: 泵本次运行时间
  DB: [pump_runtime, DB501]
  enable: [DI04-01, I12.0]
  reset: 'NOT "DI04-01"'
  PPS: [DI04-02, I12.1]      # 硬件秒脉冲

# 累计运行时间，由 HMI 清零
- comment: 信号发送器
  DB: [signal_timer, DB502]
  enable: '"sender".work_flag'
  PPS: GPS.PPS

# 完全由 HMI 控制
- comment: 风机运行时间
  DB: [fan_runtime, DB503]
```

## 6. 常见错误

| 报错 / 现象 | 原因 |
|---|---|
| `timer转换必须有DB块!` | list 项缺少 `DB` |
| 编译时报 `Clock_1Hz` 未定义 | 省略了 `PPS`，但 CPU 文档中没有定义 `Clock_Byte` |
| 计时不走 | `enable` 为假（未配置时默认为假），或配置的 `reset` 一直为真，或 PPS 没有脉冲 |
