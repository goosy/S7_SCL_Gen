# S7_SCL_Gen

S7_SCL_Gen is an SCL generator. Once the user has written the configuration files, running the generator produces the SCL source code that the corresponding functions of an S7 CPU need.

## 1. Install

* npm: `npm install s7-scl-gen -G`
* yarn: `yarn global add s7-scl-gen`
* pnpm: `pnpm add s7-scl-gen -G`

## 2. Usage

We call a configuration file a GCL file, and the folder containing the configuration files a GCL folder.

The SCL generator translates GCL files into the corresponding SCL files, which are used in Siemens S7 projects. The output folder is defined in the GCL files (more precisely, in the CPU document).

After installing S7_SCL_Gen, you can use the `s7scl` command.

The `s7scl` command has a set of subcommands; for example, `s7scl help` shows the help for the command.

The usage of some subcommands is briefly described below:

### 2.1 Generate a configuration folder template

```bash
s7scl gcl [GCL folder path]
```

This generates GCL template files in the given GCL folder. The folder contains sample configuration files and this document, `README.md`; you can then edit them to fit your business.

If `GCL folder path` is omitted, a folder named GCL is created in the current folder to hold the GCL template files.

### 2.2 Generate SCL source code

```bash
s7scl convert [GCL folder path]
```

When `GCL folder path` is omitted, it defaults to the current folder `.`; in that case you need to enter the GCL configuration folder first.

In fact, if the GCL folder is the current folder, the `convert` subcommand can also be omitted; the command below converts the configuration files in the current folder.

```bash
s7scl
```

### 2.3 Command help

Run `s7scl help` to view the generator's command help.

### 2.4 Watch

```bash
s7scl watch [GCL folder path]
```

Used for continuous conversion: any change to the GCL in the GCL folder triggers the converter to generate new SCL files. Only `.yaml` and `.yml` files are watched; changes to SCL source files that are copied or merged do not trigger a conversion, so type `rs` and Enter to re-run it manually when needed.

This feature requires [nodemon](https://www.npmjs.com/package/nodemon) to be installed globally first, e.g. `npm install -g nodemon` or `pnpm add -g nodemon`.

## 3. Configuration document syntax

Configuration documents use YAML syntax; a YAML file containing configuration documents is called a GCL file here.

A GCL file can contain multiple documents. The example below has 2 configuration documents:

```YAML
--- # document separator directive
#CPU: AS1     # indicates which CPU this belongs to
#feature: CPU # indicates the feature of this configuration
name: AS1-CPU 

platform: step7 # runtime platform

device: CPU410-5H

symbols:
- [Clock_Byte, MB10] # set the clock memory to MB10

options:
  output_dir : SCL # set the output folder

--- # document separator directive
# CPU: AS1    # indicates which CPU this belongs to
# feature: AI # indicates the feature of this configuration
# the name directive is equivalent to the combination of the CPU and feature directives
name: AS1-AI

list: # feature item list
- comment: air temperature
  DB: [TIT002, DB+]
  input: [AI01-03, PIW516]
  $zero: "-40.0"
  $span: "80.0"
- comment: liquid level
  DB: [LIT010, DB+]
  input: '"RecvDB".Tank1'

... # document end directive
```

* `---` is YAML syntax; it marks the start of a configuration document;
* `...` is YAML syntax; it marks the end of a configuration document;
* A configuration document is a basic configuration unit and cannot be split;
* You can write multiple configuration documents in one file, or of course spread them across multiple files;
* The root properties of each document are called directives, e.g. `feature` `CPU` `list` `options` above

Mind directive compatibility: run `s7scl -v` to see the generator's current directive version.

### 3.1 Required directives

A configuration document must have the `name` directive, or the `CPU`,`feature` directive combination; use one of the two methods.

Both directive values are strings. name is equivalent to the combination of the latter two, `<CPU>-<feature>`, and has the same effect; name is recommended because it makes document uniqueness easier to understand.

Each document's name must be unique, i.e. there can be only one configuration document for a given combination of CPU and feature.

Currently 12 types of configuration documents are implemented — the CPU document and 11 feature documents, indicated by the `feature` directive, case-insensitive. They are:

* `CPU`          CPU document
  Indicates a CPU feature: the resources, information and directives shared by all other configuration documents that use this CPU.
  For example, the platform the CPU belongs to, the output folder, shared symbols and includes, etc.
  When generating code, all configuration files belonging to the same CPU are checked together for resource conflicts, allocated resources together, and have their symbol tables merged automatically, to avoid occupying the same DB block, the same connection, etc.
* `AI`           Feature document for analog values of AI channels (including limit checks)
* `limit`        Feature document for process value limit checking, aliases `limitcheck`, `LC`
  Used for limit checking of process values that do not come from AI channels, e.g. process values received over 485
* `AO`           Feature document for analog output of AO channels
  Linearly converts an engineering-unit value to the raw value of an AO module channel
* `PI`           Feature document for pulse value conversion
* `SC`           Feature document for serial polling
  Used in RS232 RS422 RS485 communication.
  This feature includes modbus RTU polling, so the directive can also be written as `MB` `modbusRTU`
* `ModbusTCP`    Feature document for modbusTCP polling
  The directive name can also be abbreviated as `MT`
* `Valve`        Feature document for valve control
* `Motor`        Feature document for motor control
* `Interlock`    Feature document for alarm interlocks (implements the simplest input _OR operation_ followed by rising-edge output)
* `Timer`        Feature document for timing
* `RP`           Feature document for relay delays and pulses
  Signal shaping built on TON/TOF/TP and CP/DP: on-delay, off-delay, pulse, etc. The directive can also be written as `RELAY` `PULSE`

For the configuration and description of each specific feature document, see the YAML files in the example directory.

### 3.2 Optional directives for all documents

#### 3.2.1 options

* Type: key-value pairs

Some extra settings, e.g. options.output_file sets the output file name

#### 3.2.2 symbols

* Type: array
* Array element: S7 symbol definition

Each type of configuration document has some built-in symbols, and all built-in symbols have default addresses.

Built-in symbols usually don't need to be written, but if there is an address conflict, you can rewrite a built-in symbol in the symbols list to change its address and comment; the name of a built-in symbol cannot be changed.

#### 3.2.3 includes: extra code

* Type: string array | string

includes specifies SCL code to be included in the current feature's output file; the code content is merged at the beginning of the output file.

The includes directive value comes in 2 kinds:

I. **String**: the string is merged directly as SCL code

Example:

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
II. **Array**: a list of files; each item is a relative path name in the same directory, or an object containing the name and encoding. The converter extracts the content of each file as the merge source

Example:

```yaml
includes:
- JSFlow.scl                                 # file name only; the file encoding defaults to UTF-8
- filename: FXGasFlow.scl                    # file object form
  encoding: utf8                             # specify the file encoding
- {filename: JS_Flow.scl, encoding: gbk}     # file object written on one line, specifying the file encoding
```

includes can only use one of the 2 kinds above. Since writing SCL code in YAML has many limitations, using external files is recommended.

Note: the extra SCL code referenced by includes must be written by the user; the generator does not check it for syntax errors.

> [!tip] Advanced usage 1
> External SCL files can use `{{ expression }}` placeholders; define the strings to substitute in the `attributes` section of the main yaml file for better reuse.

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
  U_VFD {S7_m_c := 'true'}: INT ;       // 506 VFD voltage
  I_VFD {S7_m_c := 'true'}: INT ;       // 507 VFD current
  Ua {S7_m_c := 'true'}: INT ;          // 511 AA voltage
  Ub {S7_m_c := 'true'}: INT ;          // 512 BB voltage
  Uc {S7_m_c := 'true'}: INT ;          // 513 CC voltage
  error {S7_m_c := 'true'}: INT ;       // 515 fault code
END_STRUCT;
BEGIN
END_DATA_BLOCK
```

> [!tip] Advanced usage 2
> In an external SCL file you can wrap comments between the two lines `(**` and `**)`; these comments are not output to the final SCL:

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

#### 3.2.4 files: extra files to copy

* Type: string array

Specifies extra files or folders to copy; files with the same names are created in the output folder.

Each item of the files array is a path relative to the directory of the current configuration file. `/` must be used as the path separator.

Notes:

- Unlike includes, files can only use external files, and they can be files of any type (SCL or AWL code files are recommended)
- A file given by name only is just copied, without encoding conversion
- A file with a specified encoding is converted to GBK and saved in the target folder. (GBK makes it easy for Siemens software to import the files)
- By default the path is not copied to the target directory; the output folder (assumed here to be `output_dir`) contains only the last file or folder of the path.

In most cases you don't need to specify an encoding; just write the file name.

Assuming the target folder is output_dir:

```yaml
files:
- a/b/c.scl                          # the copied file is `output_dir/c.scl`; only the file is copied
- ../readme.docx                     # the copied file is `output_dir/readme.docx`; non-text files must be written by name only
- foo/a_folder                       # folder copy, creating the target folder `output_dir/a_folder` containing the files in that folder
```

> [!tip] Advanced usage 1
> If you need to copy a relative path, put "//" before the part of the path to keep.

```yaml
files:
- os//ab/c.scl                       # copies `os/ab/c.scl` to `output_dir/ab/c.scl`
- ../..//lib/c.scl                   # copies `../lib/c.scl` to `output_dir/lib/c.scl`
```

> [!tip] Advanced usage 2
> You can specify the source file's encoding, so it can be converted to the GBK encoding that Siemens software recognizes

```yaml
files:
- filename: myfunc.scl               # the copied file is `output_dir/myfunc.scl`
  encoding: utf8                     # the file encoding is UTF-8; the copied file is forced to GBK
- {filename: folder, encoding: gbk}  # encoding attached on one line; this copies the `folder` folder, whose source files are all GBK
```

> [!tip] Advanced usage 3
> glob patterns can be used.

```yaml
files:
- lib/*                     # copies all files in the lib directory, excluding subdirectories
- filename: [lib//**.scl]   # copies all SCL files in the lib directory and its subdirectories
  encoding: utf8            # all matched files are UTF-8 encoded
```

Note: the generator does not check file contents for errors, nor does it parse the files.

### 3.3 Optional directives

* list: the list for the corresponding feature
  Type: object list
* loop_begin: extra code
  Type: string
  The directive value is SCL code, merged at the beginning of the current loop function body
* loop_end: extra code
  Type: string
  The directive value is SCL code, merged at the end of the current loop function body

## 4. Configuration value types

For a given configuration item under a specific directive, its value is usually one of the following kinds. For the type of a specific configuration item, see the sample configuration files.

### 4.1 Boolean

There are 2 available literals: `true` `false`

Case-insensitive.

### 4.2 Number

The configuration item value is a number; its literal can be a decimal number or a hexadecimal number. Example of a hexadecimal literal: 0x4A98

Examples of number values include `zero` `span` in the AI configuration.

### 4.3 String

In most cases string values can be written without quotes; see YAML syntax for details.

### 4.4 SCL expression

The literal form is the same as a string, but its content must be a standard SCL expression; SCL syntax is the authority on the exact requirements.

If the literal contains double quotes, wrap the expression in single quotes as YAML syntax requires, e.g. `'NOT "TIT001".LL_flag'`

### 4.5 S7 symbol definition

An S7 symbol corresponds to a symbol in Siemens software, usually with a name, address and type. Many configuration items in the configuration files are required to be an S7 symbol.

The value of such an item is usually given as an array in YAML square-bracket syntax, in the form `[name, address, type, comment]`; the last two items of the array can be omitted, and the type must be a valid S7 type.

For example, `[recvDB, DB100, FB512, receive block]` defines a DB block symbol named "recvDB", which is the instance DB of FB512. `[length, M100, INT, length]` is also a valid M area symbol.

Each symbol can be defined only once, i.e. names and addresses must not be duplicated, otherwise the converter reports an error.

The type of every FB, FC and UDT symbol is always itself, so the type of these three kinds of symbols can be omitted; when a DB symbol's type is omitted, it defaults to itself.

For each configuration item of the symbols directive, the value must be a symbol definition.

### 4.6 S7 symbol reference

If a symbol definition has already been configured and the same S7 symbol is needed elsewhere, you can simply reference it by the symbol name.

For example, `recvDB` can be used to refer to the S7 symbol defined above by `[recvDB, DB100, FB512, receive block]`.

### 4.7 Arrays and objects

These 2 types are combinations of the configuration item types above.

### 4.8 Union types

Some configuration items can be one of several configuration value types.

For example, the `DB` and `input` configuration items in the AI configuration document can be either a symbol definition or a symbol reference.

Another example: each element of `input_list` in the interlock configuration document can be an object, a symbol definition, a symbol reference, or an SCL expression.
