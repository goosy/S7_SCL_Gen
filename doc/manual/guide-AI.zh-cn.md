# AI 使用指南

AI 处理模拟量输入通道：把模块原始值线性转换为工程值，检测断线/溢出，并做四级超限判断。

- 支持平台：`step7`、`portal`、`pcs7`
- 生成文件：`AI_Loop.scl`，内含各通道的背景 DB 和主循环 `AI_Loop`；另外复制库文件 `AI_Proc.scl`
- 使用方法：在 OB 中调用 `AI_Loop`，建议放在循环中断 OB（如 OB30、OB35）中。

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/AI.yaml](../../example/AI.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-AI

list:
- location: 来油入口
  type: 压力
  DB: [PIT001, DB100]
  input: [AI01-02, PIW514]
  $span: 2.0
  $HH_limit: 1.8
  $LL_limit: 0.1
...
```

生成的调用：`"AI_Proc"."PIT001"(AI := "AI01-02");`，工程值在 `"PIT001".PV` 中。

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `AI_Proc` | `FB512` | 模拟量处理 FB |
| `AI_Loop` | `FC512` | 主循环函数 |

## 3. list 项属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 背景 DB，自动设为 `AI_Proc` 的背景块；没有 DB 时本项只输出注释 |
| `input` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 通道原始值，WORD，通常是 `PIW` 地址 |
| `location` | 否 | 字符串 | 仪表位置 |
| `type` | 否 | 字符串 | 仪表类型，如 温度、压力、液位 |
| `comment` | 否 | 字符串 | 注释，默认为 `location` + `type` |
| `$zero_raw` | 否 | 整数 | 原始零点（4mA 对应值），FB 默认 `0` |
| `$span_raw` | 否 | 整数 | 原始满量程（20mA 对应值），FB 默认 `27648` |
| `$overflow_SP` | 否 | 整数 | 原始值上溢出阈值，FB 默认 `28000` |
| `$underflow_SP` | 否 | 整数 | 原始值下溢出阈值，FB 默认 `-500` |
| 超限判断属性 | 否 | — | `$zero`、`$span`、`$XX_limit`、`$enable_XX`、`enable_XX`、`$dead_zone`、`$FT_time`，见 [alarm 指南第 4 节](guide-alarm.zh-cn.md#4-超限判断)；限值须满足 `LL ≤ L ≤ H ≤ HH`，见 [alarm 指南 4.3](guide-alarm.zh-cn.md#43-限值必须有序) |

`input` 不一定是 PIW，也可以是 M 区或通讯 DB 中的原始计数值：

```yaml
input: [M485-1, MW100]
input: '"RecvDB".Tank1'
```

### 3.1 生成规则

| 配置 | 背景 DB | `AI_Loop` 中的调用 |
|---|---|---|
| 有 `DB`，有 `input` 或任一 `enable_XX` | 生成 | 生成 |
| 有 `DB`，没有 `input` 和 `enable_XX` | 生成 | 不生成，只输出注释（可用于占位或由其它程序调用） |
| 没有 `DB` | 不生成 | 不生成，只输出注释 |

## 4. 转换与有效性

工程值计算：

```
PV = (原始值 - zero_raw) × (span - zero) / (span_raw - zero_raw) + zero
```

原始值异常时 `PV` 输出 `invalid_value`（默认 `-1000000.0`），并取消所有超限判断：

| 输出 | 条件 |
|---|---|
| `AI_error` | 原始值为 `32767` 或 `-32768`（断线等非测量值） |
| `overflow` | 原始值 > `overflow_SP` |
| `underflow` | 原始值 < `underflow_SP` |
| `invalid` | 以上任一 |

非标准信号可调整原始范围，例如：

```yaml
$zero_raw: 0
$span_raw: 27648
$overflow_SP: 28000
$underflow_SP: -500
```

## 5. 背景 DB 中常用的字段

| 字段 | 说明 |
|---|---|
| `PV` | 工程值 |
| `HH_flag` / `H_flag` / `L_flag` / `LL_flag` | 各级超限标志（对应 GCL 的 HH / H / L / LL） |
| `invalid` / `AI_error` / `overflow` / `underflow` | 见第 4 节 |
| `SP_error` | 限值设置错误 |
| `HH_PV` / `H_PV` / `L_PV` / `LL_PV` | 最近一次该级超限时的工程值 |

所有字段都带 `S7_m_c` 属性。在其它配置中引用示例：`'"PIT001".PV > 1.5'`、`'"PIT001".HH_flag'`。

## 6. 示例：复用参数与运行期间使能

```yaml
template:
- &tubepress
  $zero: -0.2
  $span: 2.6
  $HH_limit: 2.5
  $H_limit: 2.0
  $L_limit: -0.05
  $LL_limit: -0.1
  $dead_zone: 0.01

list:
- location: 泵进口
  type: 压力
  DB: [PIT002, DB101]
  input: [AI01-01, PIW512]
  $LL_limit: ~            # 去掉锚点中的 LL
  <<: *tubepress

- location: 泵进口
  type: 温度
  DB: [TIT001, DB+]
  input: [AI01-03, PIW516]
  $zero: -40.0
  $span: 80.0
  $LL_limit: 25.0
  enable_LL: '"pump1".run_state'   # 泵运行时才启用低低超限判断
  $FT_time: T#3M
```

## 7. 常见错误

| 报错 / 现象 | 原因 |
|---|---|
| `定义的限制值有错误` | 限值不满足 `LL ≤ L ≤ H ≤ HH`（见 [alarm 指南 4.3](guide-alarm.zh-cn.md#43-限值必须有序)） |
| `PV` 为 `-1000000.0` | 通道断线或原始值溢出，查看 `AI_error`/`overflow`/`underflow` |
| 工程值比例不对 | 模块量程与 `$zero_raw`/`$span_raw` 不匹配 |
| DB 已生成但数值不刷新 | 没有配置 `input`，`AI_Loop` 中不会调用该通道 |
