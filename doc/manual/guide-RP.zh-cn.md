# RP 使用指南

RP（别名 `relay`、`pulse`）提供延时和脉冲类的信号处理：接通延时、断开延时、边沿脉冲、变化脉冲等。每一项生成一个定时器实例。

- 支持平台：`step7`、`portal`、`pcs7`
- 生成文件：`RP_Loop.scl`，内含各项的背景 DB 和主循环 `RP_Loop`；另外复制库文件 `CP.scl`、`DP.scl`
- 使用方法：在 OB 中调用 `RP_Loop`
- 依赖：`TON`/`TOF`/`TP` 使用系统块 SFB4/SFB5/SFB3，Step 7 项目中需要先从标准库引入

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/RP.yaml](../../example/RP.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-RP

list:
- comment: 溢出延时报警
  DB: [overflow, DB50]
  type: onDelay
  input: [overflowsignal, I22.0]
  $time: T#3M
  output: [OFAlarm, Q22.0]
...
```

溢出信号持续 3 分钟后，`OFAlarm` 输出为真。

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `CP` | `FB824` | 变化脉冲 |
| `DP` | `FB823` | 防颤脉冲 |
| `RP_Loop` | `FC521` | 主循环函数 |

## 3. list 项属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 背景 DB，类型由 `type` 决定 |
| `type` | 是 | 字符串 | 类型，见第 4 节 |
| `input` | 是 | S7符号定义 \| S7符号引用 \| SCL表达式 | 输入信号，BOOL |
| `$time` | 否 | TIME \| 整数毫秒 | 延时或脉冲时长，写入背景 DB 的 `PT` 初始值 |
| `output` | 否 | S7符号定义 \| S7符号引用 | 输出信号，BOOL，必须可赋值；每个周期从背景 DB 的 `Q` 赋值 |
| `comment` | 否 | 字符串 | 注释，默认"信号近期有变化" |

不配置 `output` 时，结果仍可从背景 DB 的 `Q` 读取，例如 `'"overflow".Q'`。

`$time` 只是初始值，运行中可通过 HMI 修改背景 DB 中的 `PT`。

## 4. 类型

| `type` | 实现 | 行为 |
|---|---|---|
| `onDelay` | `TON` | 接通延时：输入持续为真 `$time` 后输出为真，输入为假时立即复位 |
| `offDelay` | `TOF` | 断开延时：输入为真时输出立即为真，输入变假后再保持 `$time` |
| `onPulse` | `TP` | 上升沿脉冲：输出一个 `$time` 长的脉冲，脉冲期间的新上升沿不影响 |
| `onDPulse` | `DP` | 防颤上升沿脉冲：同上，但脉冲期间的新上升沿会重新计时，延长脉冲 |
| `changePulse` | `CP` | 变化脉冲：上升沿或下降沿都输出脉冲，脉冲期间的新变化不影响 |
| `changeDPulse` | `DP` | 防颤变化脉冲：上升沿或下降沿都输出脉冲，脉冲期间的新变化重新计时 |

## 5. 背景 DB 中的字段

| 字段 | 说明 |
|---|---|
| `IN` | 输入 |
| `PT` | 时长 |
| `Q` | 输出 |
| `ET` | 已经过的时间 |

## 6. 示例

```yaml
list:
- comment: 风扇延时关闭
  DB: [resetFan, DB+]
  type: offDelay
  input: OFAlarm                # 上例的输出
  $time: T#1H
  output: [FanRun, Q22.1]

- comment: 声控灯光
  DB: [on_sound_light, DB+]
  type: onDPulse
  input: [onsound, I22.4]
  $time: 120000               # 毫秒
  output: [lighton, Q22.4]

- comment: 泵状态变化后屏蔽联锁
  DB: [pumpCD, DB+]
  type: changeDPulse
  input: [pump_run, I22.5]
  $time: T#5M
```

最后一项没有配置 `output`，`"pumpCD".Q` 可以在联锁中作为屏蔽条件使用。

## 7. 常见错误

| 报错 / 现象 | 原因 |
|---|---|
| `RP (...) 的类型 "..." 不支持` | `type` 拼写错误，注意大小写 |
| `RP转换必须有DB块!` | 缺少 `DB` |
| `RP (...) 的 output "..." 必须是可赋值的 BOOL 变量，不能是常量或表达式` | `output` 写成了常量（如 `TRUE`、`1`）或表达式（如 `'"a" AND "b"'`） |
| 编译时 `TON`/`TOF`/`TP` 未定义 | Step 7 项目中没有引入对应的 SFB |
