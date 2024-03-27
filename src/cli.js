import { posix } from 'node:path';
import mri from 'mri';
import nodemon from 'nodemon';
import { convert, context, supported_features, get_rules } from './index.js';
import { copy_file } from './util.js';

function show_help() {
    console.log(`usage:

s7scl [subcommand] [path] [options]

subcommand 子命令:
  convert     | conv         转换配置为SCL，省略时的默认子命令
  watch       | monitor      监视配置文件并及时生成SCL
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
--line-ending                输出文件的换行符: CRLF LF
--OE                         输出文件的编码: gbk utf8 等
--rules                      指定依照规则转换，后面跟规则文件的路径。这时 path 参数将被忽略

例子:
s7scl                        转换当前目录下的配置文件
s7scl conv programs/GCL      转换programs/GCL子目录下的配置文件
s7scl gcl                    在当前目录下建立一个名为GCL配置目录，内含样板配置文件
s7scl gcl MyGCL              在当前目录下建立一个名为MyGCL配置目录，内含样板配置文件
s7scl --rules ./rules.yaml   依照规则文件进行转换
`);
}

const argv = mri(process.argv.slice(2), {
    boolean: ['help', 'version', 'silent', 'zyml-only', 'output-zyml'],
    alias: {
        H: 'help',
        V: ['v', 'version'],
        Z: ['z', 'zyml-only'],
        S: ['s', 'silent'],
    }
});
const [cmd = 'convert', path] = argv._;
const output_zyml = argv['zyml-only'] || argv['output-zyml'];
if (output_zyml) context.output_zyml = output_zyml;
const noconvert = argv['zyml-only'];
if (noconvert) context.noconvert = noconvert;
const silent = argv.silent;
if (silent) context.silent = silent;
const encoding = argv.OE;
if (encoding) context.OE = encoding;
const line_ending = argv['line-ending'];
if (line_ending) context.line_ending = line_ending;
const rules_file = argv.rules;

if (argv.version) {
    console.log(`v${context.version}`);
} else if (argv.help) {
    show_help();
} else if (cmd === 'convert' || cmd === 'conv') {
    if (rules_file) {
        const tasks = await get_rules(rules_file);
        for (const { path, rules } of tasks) {
            process.chdir(path);
            context.work_path = process.cwd().replace(/\\/g, '/');
            await convert(rules);
        }
    } else {
        if (path) {
            process.chdir(path);
            context.work_path = process.cwd().replace(/\\/g, '/');
        }
        await convert();
    }
    noconvert || silent || console.log("\nAll GCL files have been converted to SCL files! 所有GCL文件已转换成SCL文件。");
} else if (cmd === 'watch' || cmd === 'monitor') {
    process.chdir(path ?? '.');
    nodemon({
        restartable: "rs",
        verbose: !silent,
        script: posix.join(context.module_path, 'lib', 'cli.js'),
        ext: 'yaml,scl'
    });
    nodemon.on('start', function () {
        console.log('s7-scl-gen has started');
    }).on('quit', function () {
        console.log('s7-scl-gen has quit');
        process.exit();
    }).on('restart', function (files) {
        console.log('s7-scl-gen restarted due to: ', files);
    });
} else if (cmd === 'gcl' || cmd === 'init' || cmd === 'template') {
    const dst = posix.join(context.work_path, path ?? 'GCL');
    await copy_file(posix.join(context.module_path, 'example'), dst);
    await copy_file(posix.join(context.module_path, 'README.md'), dst + '/');
    const fullname_dst = posix.join(context.work_path, dst);
    const readme = posix.join(fullname_dst, 'README.md');
    console.log(`Generated configuration folder ${fullname_dst}. 已生成配置文件夹 ${fullname_dst}。\nSee instructions in ${readme}. 可以参阅 ${readme} 内的说明。`);
} else {
    show_help();
}
