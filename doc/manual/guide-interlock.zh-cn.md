# interlock 使用指南

interlock（别名 `IL`）根据一组输入信号的状态触发联锁输出，可用于报警、联锁停机、事件触发等场景。

- 支持平台：`step7`、`portal`（不支持 `pcs7`）
- 生成文件：`Interlock_Loop.scl`，内含所有联锁 DB 块和主循环函数 `Interlock_Loop`
- 使用方法：在某个 OB（通常是 OB1 或循环中断 OB）中调用 `Interlock_Loop`

通用指令见 [GCL 配置基础](guide-gcl.zh-cn.md)；完整示例见 [example/interlock.yaml](../../example/interlock.yaml)。

## 1. 最小示例

```yaml
---
name: AS1-interlock

symbols:
- [DI02-17, I6.0]
- [DI02-18, I6.1]
- [DO04-01, Q6.0]

list:
- comment: 声光报警
  DB: [IL_ESDBTN, DB121]
  data:
  - test                                    # HMI 测试
  - reset                                   # HMI 复位
  - {name: EBTN, read: DI02-17, comment: 人工报警按钮}
  - {name: GIA001, read: DI02-18, comment: 可燃气报警}
  - {name: SL, write: DO04-01, comment: 声光报警DO}
  input:    # 任一信号的上升沿触发联锁
  - test
  - EBTN
  - GIA001
  reset:    # 复位联锁
  - reset
  output:   # 联锁动作
  - SL
...
```

效果：`EBTN`、`GIA001` 或 `test` 任一出现上升沿时，`SL` 置位（锁存）并输出到 `DO04-01`，直到 HMI 写 `reset` 才复位。

## 2. 文档级指令

| 指令 | 说明 |
|---|---|
| `name` | `<CPU>-interlock` 或 `<CPU>-IL`，也可分写为 `CPU` + `feature` |
| `symbols` | 自定义符号；也可在此重定义内置符号的地址 |
| `includes` | 插入到生成文件顶部的 SCL 源码 |
| `list` | 联锁组列表，见第 3 节 |
| `loop_begin` | 插入到 `Interlock_Loop` 函数开头的 SCL 代码 |
| `loop_end` | 插入到 `Interlock_Loop` 函数末尾的 SCL 代码 |
| `options.output_file` | 修改输出文件名，默认 `Interlock_Loop.scl` |

内置符号：

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `Interlock_Loop` | `FC518` | 联锁主循环函数 |

地址冲突时，在 `symbols` 中以相同名称重新定义即可，例如 `- [Interlock_Loop, FC600]`。

## 3. 联锁组（list 项）

`list` 的每一项是一个**联锁组**：若干输入 → 一个联锁动作 → 若干输出。

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 本组使用的 DB 块，多组可共用一个 DB（见第 9 节） |
| `comment` | 否 | 字符串 | 本组注释，默认"报警联锁" |
| `enable` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 运行时使能信号来源，见第 8 节 |
| `$enable` | 否 | 布尔 | 使能的初始值，默认 `true` |
| `data` | 否 | 数组 | 中转数据项，见第 5 节 |
| `input` | 是 | 数组（至少 1 项） | 触发联锁的输入，见第 6 节 |
| `reset` | 否 | 数组 | 复位整组输出的条件，见第 7 节 |
| `output` | 否 | 数组 | 联锁输出，见第 7 节 |
| `extra_code` | 否 | 字符串 | 附加在本组逻辑之后的 SCL 代码，见第 10 节 |

DB 块的注释取自符号定义的第 4 项；未提供时取该 DB 第一个联锁组的 `comment`。

## 4. 值的四种写法

`input`、`reset`、`output` 中凡是需要"一个布尔值"的地方，都可以用以下四种写法：

| 写法 | 示例 | 生成的 SCL |
|---|---|---|
| data 项名称 | `EBTN` | `"IL_ESDBTN".EBTN` |
| S7 符号引用 | `DI02-11` | `"DI02-11"` |
| S7 符号定义 | `[DI02-14, I5.5]` | `"DI02-14"`（同时定义该符号） |
| SCL 表达式 | `'"PIT-1201".AH_Flag'` | `"PIT-1201".AH_Flag` |

判定顺序：先查本 DB 的 data 项名称，再查已定义的符号，都不匹配时**原样**作为 SCL 表达式输出。

注意：

- **在 SCL 表达式内部不能直接写 data 项名称或符号名**，必须写成完整的 SCL 地址。
  例如要引用 data 项 `WCS_work`，应写 `'"IL_pump".WCS_work XOR MOT0101.run'`，而不是 `'WCS_work XOR ...'`。
- **拼写错误或未定义的符号不会报错**，而是被原样当作 SCL 表达式输出。
  例如 `DI02-12` 没有在任何地方定义时，会生成不带引号的 `DI02-12`，直到在 Step 7 中编译才会报错。
- 表达式中含有双引号时，整个值要用单引号包起来（YAML 规则）。

## 5. data 中转数据项

data 项是 DB 块中的一个字段。和 input/reset/output 相比，它有以下特点：

1. **一定存在于 DB 中**，并自动带 `S7_m_c` 属性，HMI/OS 可以直接读写；
2. 可以从过程值**读入**（`read`），也可以**写出**到过程值（`write`）；
3. 可以在 input、reset、output 中直接用名称引用。

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `name` | 是 | 字符串 | DB 中的字段名 |
| `read` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 每个周期开始时读入本字段 |
| `write` | 否 | S7符号定义 \| S7符号引用 | 每个周期结束时把本字段写出（必须是可赋值地址） |
| `type` | 否 | S7 基本类型 | 默认 `BOOL`；不是基本类型时按 `BOOL` 处理 |
| `comment` | 否 | 字符串 | 字段注释 |

只写名称时可以简写：`- reset` 等效于 `- {name: reset}`。

常用约定：

| data 项 | 用途 |
|---|---|
| `test` | 放进 `input`，HMI 置位即可测试联锁 |
| `reset` | 放进 `reset`，HMI 置位即可复位联锁 |
| `output` | 放进 `output`，供 HMI 读取联锁状态 |

被用作复位条件（组级 `reset` 或输出项的单独 `reset`）、且没有 `read` 属性的 data 项，会在每个周期末尾**自动清零**。因此 HMI 只需写一次 `TRUE`，效果相当于一个脉冲按钮。

## 6. input 输入

所有输入项的触发结果做 **OR** 运算：任一项触发，联锁即动作。

简写形式（只写值，触发类型默认为 `rising`）：

```yaml
input:
- test                       # data 项名称
- DI02-11                    # 符号引用
- [DI02-14, I5.5]            # 符号定义
- '"PIT-1201".AH_Flag'       # SCL 表达式
```

完整形式：

| 属性 | 必填 | 说明 |
|---|---|---|
| `value` | 与 `and` 二选一 | 输入值，四种写法见第 4 节 |
| `and` | 与 `value` 二选一 | 数组，各项做 AND 运算后作为输入值 |
| `trigger` | 否 | 触发类型，默认 `rising` |
| `comment` | 否 | 注释 |

触发类型：

| `trigger` | 含义 | 触发条件 |
|---|---|---|
| `rising` | 上升沿（默认） | 值由 0 变 1 的那个周期 |
| `falling` | 下降沿 | 值由 1 变 0 的那个周期 |
| `change` | 变化 | 值发生变化的那个周期 |
| `on` | 接通 | 值为 1 期间每个周期都触发 |
| `off` | 断开 | 值为 0 期间每个周期都触发 |

示例：

```yaml
input:
- value: lubrication_work     # 润滑停止时触发
  trigger: falling
- value: PowerReady           # 高压失电期间持续触发
  trigger: off
- and:                        # 两个罐液位都低时触发
  - LIT0205A.AL_flag
  - LIT0205B.AL_flag
```

边沿类（`rising`/`falling`/`change`）输入会在 DB 中生成追随变量 `b_<n>_fo`，其中 `<n>` 是该项在本 DB 输入中的序号。

## 7. reset 与 output

### 7.1 联锁输出是锁存的

输入触发后，输出被**置位并保持**。输入消失并不会让输出复位，只有以下情况会：

1. 组级 `reset` 中任一项为真：复位本组**所有**输出；
2. 输出项自己的 `reset` 为真：只复位**该**输出；
3. 使能为假：所有输出置为默认值。

如果一个联锁组既没有组级 `reset`，输出项也没有单独的 `reset`，那么输出一旦置位，只有关闭使能才能复位。

### 7.2 reset 组级复位

数组，每项是一个布尔值（四种写法见第 4 节），各项做 OR 运算。

```yaml
reset:
- reset              # data 项，HMI 复位
- DI02-13            # 现场复位按钮
- Alarm_SL.reset     # SCL 表达式
```

**复位优先**：复位信号为真的周期内不处理输入，因此按住复位按钮期间，联锁不会被触发。

### 7.3 output 输出

简写形式（只写值）：

```yaml
output:
- output             # data 项
- SL                 # data 项（带 write，会写到 DO）
- DO04-02            # 直接写符号
```

完整形式：

| 属性 | 必填 | 说明 |
|---|---|---|
| `value` | 是 | 输出目标，必须是**可赋值**的地址 |
| `reset` | 否 | 本输出的单独复位条件 |
| `inversion` | 否 | 反相输出，默认 `false` |
| `default` | 否 | 使能为假时的输出值，默认为复位值 |
| `comment` | 否 | 注释 |

`value` 必须可赋值，转换器不做这项检查：

| 正确 | 错误 |
|---|---|
| `DO04-02` | `DI02-12`（输入点） |
| `AFan_1204A.start_CMD` | `'NOT AFan_1204A.run'`（表达式） |

唯一的例外是带 `read` 属性的 data 项，把它用作输出时转换器会报错。

**单独复位 `reset`**：写法与组级复位相同，另外可以使用特殊变量 `inputs`，表示"本周期至少有一个输入触发"。

```yaml
output:
- value: [DO04-02, Q6.1]     # 停泵线圈
  reset: stop                # 泵已停止后撤销停泵命令
- value: IL_ESDBTN.test
  reset: NOT inputs          # 输入全部消失后自动复位
```

`NOT inputs` 适合"提醒类"输出：它跟随输入状态，不需要等总复位。注意边沿类输入只在一个周期内为真，所以如果输入全部是边沿触发，`NOT inputs` 几乎会立即复位输出，这时应配合 `on`/`off` 类型的输入使用。

**反相 `inversion`**：置位时输出 `FALSE`，复位时输出 `TRUE`。使能为假时默认输出复位值 `TRUE`，可用 `default: false` 改变：

```yaml
output:
- value: stop
  inversion: true    # 联锁动作时断开
  default: false     # 未使能时也断开
```

## 8. 使能 enable

每个 DB 有一个 `enable` 字段（带 `S7_m_c`），为假时该 DB 下所有联锁组停止工作，输出置为默认值。

| 指令 | 作用 |
|---|---|
| `$enable: false` | 设定 `enable` 字段的**初始值**，HMI 可修改 |
| `enable: <信号>` | 每个周期从该信号**读入** `enable`，此时 HMI 的修改会被覆盖 |

例如 `enable: '"IL_ESDBTN".enable'` 可以让本 DB 跟随另一个联锁 DB 的使能状态。

一个 DB 的 `enable` 和 `$enable` 各自最多只能在一个联锁组上设置，重复设置会报错。

## 9. 多组联锁共用 DB

多个 list 项的 `DB` 指向同一个符号时，它们共用一个 DB 块：

- 第一次出现时写符号定义 `[IL_sound, DB123]`，之后只写引用 `IL_sound`；
- 共享同一个 `enable`；
- **共享同一个 data 命名空间**：每组的 data 项都可以在所有组中引用；
- 所有组的 data 项名称不能重复，也不能与 `enable` 重名，否则报错。

```yaml
list:
- DB: [IL_sound, DB123, ~, 事件播报]
  $enable: false
  data:
  - {name: play, write: DO04-04}
  - {name: stop, write: DO04-06}
  - {name: RSTSWT, read: DI02-19}
  input: [...]
  output: [play]

- DB: IL_sound            # 共用上面的 DB
  input: [RSTSWT]
  output: [stop]
```

## 10. 自定义代码

| 位置 | 指令 | 插入点 |
|---|---|---|
| 联锁组 | `extra_code` | 该组联锁逻辑之后、下一组之前 |
| 文档 | `loop_begin` | `Interlock_Loop` 开头 |
| 文档 | `loop_end` | `Interlock_Loop` 末尾 |

这些代码原样插入，转换器不做检查。

## 11. 生成的代码

### 11.1 DB 结构

```
enable        BOOL := TRUE   S7_m_c   使能
<data_1>      <type>         S7_m_c   data 项，按定义顺序
...
b_<n>_fo      BOOL                    边沿追随变量，每个边沿类输入一个
...
```

只有 data 项和 `enable` 是 DB 字段；input/reset/output 中直接写的符号和表达式不会生成字段。

### 11.2 每个周期的执行顺序

对每个 DB 依次执行：

1. 读入：执行所有带 `read` 的 data 项（包括 `enable`）
2. 对该 DB 的每个联锁组：
   1. 计算组级复位 `reset`
   2. 未使能 → 输出置默认值；
      否则若复位 → 输出置复位值；
      否则 → 计算输入 OR 结果，若触发则置位输出，再逐个检查输出项的单独复位
   3. 更新边沿追随变量
   4. 执行 `extra_code`
3. 清零被用作复位条件、且没有 `read` 的 data 项
4. 写出：执行所有带 `write` 的 data 项

完整的生成结果可参考 [example/SCL_AS1_step7_CPU410-5H/Interlock_Loop.scl](../../example/SCL_AS1_step7_CPU410-5H/Interlock_Loop.scl)。

## 12. 常见错误

| 报错 / 现象 | 原因 |
|---|---|
| `interlock转换必须有DB块!` | list 项缺少 `DB` |
| `interlock的input_list必须有1项以上!` | `input` 缺失或为空（共用 DB 的每一组也需要） |
| `interlock 项属性 name:xxx 重复定义或已保留!` | 同一 DB 下 data 项重名，或与 `enable` 重名 |
| `enable 重复定义!` / `$enable 重复定义!` | 共用 DB 时多个组都设置了使能 |
| `interlock 的 output 项不能有 read 属性!` | 把带 `read` 的 data 项用作输出 |
| 生成的 SCL 中出现不带引号的名称 | 符号名拼写错误或未定义，被当作了 SCL 表达式（见第 4 节） |
| 联锁动作后输出一直不消失 | 输出是锁存的，需要配置 `reset`（见 7.1） |
