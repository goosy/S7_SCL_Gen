#!/usr/bin/env node
import { convert } from './lib/index.js';
import { copyFile, readFile } from 'fs/promises';
import mri from 'mri';

const argv = mri(process.argv.slice(2), {
    boolean: ['help', 'version'],
    alias: {
        H: 'help',
        V: ['v', 'version'],
        Z: ['z', 'zyml-only'],
    }
});
const [cmd = 'convert', path = '.'] = argv._;
const output_zyml = argv['zyml-only'] || argv['output-zyml'];
const noconvert = argv['zyml-only'];

if (argv.version) {
    const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url)));
    console.log(`v${pkg.version}`);
} else if (argv.help) {
    show_help();
} else if (cmd === 'convert' || cmd === 'conv') {
    process.chdir(path);
    await convert({ output_zyml, noconvert });
    if (!noconvert) console.log("converted all YAML to SCL!")
} else if (cmd === 'init' || cmd === 'template') {
    await copyFile(new URL('./conf/AS1.yml', import.meta.url), 'AS1.yml');
} else {
    show_help();
}

function show_help() {
    console.log(`usage:

s7scl [subcommand] [path] [options]

subcommand 子命令：
  convert     | conv         转换配置为SCL，省略时的默认子命令
  help                       打印本帮助
  init        | template     在当前目录或指定目录下产生一个样板YAML文件

path 参数:  指示要解析的YAML文件所在的目录，默认为 "." 即省略时为当前目录

options:
--version     | -V | -v      显示版本号，会忽略任何 subcommand 子命令
--help        | -H           打印本帮助，会忽略任何 subcommand 子命令
--output-zyml                转换时同时输出无注释的配置文件(后缀为.zyml)
--zyml-only   | -z | -Z      只输出无注释的配置文件，不进行SCL转换

例子：转换当前目录
s7scl conv
`);
}