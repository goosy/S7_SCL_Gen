# motor 使用指南

motor 实现电机的启动、停止、急停控制和状态监视。

- 支持平台：`step7`、`portal`
- 生成文件：`Motor_Loop.scl`，内含各电机的背景 DB 和主循环 `Motor_Loop`；另外复制库文件 `Motor_Proc.scl`
- 使用方法：在 OB 中调用 `Motor_Loop`

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/motor.yaml](../../example/motor.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-motor

list:
- comment: 1#外输泵
  DB: [PUMP-001A, DB91]
  enable: DI05-01        # 允许启动
  run: DI05-02           # 运行状态
  error: DI05-03         # 故障
  remote: DI05-04        # 远程
  start_action: DO05-01  # 启动线圈
  stop_action: DO05-02   # 停止线圈
...
```

HMI 通过写背景 DB 中的 `start_CMD`、`stop_CMD`、`E_stop_CMD` 控制电机。

## 2. 内置符号

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `Motor_Proc` | `FB514` | 电机处理 FB |
| `Motor_Loop` | `FC514` | 主循环函数 |

## 3. list 项属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 背景 DB，自动设为 `Motor_Proc` 的背景块；没有 DB 时本项只输出注释 |
| `comment` | 否 | 字符串 | 注释 |

**输入信号**（S7符号定义 \| S7符号引用 \| SCL表达式，BOOL）：

| 属性 | FB 参数 | 未配置时 | 说明 |
|---|---|---|---|
| `enable` | `enable_run` | `TRUE` | 允许启动，如已蓄能、高压到位 |
| `run` | `run` | `FALSE` | 运行状态反馈 |
| `error` | `error` | `FALSE` | 电机故障 |
| `remote` | `remote` | `TRUE` | 远程模式；就地时禁止启动和正常停止，急停不受限制 |

**输出线圈**（S7符号定义 \| S7符号引用，必须可赋值）：

| 属性 | FB 输出 | 说明 |
|---|---|---|
| `run_action` | `run_coil` | 运行输出，启动后保持，停止时撤回。用于**无自保持**的控制回路 |
| `start_action` | `start_coil` | 启动脉冲，电机运行或超时后撤回。用于**有自保持**的控制回路 |
| `stop_action` | `stop_coil` | 停止脉冲，电机停止或超时后撤回 |
| `estop_action` | `E_stop_coil` | 急停脉冲 |

根据现场控制回路选择线圈：无自保持回路只需 `run_action`；有自保持回路用 `start_action` + `stop_action`。

**初始值**：

| 属性 | 类型 | 说明 |
|---|---|---|
| `$stateless` | 布尔 | 无运行状态反馈的电机设为 `true`，默认 `false` |
| `$over_time` | TIME \| 整数毫秒 | 等待电机状态变化的超时时间，FB 默认 5000 毫秒 |

未配置的输入参数不会传给 FB，FB 使用背景 DB 中的值。**此时必须保证这些值在运行中不会被其它程序改变**；如果担心被改，可以显式写 `enable: true`、`remote: true`、`error: false`。

## 4. 控制逻辑

### 4.1 命令

HMI 写入背景 DB 中的命令位，FB 在执行后自动清除：

| 命令 | 作用 | 优先级 |
|---|---|---|
| `E_stop_CMD` | 急停 | 最高，不受 `remote`、`error` 限制 |
| `stop_CMD` | 停止 | 高于启动 |
| `start_CMD` | 启动 | |

以下情况下命令被拒绝（并被清除）：

- `start_CMD`：`enable` 为假，或就地，或故障；
- `stop_CMD`：就地，或故障。

### 4.2 状态 state

| 值 | 状态 | 说明 |
|---|---|---|
| 0 | UNKNOWN | 无状态反馈，或无状态电机 |
| 1 | STOPED | 已停止 |
| 2 | STARTING | 启动中，`start_coil` 输出 |
| 4 | RUNNING | 运行中 |
| 8 | STOPPING | 停止中，`stop_coil` 或 `E_stop_coil` 输出 |
| 16 | START_FAILURE | 启动超时 |
| 32 | STOP_FAILURE | 停止超时 |

启动/停止中超过 `over_time` 仍未收到对应的运行状态时，撤回线圈并进入失败状态。无状态电机（`$stateless: true`）不判断 `run`，超时后回到 UNKNOWN。

## 5. 平台差异

输出线圈的赋值方式因平台而异，功能相同：

```
// portal：线圈作为 FB 输出参数
"PUMP-001A"(remote := "DI05-04", ..., start_coil => "DO05-01");

// step7：调用后从背景 DB 赋值
"Motor_Proc"."PUMP-001A"(remote := "DI05-04", ...);
"DO05-01" := "PUMP-001A".start_coil;
```

## 6. 示例：三种典型配置

```yaml
list:
# 有自保持回路，信号齐全
- comment: B电机
  DB: [PUMP-001B, DB+]
  enable: DI05-05
  run: DI05-06
  error: DI05-07
  remote: DI05-08
  start_action: DO05-05
  stop_action: DO05-06

# 无自保持回路
- comment: 风机
  DB: [FAN-001, DB+]
  run: DI06-01
  run_action: DO06-01

# 无状态反馈
- comment: C电机
  DB: [PUMP-001C, DB+]
  $stateless: true
  run_action: DO05-08
```

## 7. 常见问题

| 现象 | 原因 |
|---|---|
| HMI 启动无反应 | `enable` 为假、就地模式或故障 |
| 状态停在 START_FAILURE | `over_time` 内没有收到 `run` 反馈；检查反馈信号或加大 `$over_time` |
| 状态一直是 UNKNOWN | 没有配置 `run`，或设置了 `$stateless: true` |
