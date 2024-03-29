# S7_SCL_Gen

S7_SCL_Gen 为SCL生成器，用户只要配置好配置文件，运行生成器会产生 S7 CPU 对应功能所需要的 SCL 源码。

## 1. 安装 install

* npm: `npm install s7-scl-gen -G`
* yarn: `yarn global add s7-scl-gen`
* pnpm: `pnpm add s7-scl-gen -G`

## 2. 命令使用 usage

我们将配置文件称为GCL文件，将配置文件所在的文件夹称为GCL文件夹。

SCL生成器能够将GCL文件翻译成对应的SCL文件，后者用于西门子S7项目中。输出文件夹在GCL文件（准确说是CPU文档）中定义。

安装 S7_SCL_Gen 后，便可以使用命令 `s7scl` 来进行相关操作了。

命令 `s7scl` 有一系列子命令，比如 `s7scl help` 子命令即可显示该命令的帮助。

下面简要说明一些子命令的用法：

### 2.1 生成一个配置文件夹模板

```bash
s7scl gcl [GCL文件夹路径]
```

执行后会在指定GCL文件夹中生成GCL样板文件，该文件夹内含样本配置文件和本说明文件`README.md`，然后可以自行修改以符合业务。

如果省略`GCL文件夹路径`时，则会在当前文件夹中生成一个名为GCL的文件夹用于生成GCL样板文件。

### 2.2 生成SCL源码

```bash
s7scl convert [GCL文件夹路径]
```

省略`GCL文件夹路径`时，默认为当前文件夹 `.`，这时需要先进入到对应的GCL配置文件夹下。

事实上，如果GCL文件夹为当前文件夹的话，`convert` 子命令也可以省略，用下方命令即可完成当前文件夹的配置文件转换。

```bash
s7scl
```

### 2.3 命令使用帮助

执行 `s7scl help` 查看生成器命令帮助

### 2.4 监视

```bash
s7scl watch [GCL文件夹路径]
```

用于持续转换，在GCL文件夹中对GCL的任何修改，都会触发转换器生成新的SCL文件。

## 3. 配置文档语法

配置文档采用YAML语法，包含配置文档的YAML文件在这里称为GCL文件。

一个GCL文件可以包括多个文档，下面的示例有2个配置文档：

```YAML
--- # 文档分界指令
#CPU: AS1     # 指示属于哪一个CPU
#feature: CPU # 指示本配置的功能
name: AS1-CPU 

platform: step7 # 运行平台

device: CPU410-5H

symbols:
- [Clock_Byte, MB10] # 设置时钟存储器为MB10

options:
  output_dir : SCL # 设置输出文件夹

--- # 文档分界指令
# CPU: AS1    # 指示属于哪一个CPU
# feature: AI # 指示本配置的功能
# name 指令相当于 CPU 和 feature 指令的组合
name: AS1-AI

list: # 功能项列表
- comment: 气温
  DB: [TIT002, DB+]
  input: [AI01-03, PIW516]
  $zero: "-40.0"
  $span: "80.0"
- comment: 液位
  DB: [LIT010, DB+]
  input: '"RecvDB".Tank1'

... # 文档结束指令
```

* `---` YAML语法，它指示一个配置文档开始；
* `...` YAML语法，它指示一个配置文档结束；
* 一个配置文档为一个基本配置单位，不可分割；
* 可以在一个文件里书写多个配置文档，当然也可以将配置文档分散在多个文件中；
* 每个文档的根属性称为指令，比如上方的 `feature` `CPU` `list` `options`

注意指令兼容性，运行 `s7scl -v` 查看生成器的当前指令版本。

### 3.1 必须书写的指令

配置文档必须有 `name` 指令，或 `CPU`,`feature` 组合指令，两种方法用一种。

这2个指令值类型都是字符串，name 相当于后2者组合而成  `<CPU>-<feature>` ，作用一样，推荐 name 便于理解文档唯一性。

每个文档的 name 必须唯一，即相同 CPU 和 feature 组合的配置文档只能有一个。

目前只实现了9种类型配置文档——CPU文档和8种功能文档，由 `feature` 指令指示，不区分大小写。分别是：

* `CPU`          CPU文档
  指示这是一个CPU功能，使用该CPU的其它配置文档都共享的资源、信息和指令。
  比如指示 CPU 所属的平台、输出文件夹、共用的符号和包含等。
  所有属于同一CPU的配置文件，会在生成代码时，统一检查资源冲突情况、统一资源分配、自动合并符号表，避免占用同一DB块、同一连接等。
* `AI`           AI通道的模拟量（含超限报警）功能文档
* `Alarm`        过程量限值与报警功能文档
  用于非AI通道过来的过程值报警，比如485接收的过程值
* `PI`           脉冲量转换功能文档
* `SC`           串行轮询功能文档
  用在RS232 RS422 RS485通信功能中。
  该功能包括了 modbus RTU 轮询，故指令也可以写为 `MB` `modbusRTU`
* `ModbusTCP`    modbusTCP 轮询功能文档
  指令名称也可以缩写为 `MT`
* `Valve`        阀门控制功能文档
* `Motor`        电机控制功能文档
* `Interlock`    报警连锁功能文档（实现最简单的输入_或运算_后上升沿输出）
* `Timer`        计时功能文档

具体功能文档的配置和说明可参看 example 目录下的YAML文件

### 3.2 所有文档都可选的指令

#### 3.2.1 options 选项参数

* 类型: 键值对

一些额外设定，比如 options.output_file 设定输出文件名

#### 3.2.2 symbols 符号列表

* 类型: 数组
* 数组元素: S7符号定义

每类配置文档都内置了一些符号，内置符号都有默认地址。

内置符号通常不必书写，但如果存在地址冲突，可以在 symbols 列表中重写内置符号以更改地址和注释，但内置符号的名称不可更改。

#### 3.2.3 includes 附加代码

* 类型: 字符串数组|字符串

indludes指示要在当前功能输出文件中附加包含的SCL代码，并将代码内容合并在输出文件开始处。

includes指令值分2种：

I. **字符串** 表示直接将字符串作为SCL代码合并

例：

```yaml
includes: |
  DATA_BLOCK "RecvDB"
  STRUCT
    ID: INT;
    Tank1 : WORD;
  END_STRUCT;
  BEGIN
    Tank1 := W#16#02D0;
  END_DATA_BLOCK
```
II. **数组** 表示文件列表，列表项为同目录下的相对路径名称，或是包含名称和编码格式的对象，转换程序会提取每一个文件内容作为合并来源

例：

```yaml
includes:
- JSFlow.scl                                 # 只有文件名称的写法，默认该文件编码格式为 UTF-8
- filename: FXGasFlow.scl                    # 文件对象的写法
  encoding: utf8                             # 指明文件编码
- {filename: JS_Flow.scl, encoding: gbk}     # 写在一行里的文件对象，指明文件编码
```

includes只能采用上述2种之一，由于在YAML中书写SCL代码有很多局限，推荐用外部文件的方式。

注意： includes 所指向的额外SCL代码需要用户自己编写，生成程序不检查其语法错误。

> [!tip] 高级应用1
> 外部SCL文件可以使用 `{{ expression }}` 替换符，在主 yaml 文件 `attributes` 部分定义要替换要字符串，实现更好的复用。

```SCL
DATA_BLOCK "PE{{ tag_postfix_number }}"
{{if platform == "step7"}}_
{ S7_m_c := 'true'}
{{endif}}_
{{if platform == "portal"}}_
{ S7_Optimized_Access := 'FALSE' }
{{endif}}_
AUTHOR:Goosy
FAMILY:GooLib
STRUCT
  U_VFD {S7_m_c := 'true'}: INT ;       // 506 变频器电压
  I_VFD {S7_m_c := 'true'}: INT ;       // 507 变频器电流
  Ua {S7_m_c := 'true'}: INT ;          // 511 AA_电压
  Ub {S7_m_c := 'true'}: INT ;          // 512 BB_电压
  Uc {S7_m_c := 'true'}: INT ;          // 513 CC_电压
  error {S7_m_c := 'true'}: INT ;       // 515 故障代码
END_STRUCT;
BEGIN
END_DATA_BLOCK
```

> [!tip] 高级应用2
> 可以在外部SCL文件中用 `(**` 和 `**)` 两行包裹注释，这些注释不会输出在最终的SCL中：

```scl
(**
description: |
  Syntax_ID: BYTE;     Always 10 Hex
  DataType: BYTE;      Code for data type
                       1 BOOL  2 BYTE 3 CHAR  4 WORD  5 INT  6 DWORD  7 DINT  8 REAL
  count: WORD;         Number of Byte
  DB_Number: WORD;     Numbet of DB
  Byte_Pointer: DWORD; Pointer to bit- and byte address
**)
TYPE UDT_ANY_Pointer
STRUCT
  Syntax_ID: BYTE;
  DataType: BYTE;
  count: WORD;
  DB_Number: WORD;
  Byte_Pointer: DWORD;
END_STRUCT
END_TYPE
```

#### 3.2.4 files 额外复制的文件

* 类型: 字符串数组

指示要额外复制的文件或文件夹，会在输出文件夹中生成同样名称文件。

files数组的每一项是相对于当前配置文件目录的相对路径。必须使用 `/` 符为路径分隔符。

注意：

- 与includes不同，files 只能采用外部文件的方式，并且可以是任何类型的文件（建议SCL或AWL代码文件）
- 只有文件名的方式，会只复制，不进行编码转换
- 指明编码格式的文件，会转换成 GBK 保存的目标文件夹中。（GBK格式是为了方便西门子软件导入文件）
- 默认不会将路径复制到目标目录中，在输出文件夹（这里假设是 `output_dir` ）中只有路径最后的文件或文件夹。

大多数情况下，都不用指明编码，只要书写文件名就可以了。

假设目标文件夹是 output_dir ，则：

```yaml
files:
- a/b/c.scl                          # 复制后的文件为 `output_dir/c.scl` 仅仅复制文件
- ../readme.docx                     # 复制后的文件为 `output_dir/readme.docx` 非文本文件一定只写名称
- foo/a_folder                       # 文件夹复制，产生目标文件夹 `output_dir/a_folder`，并包含该文件夹下的文件
```

> [!tip] 高级应用1
> 如果需要复制相对路径，可用"//"放置在需保留的路径范围之前。

```yaml
files:
- `- os//ab/c.scl`                   # 会将 `os/ab/c.scl` 复制为 `output_dir/ab/c.scl`
- `- ../..//lib/c.scl`               # 会将 `../lib/c.scl` 复制为 `output_dir/lib/c.scl`
```

> [!tip] 高级应用2
> 可以指明源文件的编码格式，这样可以转换成西门子认识的 GBK 编码格式

```yaml
files:
- filename: myfunc.scl               # 复制后的文件为 `output_dir/myfunc.scl`
  encoding: utf8                     # 指明文件编码是 UTF-8 ，复制后的文件编码强制为GBK
- {filename: folder, encoding: gbk}  # 在一行里附加编码格式，这里复制 `folder` 文件夹，里面的源文件编码都是GBK
```

> [!tip] 高级应用3
> 可以使用 glob 匹配符。

```yaml
files:
- `- lib/*`                 # 复制 lib 目录下的所有文件，不包括子目录
- filename: - lib//**.scl   # 复制 lib 目录及其子目录下的所有 word 文件
  encoding: utf8            # 所有匹配的文件，其编码都是 UTF-8
```

注意：生成器不检查文件内容的错误，也不解析文件。

### 3.3 可选的指令

* list 对应功能的列表
  类型: 对象列表
* loop_begin  附加代码
  类型: 字符串
  指令值为SCL代码，合并在当前循环函数体开始处
* loop_end  附加代码
  类型: 字符串
  指令值为SCL代码，合并在当前循环函数体末尾处

## 4. 配置值类型

对具体指令下的某个配置项，它的值通常为以下几类之一。对于具体某个配置项的类型，可参看样本配置文件。

### 4.1 布尔量

可用的字面量有2个： `true` `false`

不区分大小写。

### 4.2 数字

配置项值为数字，其字面量可以是十进制数字，也可以是16进制的数字。16进制字面量的例子： 0x4A98

数字值的例子有 AI 配置中的 `zero` `span` 等。

### 4.3 字符串

大多数情况下字符值串可以不使用引号，具体参看在YAML语法。

### 4.4 SCL表达式

字面量形式同字符串，但要求其内容是一个标准的SCL表达式，具体要求以SCL语法为准。

如果字面量中有双引号，要依照YAML语法要求，用单引号包裹表达式，比如 `'NOT "TIT001".AL_Flag'`

### 4.5 S7符号定义

S7符号对应指西门子软件中的符号，通常有名称、地址、类型。在配置文件有很多配置项要求是一个S7符号。

该配置项的值通常用一个YAML方括号语法的数组来指定，形式为 `[名称, 地址, 类型, 注释]`，数组后二项可省略，类型必须是一个有效的S7类型。

比如 `[recvDB, DB100, FB512, 接收块]` 就定义一个名为“recvDB”的DB块符号，该DB为FB512的背景块。`[length, M100, INT, 长度]`也是一个有效的M区域符号。

每个符号只能定义一次，即名称和地址不得重复，否则转换器会提示出错。

所有FB、FC、UDT符号的类型一定是它自身，所以这三种符号的type可以省略，DB符号省略类型时默认类型为自身。

在symbols指令的每一个配置项，其值必须是符号定义。

### 4.6 S7符号引用

如果已配置过一个符号定义，在另一处要使用相同的S7符号，可以简单地用符号名称来引用。

比如可以用 `recvDB` 来指示上面 `[recvDB, DB100, FB512, 接收块]` 定义的S7符号。

### 4.7 数组与对象

这2种类型为以上配置项类型的组合。

### 4.8 联合类型

有些配置项可以是多种配置值类型之一。

比如AI配置文档中的 `DB` 和 `input` 配置项，可以是符号定义，也可以是符号引用。

再比如interlock配置文档中的 `input_list` 中的每个元素，配置项类型可以是对象，也可以是符号定义，也可以是符号引用，也可以是SCL表达式。
