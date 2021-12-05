#!/usr/bin/env node
import { convert } from './lib/index.js';
import { copyFile, readFile } from 'fs/promises';

const [, , cmd = 'convert', path = '.'] = process.argv;

if (cmd === 'convert' || cmd === 'conv') {
    process.chdir(path);
    await convert();
    console.log("converted all YAML to SCL!")
} else if (cmd === 'init' || cmd === 'template') {
    await copyFile(new URL('./conf/AS1.yml', import.meta.url), 'AS1.yml');
} else if (cmd === '-v' || cmd === '-V' || cmd === '--version') {
    const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url)));
    console.log(`v${pkg.version}`);
} else {
    console.log(`usage:

s7scl [cmd] [path]

cmd 子命令：
* convert | conv           转换配置为SCL，省略时的默认子命令
* help                     打印本帮助
* init | template          在当前目录或指定目录下产生一个样板YAML文件

path 参数:  指示要解析的YAML文件所在的目录，默认为 "." 即省略时为当前目录

options:
--version | -V | -v        显示版本号

例子：转换当前目录
s7scl conv
`);
}