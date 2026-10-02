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
| `list` | 联锁 DB 列表，见第 3 节 |
| `loop_begin` | 插入到 `Interlock_Loop` 函数开头的 SCL 代码 |
| `loop_end` | 插入到 `Interlock_Loop` 函数末尾的 SCL 代码 |
| `options.output_file` | 修改输出文件名，默认 `Interlock_Loop.scl` |

内置符号：

| 符号 | 默认地址 | 说明 |
|---|---|---|
| `Interlock_Loop` | `FC518` | 联锁主循环函数 |

地址冲突时，在 `symbols` 中以相同名称重新定义即可，例如 `- [Interlock_Loop, FC600]`。

## 3. 联锁 DB 与联锁组（list 项）

`list` 的每一项是一个**联锁 DB**，其下有一组或多组**联锁**。每一组联锁：若干输入 → 一个联锁动作 → 若干输出。

- DB 是使能、数据和 HMI 可见性的单元：`enable`、`data` 都在 DB 层定义，由其下所有组共享；
- 组是联锁逻辑的单元：`input`、`reset`、`output`、`extra_code` 属于组。

### 3.1 DB 属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `DB` | 是 | S7符号定义 \| S7符号引用 | 本 DB 块，是全局 DB（不是背景块）；同一文档中不能重复 |
| `comment` | 否 | 字符串 | DB 注释，见 3.3 |
| `enable` | 否 | S7符号定义 \| S7符号引用 \| SCL表达式 | 运行时使能信号来源，见第 8 节 |
| `$enable` | 否 | 布尔 | 使能的初始值，默认 `true` |
| `data` | 否 | 数组 | 中转数据项，见第 5 节 |
| `groups` | 否 | 数组（至少 1 项） | 联锁组列表，见 3.2；省略时本项自身就是唯一的一组 |

### 3.2 组属性

| 属性 | 必填 | 类型 | 说明 |
|---|---|---|---|
| `comment` | 否 | 字符串 | 本组注释，未提供时取 DB 注释 |
| `input` | 是 | 数组（至少 1 项） | 触发联锁的输入，见第 6 节 |
| `reset` | 否 | 数组 | 复位整组输出的条件，见第 7 节 |
| `output` | 否 | 数组 | 联锁输出，见第 7 节 |
| `extra_code` | 否 | 字符串 | 附加在本组逻辑之后的 SCL 代码，见第 10 节 |

只有一组联锁时，组属性直接写在 list 项中（第 1 节的最小示例就是这种简写）；有多组时写在 `groups` 中，见第 9 节。两种写法不能混用：有 `groups` 时，DB 层不能再写 `input`、`reset`、`output`、`extra_code`。

### 3.3 注释

- list 项的 `comment` 总是 **DB 注释**。简写形式下也一样：那唯一的一组没有自己的注释，取 DB 注释。
- 生成代码中 DB 块前的注释：取 `comment`；没有时取 DB 符号定义的第 4 项。
- 符号表中 DB 符号的注释：取符号定义的第 4 项；没有时取 `comment`。
- 每一组的注释：取本组的 `comment`；没有时取 DB 注释。

## 4. 值的四种写法

`input`、`reset`、`output` 中凡是需要"一个布尔值"的地方，都可以用以下四种写法：

| 写法 | 示例 | 生成的 SCL |
|---|---|---|
| data 项名称 | `EBTN` | `"IL_ESDBTN".EBTN` |
| S7 符号引用 | `DI02-11` | `"DI02-11"` |
| S7 符号定义 | `[DI02-14, I5.5]` | `"DI02-14"`（同时定义该符号） |
| SCL 表达式 | `'"PIT-1201".HH_flag'` | `"PIT-1201".HH_flag` |

判定顺序：先查本 DB 的 data 项名称，再查已定义的符号，都不匹配时**原样**作为 SCL 表达式输出。

注意：

- **在 SCL 表达式内部不能直接写 data 项名称或符号名**，必须写成完整的 SCL 地址。
  例如要引用 data 项 `WCS_work`，应写 `'"IL_pump".WCS_work XOR MOT0101.run'`，而不是 `'WCS_work XOR ...'`。
- **拼写错误或未定义的符号不会报错**，而是被原样当作 SCL 表达式输出。
  例如 `DI02-12` 没有在任何地方定义时，会生成不带引号的 `DI02-12`，直到在 Step 7 中编译才会报错。
- 表达式中含有双引号时，整个值要用单引号包起来（YAML 规则）。
- **不能使用 `enable`**：本 DB 的使能为假时，input 和 reset 不会被计算，output 也不该反过来改变使能，所以写了会报错。
- 引用的 data 项必须是 `BOOL` 类型，其它类型报错。

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
| `$value` | 否 | 与 `type` 相符的值 | 字段的初始值，如 `true`、`10`、`2.5`；类型或范围不符时报错 |
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
- '"PIT-1201".HH_flag'       # SCL 表达式
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
  - LIT0205A.LL_flag
  - LIT0205B.LL_flag
```

`trigger` 只能是上表中的 5 种，写错会报错。

边沿类（`rising`/`falling`/`change`）输入会在 DB 中生成追随变量 `b_<n>_fo`，其中 `<n>` 是该项在本 DB 输入中的序号；如果 data 项已占用了 `b_<n>` 或 `b_<n>_fo`，序号会自动跳过。

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

组级复位不能使用 `inputs`（它在计算输入之前执行），写了会报错。

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

`inputs` 可以写在括号里，如 `NOT(inputs)`；`"X".inputs` 这类名称不会被误认。

`NOT inputs` 适合"提醒类"输出：它跟随输入状态，不需要等总复位。注意边沿类输入只在一个周期内为真，所以如果输入全部是边沿触发，`NOT inputs` 几乎会立即复位输出，这时应配合 `on`/`off` 类型的输入使用。

**反相 `inversion`**：置位时输出 `FALSE`，复位时输出 `TRUE`。使能为假时默认输出复位值 `TRUE`，可用 `default: false` 改变：

```yaml
output:
- value: stop
  inversion: true    # 联锁动作时断开
  default: false     # 未使能时也断开
  reset: comfirm     # 人工确认后恢复
```

注意反相输出的 DB 字段初值是 `FALSE`。如果既没有组级复位、也没有单独复位，输出一旦动作就再也回不到 `TRUE`，所以反相输出通常要配一个复位条件。

**不要把输出项同时用作复位条件**：没有 `read` 的 data 项一旦被用作复位条件，就会在每个周期末被清零（见第 5 节）。如果它同时又是某一组的输出，HMI 和 `write` 永远只能看到 `FALSE`，转换器会给出警告。

## 8. 使能 enable

每个 DB 有一个 `enable` 字段（带 `S7_m_c`），为假时该 DB 下所有联锁组停止工作，输出置为默认值。

| 指令 | 作用 |
|---|---|
| `$enable: false` | 设定 `enable` 字段的**初始值**，HMI 可修改 |
| `enable: <信号>` | 每个周期从该信号**读入** `enable`，此时 HMI 的修改会被覆盖 |

例如 `enable: '"IL_ESDBTN".enable'` 可以让本 DB 跟随另一个联锁 DB 的使能状态。

`enable` 必须是一个地址（符号或单个变量），不能是 `true`/`false` 这样的字面量，也不能是 `'"A".x AND "B".y'` 这样的表达式，否则报错。只想设定初始值时用 `$enable`。

`enable` 和 `$enable` 写在 DB 层，作用于该 DB 下的所有组，没有组级使能。某一组需要单独启停时：

- 把它放到单独的 DB 中，它就有了自己的 `enable`；如果还要跟随原 DB 的使能，可以写 `enable: '"IL_main".enable AND ...'`；
- 或者定义一个 data 项，用 `and` 把它和输入组合：

  ```yaml
  data:
  - allow_start                # HMI 可写
  groups:
  - input:
    - and: [allow_start, LH]
      trigger: rising
    output: [run_cmd]
  ```

  注意这只阻止本组被**触发**，已经锁存的输出不会因此复位，也不会被置为默认值。

## 9. 一个 DB 多组联锁

几组相互关联的联锁（例如液位联锁泵：高液位启泵、低液位停泵）应当放在同一个 DB 中，用 `groups` 写在同一个 list 项里：

- 共享同一个 `enable`；
- **共享同一个 data 命名空间**：DB 层定义的 data 项，每一组都可以按名称引用；
- data 项名称不能重复，也不能与 `enable` 重名，否则报错；
- 边沿追随变量 `b_<n>_fo` 的序号在整个 DB 内连续编号；
- 按 `groups` 的顺序依次执行。多组写同一个输出时，同一周期内后执行的组生效，未使能时也一样，注意各组的 `default`。

同一个 DB 不能出现在两个 list 项中，否则报错。

```yaml
list:
- DB: [IL_level, DB124, ~, 液位联锁泵]
  data:
  - {name: LH, read: '"LIT101".H_flag', comment: 液位高}
  - {name: LL, read: '"LIT101".L_flag', comment: 液位低}
  - {name: run_cmd, write: '"P101".run_cmd', comment: 泵运行命令}
  groups:
  - comment: 高液位启泵
    input: [LH]
    output: [run_cmd]
  - comment: 低液位停泵
    input: [LL]
    output:
    - value: run_cmd
      inversion: true      # 联锁动作时输出 FALSE，即停泵
      default: false       # 未使能时也输出 FALSE，否则反相的默认值 TRUE 会覆盖上一组
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

每个 DB 的代码以一行标题 `// ===== DB "<DB名>": <DB注释>` 开头，其下各组以组注释分隔。对每个 DB 依次执行：

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
| 警告"配置文件中以下符号用户定义的类型有误" | DB 符号定义了类型（如某个 FB），联锁 DB 必须是全局 DB，转换器已按全局 DB 处理 |
| `interlock的input_list必须有1项以上!` | `input` 缺失或为空（`groups` 的每一组也需要） |
| `interlock 的 DB "xxx" 重复！` | 同一个 DB 出现在多个 list 项中，应改用 `groups` |
| `… 有 groups 时，不能在 DB 层设置 …` | 写了 `groups`，又在 DB 层写了 `input`/`reset`/`output`/`extra_code` |
| `interlock 的 groups 必须是至少有1项的数组!` / `interlock 的 groups 项必须是对象!` | `groups` 为空或格式错误 |
| `interlock 项属性 name:xxx 重复定义或已保留!` | 同一 DB 下 data 项重名，或与 `enable` 重名（不区分大小写） |
| `… 必须是全局 DB 块 …` | `DB` 的地址不是 DB 块（如写成了 FB） |
| `… 中不能使用 enable!` | 在 input、reset 或 output 中写了 `enable` |
| `… 类型为 INT，不能用作布尔值!` | 在 input、reset 或 output 中引用了非 `BOOL` 的 data 项 |
| `… trigger:xxx 无效 …` | `trigger` 不是 5 种触发类型之一 |
| `… input 对象必须有 value 或 and 属性 …` | input 对象缺少 `value`/`and`，或 `value` 写成了对象 |
| `… and 列表的每一项 …` | `and` 中的项写成了对象 |
| `… output 对象必须有 value 属性 …` | output 对象缺少 `value`，或 `value` 写成了对象 |
| `… 组级 reset 中不能使用 inputs …` | 组级 `reset` 中写了 `inputs` |
| `… enable 必须是可赋值的地址 …` | `enable` 写成了字面量或表达式，设初值请用 `$enable` |
| `… data 项 xxx 的 $value 无效 …` | `$value` 与 data 的 `type` 不符或超出范围 |
| 警告"既是输出又是复位条件" | 没有 `read` 的 data 项同时被用作输出和复位条件，每周期末被清零 |
| `interlock 的 output 项不能有 read 属性!` | 把带 `read` 的 data 项用作输出 |
| 生成的 SCL 中出现不带引号的名称 | 符号名拼写错误或未定义，被当作了 SCL 表达式（见第 4 节） |
| 联锁动作后输出一直不消失 | 输出是锁存的，需要配置 `reset`（见 7.1） |
