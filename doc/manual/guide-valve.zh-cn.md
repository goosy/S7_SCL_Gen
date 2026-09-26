# valve 使用指南

valve 控制电动阀门/执行机构：开阀、关阀、停止、按阀位定位，并判断动作是否成功。阀位反馈（AI）是可选的。

- 支持平台：`step7`、`portal`、`pcs7`
- 生成文件：`Valve_Loop.scl`，内含各阀门的背景 DB 和主循环 `Valve_Loop`；另外复制库文件 `Valve_Proc.scl`
- 使用方法：在 OB 中调用 `Valve_Loop`

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/valve.yaml](../../example/valve.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-valve

list:
- comment: 1201A 进口阀
  DB: [MGV-1201A, DB111]
  AI: AI11-01              # 阀位反馈
  CP: DI01-01              # 关到位
  OP: DI01-02              # 开到位
  remote: DI01-04          # 远程
  close_action: DO01-01    # 关阀线圈
  open_action: DO01-02     # 开阀线圈
...
```

HMI 通过写背景 DB 中的 `open_CMD`、`close_CMD`、`stop_CMD`、`position_CMD`（配合 `VP_SP`）控制阀门。

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `Valve_Proc` | `FB513` | 阀门处理 FB |
| `Valve_Loop` | `FC513` | 主循环函数 |

## 3. list 项属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 背景 DB，自动设为 `Valve_Proc` 的背景块；没有 DB 时本项只输出注释 |
| `comment` | 否 | 字符串 | 注释 |

**输入信号**（S7符号定义 \| S7符号引用 \| SCL表达式）：

| 属性 | 类型 | 未配置时 | 说明 |
|---|---|---|---|
| `AI` | WORD | 断线值 `W#16#8000` | 阀位原始值；未配置时阀位无效，定位功能不可用 |
| `CP` | BOOL | `FALSE` | 关到位 |
| `OP` | BOOL | `FALSE` | 开到位 |
| `error` | BOOL | `FALSE` | 阀门故障 |
| `remote` | BOOL | `TRUE` | 远程模式 |

**输出线圈**（S7符号定义 \| S7符号引用，必须可赋值），按现场回路选用：

| 属性 | 说明 |
|---|---|
| `open_action` | 开阀线圈，开阀过程中保持 |
| `close_action` | 关阀线圈，关阀过程中保持 |
| `stop_action` | 停止线圈，用于执行机构自保持的回路 |
| `control_action` | 单线控制：`1` 开阀，`0` 关阀 |

| 现场回路 | 使用的线圈 |
|---|---|
| 2DO：开、关都是得电动作、失电停止 | `open_action` + `close_action` |
| 3DO：开、关信号由执行机构自保持 | `open_action` + `close_action` + `stop_action` |
| 1DO：得电开、失电关 | `control_action` |

**初始值**：

| 属性 | 类型 | FB 默认 | 说明 |
|---|---|---|---|
| `$zero_raw` | 整数 | `0` | 阀位原始零点 |
| `$span_raw` | 整数 | `27648` | 阀位原始满量程 |
| `$overflow_SP` | 整数 | `28000` | 原始值上溢出阈值 |
| `$underflow_SP` | 整数 | `-500` | 原始值下溢出阈值 |
| `$FT_zone` | 浮点数 | `0.5` | 阀位容错区（%），用于定位和动作判断 |
| `$action_time` | TIME \| 整数毫秒 | 100000 | 完成一次开/关动作的最长时间 |
| `$signal_time` | TIME \| 整数毫秒 | 500 | 信号最短保持时间；有阀位时在此之后判断阀门是否动作 |

**必须配置 `CP` 和 `OP`**：到位信号是撤回开/关线圈的依据，缺少时开阀或关阀线圈无法自动撤回。

## 4. 控制逻辑

### 4.1 阀位

阀位 `VP` 固定按 0–100（%）计算：

```
VP = (原始值 - zero_raw) × 100 / (span_raw - zero_raw)
```

原始值为断线值或溢出时，`VP_error` 为真，`VP` 为 `-100.0`。

### 4.2 命令

| 命令 | 作用 |
|---|---|
| `stop_CMD` | 停止，优先级最高 |
| `open_CMD` | 开阀，到达开到位后停止 |
| `close_CMD` | 关阀，到达关到位后停止 |
| `position_CMD` | 按 `VP_SP` 定位，阀位进入 `VP_SP ± FT_zone` 后停止；阀位无效时不可用 |

- `remote` 为假，或 `error` 为真，或 `CP`、`OP` 同时为真（`valve_error`）时，拒绝所有命令，并停止正在进行的动作。
- 动作过程中再次发出同一命令，会停止该动作。

### 4.3 状态与结果

| 输出 | 说明 |
|---|---|
| `VP` / `VP_error` | 阀位及其有效性 |
| `valve_error` | `error` 或 `CP`、`OP` 同时为真 |
| `action` | 正在执行动作 |
| `action_success` / `action_error` | 动作成功/失败；两者都为假表示无法判断 |

- 有阀位时，在 `signal_time` 后根据阀位变化判断动作是否生效，阀位没有朝目标方向变化超过 `FT_zone` 即视为失败；
- 无论有无阀位，开/关/定位动作超过 `action_time` 仍未完成都视为失败；
- 动作成功或失败后，阀门回到停止状态。

## 5. 平台差异

输出线圈在 portal 平台上作为 FB 输出参数（`open_action => ...`），在 step7/pcs7 平台上在调用后从背景 DB 赋值（`"DO01-02" := "MGV-1201A".open_action;`），功能相同。

## 6. 示例

```yaml
list:
# 3DO 回路，无阀位
- comment: B阀门
  DB: [MGV-1201B, DB+]
  CP: DI01-05
  OP: DI01-06
  error: '"DI01-07" AND "DI01-08"'
  close_action: DO02-01
  open_action: DO02-02
  stop_action: DO02-03

# 1DO 回路，有阀位
- comment: C阀门
  DB: [MGV-1201C, DB+]
  AI: AI11-02
  CP: DI02-01
  OP: DI02-02
  control_action: DO02-04
  $FT_zone: 0.8
  $action_time: T#60S
```

## 7. 常见问题

| 现象 | 原因 |
|---|---|
| 命令无反应 | 就地模式、`error` 为真，或 `CP`、`OP` 同时为真 |
| 开/关线圈不撤回 | 没有配置 `OP`/`CP` |
| 定位命令无反应 | 没有配置 `AI`，或阀位无效（`VP_error`） |
| 频繁报 `action_error` | `$action_time`/`$signal_time` 小于执行机构实际动作时间，或 `$FT_zone` 过小 |
