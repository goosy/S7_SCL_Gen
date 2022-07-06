#!/usr/bin/env node
import { convert, copy_file, version } from './lib/index.js';
import { join } from 'path';
import mri from 'mri';

function show_help() {
    console.log(`usage:

s7scl [subcommand] [path] [options]

subcommand 子命令:
  convert     | conv         转换配置为SCL，省略时的默认子命令
  help                       打印本帮助
  gcl  | init | template     在当前目录下产生一个配置目录，内含样板配置文件
                             默认目录名为GCL，也可以用path参数指定为其它目录

path 参数:  指示要解析的YAML文件所在的目录，默认为 "." 即省略时为当前目录

options:
--version     | -V | -v      显示版本号，会忽略任何 subcommand 子命令
--help        | -H           打印本帮助，会忽略任何 subcommand 子命令
--output-zyml                转换时同时输出无注释的配置文件(后缀为.zyml)
--zyml-only   | -z | -Z      只输出无注释的配置文件，不进行SCL转换
--silent      | -s | -S      不输出过程信息

例子:
s7scl                        转换当前目录下的配置文件
s7scl conv programs/GCL      转换programs/GCL子目录下的配置文件
s7scl gcl                    在当前目录下建立一个名为GCL配置目录，内含样板配置文件
s7scl gcl MyGCL              在当前目录下建立一个名为MyGCL配置目录，内含样板配置文件
`);
}

const argv = mri(process.argv.slice(2), {
    boolean: ['help', 'version'],
    alias: {
        H: 'help',
        V: ['v', 'version'],
        Z: ['z', 'zyml-only'],
        S: ['s', 'silent'],
    }
});
const [cmd = 'convert', path] = argv._;
const output_zyml = argv['zyml-only'] || argv['output-zyml'];
const noconvert = argv['zyml-only'];
const silent = argv.silent;

if (argv.version) {
    console.log(`v${version}`);
} else if (argv.help) {
    show_help();
} else if (cmd === 'convert' || cmd === 'conv') {
    process.chdir(path ?? '.');
    await convert({ output_zyml, noconvert, silent });
    noconvert || silent || console.log("converted all YAML to SCL!");
} else if (cmd === 'gcl' || cmd === 'init' || cmd === 'template') {
    const dst = path ?? 'GCL';
    await copy_file('example', dst);
    await copy_file('README.md', dst + '/');
    const fullname_dst = join(process.cwd(), dst);
    const readme = join(fullname_dst, 'README.md');
    console.log(`已生成配置文件夹 ${fullname_dst}。\n可以参阅 ${readme} 内的说明。`);
} else {
    show_help();
}
