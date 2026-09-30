# AO 使用指南

AO 把工程单位值线性转换为 AO 模块通道的原始值，常用于变频器频率给定、调节阀开度给定等模拟量输出。

- 支持平台：`step7`、`portal`、`pcs7`
- 生成文件：`AO_Loop.scl`，内含各 AO 的背景 DB 与主循环 `AO_Loop`。另外复制库文件 `AO_Proc.scl`
- 使用方法：在 OB 中调用 `AO_Loop`

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/AO.yaml](../../example/AO.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-AO

list:
- comment: 1#外输泵频率控制
  DB: [SC-0101, DB601]
  output: [AO01-01, PQW512]   # AO 模块通道
  $zero: 0.0
  $span: 50.0                 # 0~50Hz 对应 0~27648
...
```

没有配置 `PV`，频率给定由 HMI 直接写背景 DB 的 `PV`。

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `AO_Proc` | `FB515` | 模拟量输出 FB |
| `AO_Loop` | `FC515` | 主循环函数 |

## 3. list 项属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 背景 DB，自动设为 `AO_Proc` 的背景块。没有 `DB` 的项被忽略 |
| `PV` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 要输出的工程值，REAL。每周期赋给背景 DB 的 `PV` |
| `$PV` | 否 | 实数 | 背景 DB 中 `PV` 的初值，默认等于 `$zero` |
| `$zero` | 否 | 实数 | 原始值 0 对应的工程值，默认 `0.0` |
| `$span` | 否 | 实数 | 原始值 27648 对应的工程值，默认 `100.0` |
| `$overflow_SP` | 否 | 整数 \| 百分比字符串 | 限幅上限，通道原始值，默认 `28000` |
| `$underflow_SP` | 否 | 整数 \| 百分比字符串 | 限幅下限，通道原始值，默认 `-500` |
| `output` | 否 | S7符号定义 \| S7符号引用 \| 单个变量 | 输出目标，WORD，必须可赋值，通常是 AO 模块通道 |
| `extra_code` | 否 | 字符串 | 附加 SCL 代码，见第 5 节 |
| `comment` | 否 | 字符串 | 注释 |

- `PV` 未配置时，由 HMI 直接写背景 DB 的 `PV`。
- `output` 未配置时，原始值留在背景 DB 的 `AO` 字段，由其它程序取用。
- `$span` 小于 `$zero` 即为反向输出：`zero` 永远对应 0，`span` 永远对应 27648。
- `$overflow_SP`/`$underflow_SP` 可写整数原始值，如 `28000`；也可写百分比字符串，以 27648 为 100%，四舍五入换算为原始值，如 `105%` 即 `29030`、`-5%` 即 `-1382`。
- 取值必须在 -6912（0 mA）~ 32511 之内，因为 AO_Proc 只支持 4~20mA 输出；且上限必须大于下限。输出超出上下限时被限幅并置 `overflow`/`underflow`。
- 上限低于 27648 或下限高于 0 可把输出限制在量程之内，例如 `$overflow_SP: 90%`、`$underflow_SP: 10%` 把输出限制在 10% ~ 90%。

## 4. 背景 DB 中的字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `PV` | REAL | 要输出的工程值 |
| `zero` | REAL | 原始值 0 对应的工程值 |
| `span` | REAL | 原始值 27648 对应的工程值 |
| `overflow_SP` | INT | 限幅上限，通道原始值 |
| `underflow_SP` | INT | 限幅下限，通道原始值 |
| `AO` | WORD | 转换后的原始值 |
| `overflow` | BOOL | 超出上限，已限幅 |
| `underflow` | BOOL | 低于下限，已限幅 |
| `invalid` | BOOL | 量程错误（`zero = span`）或 `overflow` 或 `underflow` |

## 5. 生成顺序与 extra_code

每个 AO 在 `AO_Loop` 中按以下顺序生成，未配置的步骤省略：

1. `<DB>.PV := <PV>;`
2. `extra_code`
3. 调用 `AO_Proc`
4. `<output> := <DB>.AO;`

`extra_code` 在调用 FB 之前，可以改写 `PV` 且本周期生效。例如就地时让频率给定跟随实际频率，切回远程时无扰：

```yaml
- comment: 1#外输泵频率控制
  DB: [SC-0101, DB601]
  output: [AO01-01, PQW512]
  $zero: 0.0
  $span: 50.0
  extra_code: |-
    IF NOT "Pump1".remote THEN // 就地时频率跟随
      "SC-0101".PV := "SIT-0101".PV;
    END_IF;
```

生成：

```
// 1#外输泵频率控制
IF NOT "Pump1".remote THEN // 就地时频率跟随
  "SC-0101".PV := "SIT-0101".PV;
END_IF;
"AO_Proc"."SC-0101"();
"AO01-01" := "SC-0101".AO;
```

portal 平台的调用写作 `"SC-0101"();`。

## 6. 常见错误

| 报错 / 现象 | 原因 |
|---|---|
| `output "..." 必须是可赋值的 WORD 变量` | `output` 写成了常量或表达式 |
| `zero 与 span 不能相等` | `$zero` 与 `$span`（省略时为 0.0 与 100.0）相等，量程无效 |
| `... 必须是整数原始值或百分比字符串` | `$overflow_SP`/`$underflow_SP` 写成了小数、不带 `%` 的字符串或格式错误的百分比 |
| `... 超出输出范围 -6912 ~ 32511` | `$overflow_SP`/`$underflow_SP` 换算后的原始值超出输出范围 |
| `限幅上限 ... 必须大于下限` | `$overflow_SP`、`$underflow_SP`（省略时为 28000 与 -500）的上限不大于下限 |
| 警告 `$PV 超出限幅范围，会被限幅` | `$PV` 初值超出限幅范围，运行时会被限幅并置 `overflow`/`underflow` |
| 输出停在上限或下限，`overflow`/`underflow` 为真 | `PV` 超出限幅范围，或 `$zero`/`$span` 方向写反 |
