# alarm 使用指南

alarm（别名 `pv`、`pv_alarm`、`pvalarm`）对一个 REAL 类型的过程值做四级限值报警。适用于不是来自 AI 通道的数值，例如通过 485/Modbus 读到的仪表值。

AI 通道请用 [AI](guide-AI.zh-cn.md)，它在同样的报警功能之外还负责原始值到工程值的转换。

- 支持平台：`step7`、`portal`、`pcs7`
- 生成文件：`Alarm_Loop.scl`，内含各报警项的背景 DB 和主循环 `Alarm_Loop`；另外复制库文件 `Alarm_Proc.scl`
- 使用方法：在 OB 中调用 `Alarm_Loop`

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/alarm.yaml](../../example/alarm.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-alarm

list:
- location: 1#储罐
  type: 液位
  DB: [LIT001, DB200]
  input: '"tank485".LIT001'
  invalid: '"tank485".invalid'
  $span: 14.0
  $AH_limit: 12.5
  $AL_limit: 3.0
...
```

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `Alarm_Proc` | `FB519` | 报警处理 FB |
| `Alarm_Loop` | `FC519` | 主循环函数 |

## 3. list 项属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 背景 DB，自动设为 `Alarm_Proc` 的背景块；没有 DB 时本项只输出注释 |
| `input` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 过程值，REAL |
| `invalid` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 过程值无效标志，BOOL；为真时取消所有报警 |
| `location` | 否 | 字符串 | 仪表位置 |
| `type` | 否 | 字符串 | 仪表类型，如 温度、压力、液位 |
| `comment` | 否 | 字符串 | 注释，默认为 `location` + `type` |
| 限值报警属性 | 否 | — | 见第 4 节 |

只要有 `DB`，就会生成背景 DB 并在 `Alarm_Loop` 中调用；`input`、`invalid`、`enable_XX` 中配置了的项会作为调用参数传入。

`invalid` 在通讯读值时很有用：通讯中断时仪表值保持旧值或为 0，用通讯状态作为 `invalid` 可以避免误报。

## 4. 限值报警

本节内容同样适用于 [AI](guide-AI.zh-cn.md)。

### 4.1 属性

| 属性 | 类型 | 说明 |
|---|---|---|
| `$zero` | 浮点数 | 量程下限初始值，默认 `0.0` |
| `$span` | 浮点数 | 量程上限初始值，默认 `100.0` |
| `$AH_limit` | 浮点数 | 高高报（AH）限值初始值 |
| `$WH_limit` | 浮点数 | 高报（WH）限值初始值 |
| `$WL_limit` | 浮点数 | 低报（WL）限值初始值 |
| `$AL_limit` | 浮点数 | 低低报（AL）限值初始值 |
| `$enable_AH` … `$enable_AL` | 布尔 | 各级报警使能的初始值 |
| `enable_AH` … `enable_AL` | S7符号定义 \| S7符号引用 \| SCL表达式 | 各级报警使能的运行期间赋值 |
| `$dead_zone` | 浮点数 | 报警恢复死区初始值，FB 默认 `0.5` |
| `$FT_time` | TIME \| 整数毫秒 | 容错时间初始值，默认 0（不延时） |

带 `$` 的属性写入背景 DB 的初始值，运行中可由 HMI 修改；`enable_XX` 则每个周期都从指定信号赋值，会覆盖 HMI 的修改。

### 4.2 报警使能

`$enable_XX` 省略（或为 `~`）时，由对应的 `$XX_limit` 决定：配置了限值即启用，没配置即不启用。所以通常只写限值即可：

```yaml
$AH_limit: 12.5    # 启用 AH
$AL_limit: 3.0     # 启用 AL
                   # WH、WL 未配置限值，不启用
```

需要"设定了限值但初始不启用"时，显式写 `$enable_XX: false`：

```yaml
$AL_limit: 0.2
$enable_AL: false
```

反过来，`$enable_XX: true` 却没有配置限值时，报警会使用 FB 中的默认限值，一般不是想要的结果，应避免。

运行期间根据工况切换使能，用不带 `$` 的 `enable_XX`：

```yaml
enable_AL: '"pump1".run_state'   # 泵运行时才启用低低报
```

### 4.3 限值必须有序

已启用的限值必须满足 `AL ≤ WL ≤ WH ≤ AH`。未启用的级别不参与比较。

- 转换时：已配置的 `$XX_limit` 违反该顺序会报错 `定义的限制值有错误`（只看限值是否配置，不看 `$enable_XX`）；
- 运行时：HMI 修改后违反顺序，FB 输出 `SP_error` 并取消所有报警。

### 4.4 报警行为

- **触发**：PV > AH_limit 触发 AH，PV > WH_limit 触发 WH，PV < WL_limit 触发 WL，PV < AL_limit 触发 AL。
- **互斥**：同一时刻最多只有一个报警标志，AH 优先于 WH，AL 优先于 WL。
- **死区**：高报在 PV 回落到 `限值 - dead_zone` 以下才恢复，低报在 PV 回升到 `限值 + dead_zone` 以上才恢复。
- **容错时间**：`FT_time` 不为 0 时，报警条件持续 `FT_time` 才置位报警标志，恢复条件持续 `FT_time` 才复位，用于过滤过程值突变。
- **取消报警**：`invalid` 为真、`SP_error` 为真或四级报警都未启用时，所有报警标志清零。

### 4.5 背景 DB 中常用的输出

| 字段 | 说明 |
|---|---|
| `HH_flag` / `H_flag` / `L_flag` / `LL_flag` | 各级超限标志（对应 GCL 的 AH / WH / WL / AL） |
| `HH_PV` / `H_PV` / `L_PV` / `LL_PV` | 最近一次该级超限时的过程值 |
| `no_limit` | 四级超限判断都未启用 |
| `SP_error` | 限值设置错误 |

alarm 独有的输出：

| 字段 | 说明 |
|---|---|
| `input_ok` | `NOT invalid` |
| `overflow` / `underflow` | PV 超出量程上/下限 2% |

所有字段都带 `S7_m_c` 属性，HMI 可直接访问。例如在联锁中使用：`'"LIT001".HH_flag'`。

## 5. 常见错误

| 报错 / 现象 | 原因 |
|---|---|
| `定义的限制值有错误` | 限值不满足 `AL ≤ WL ≤ WH ≤ AH`（见 4.3） |
| 报警一直不触发 | 限值未配置导致该级未启用；或 `invalid` 一直为真 |
| 运行中所有报警消失 | HMI 修改限值后顺序错误，查看 `SP_error` |
