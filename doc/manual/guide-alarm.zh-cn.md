# alarm 使用指南

alarm（别名 `pv`、`pv_alarm`、`pvalarm`）对一个 REAL 类型的过程值做四级超限判断。适用于不是来自 AI 通道的数值，例如通过 485/Modbus 读到的仪表值。

AI 通道请用 [AI](guide-AI.zh-cn.md)，它在同样的超限判断功能之外还负责原始值到工程值的转换。

- 支持平台：`step7`、`portal`、`pcs7`
- 生成文件：`Alarm_Loop.scl`，内含各项的背景 DB 和主循环 `Alarm_Loop`；另外复制库文件 `Alarm_Proc.scl`
- 使用方法：在 OB 中调用 `Alarm_Loop`，建议放在循环中断 OB（如 OB30、OB35）中。

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
  $HH_limit: 12.5
  $LL_limit: 3.0
...
```

生成的调用：`"Alarm_Proc"."LIT001"(PV := "tank485".LIT001);`

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `Alarm_Proc` | `FB519` | 超限判断 FB |
| `Alarm_Loop` | `FC519` | 主循环函数 |

## 3. list 项属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 背景 DB，自动设为 `Alarm_Proc` 的背景块；没有 DB 时本项只输出注释 |
| `input` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 过程值，REAL |
| `invalid` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 过程值无效标志，BOOL；为真时取消所有超限判断 |
| `location` | 否 | 字符串 | 仪表位置 |
| `type` | 否 | 字符串 | 仪表类型，如 温度、压力、液位 |
| `comment` | 否 | 字符串 | 注释，默认为 `location` + `type` |
| 超限判断属性 | 否 | — | 见第 4 节 |

`invalid` 在通讯读值时很有用：通讯中断时仪表值保持旧值或为 0，用通讯状态作为 `invalid` 可以避免误判。

### 3.1 生成规则

| 配置 | 背景 DB | `Alarm_Loop` 中的调用 |
|---|---|---|
| 有 `DB` | 生成 | 生成；`input`、`invalid`、`enable_XX` 中配置了的项作为调用参数传入 |
| 没有 `DB` | 不生成 | 不生成，只输出注释 |

## 4. 超限判断

本节内容同样适用于 [AI](guide-AI.zh-cn.md)。

### 4.1 属性

| 属性 | 类型 | 说明 |
|---|---|---|
| `$zero` | 浮点数 | 量程下限初始值，默认 `0.0` |
| `$span` | 浮点数 | 量程上限初始值，默认 `100.0` |
| `$HH_limit` | 浮点数 | 高高限（HH）初始值 |
| `$H_limit` | 浮点数 | 高限（H）初始值 |
| `$L_limit` | 浮点数 | 低限（L）初始值 |
| `$LL_limit` | 浮点数 | 低低限（LL）初始值 |
| `$enable_HH` … `$enable_LL` | 布尔 | 各级超限判断使能的初始值 |
| `enable_HH` … `enable_LL` | S7符号定义 \| S7符号引用 \| SCL表达式 | 各级超限判断使能的运行期间赋值 |
| `$dead_zone` | 浮点数 | 超限恢复死区初始值，FB 默认 `0.5` |
| `$FT_time` | TIME \| 整数毫秒 | 容错时间初始值，默认 0（不延时） |
| `$enable_AH` / `$enable_WH` / `$enable_WL` / `$enable_AL` | 布尔 | HH / H / L / LL 超限时上位机是否报警，默认 `true`；只供 rules 提取（如生成 WinCC 报警列表），不写入背景 DB |

除 `$enable_AH` … `$enable_AL` 外，带 `$` 的属性写入背景 DB 的初始值，运行中可由 HMI 修改；`enable_XX` 则每个周期都从指定信号赋值，会覆盖 HMI 的修改。

### 4.2 超限判断使能

`$enable_XX` 省略（或为 `~`）时，由对应的 `$XX_limit` 决定：配置了限值即启用，没配置即不启用。所以通常只写限值即可：

```yaml
$HH_limit: 12.5    # 启用 HH
$LL_limit: 3.0     # 启用 LL
                   # H、L 未配置限值，不启用
```

需要"设定了限值但初始不启用"时，显式写 `$enable_XX: false`：

```yaml
$LL_limit: 0.2
$enable_LL: false
```

反过来，`$enable_XX: true` 却没有配置限值时，超限判断会使用 FB 中的默认限值，一般不是想要的结果，应避免。

运行期间根据工况切换使能，用不带 `$` 的 `enable_XX`：

```yaml
enable_LL: '"pump1".run_state'   # 泵运行时才启用低低超限判断
```

### 4.3 限值必须有序

已启用的限值必须满足 `LL ≤ L ≤ H ≤ HH`。未启用的级别不参与比较。

- 转换时：已配置的 `$XX_limit` 违反该顺序会报错 `定义的限制值有错误`（只看限值是否配置，不看 `$enable_XX`）；
- 运行时：HMI 修改后违反顺序，FB 输出 `SP_error` 并取消所有超限判断。

### 4.4 超限判断行为

- **触发**：PV > HH_limit 触发 HH，PV > H_limit 触发 H，PV < L_limit 触发 L，PV < LL_limit 触发 LL。
- **互斥**：同一时刻最多只有一个超限标志，HH 优先于 H，LL 优先于 L。
- **死区**：高侧超限在 PV 回落到 `限值 - dead_zone` 以下才恢复，低侧超限在 PV 回升到 `限值 + dead_zone` 以上才恢复。
- **容错时间**：`FT_time` 不为 0 时，超限条件持续 `FT_time` 才置位超限标志，恢复条件持续 `FT_time` 才复位，用于过滤过程值突变。
- **取消超限判断**：`invalid` 为真、`SP_error` 为真或四级超限判断都未启用时，所有超限标志清零。

### 4.5 背景 DB 中常用的输出

| 字段 | 说明 |
|---|---|
| `HH_flag` / `H_flag` / `L_flag` / `LL_flag` | 各级超限标志（对应 GCL 的 HH / H / L / LL） |
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
| `定义的限制值有错误` | 限值不满足 `LL ≤ L ≤ H ≤ HH`（见 4.3） |
| 超限标志一直不置位 | 限值未配置导致该级未启用；或 `invalid` 一直为真 |
| 运行中所有超限标志消失 | HMI 修改限值后顺序错误，查看 `SP_error` |
