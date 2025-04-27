import { posix } from "node:path";
import { convert as gc } from 'gooconverter';
import { converter, supported_features } from './converter.js';
import { gen_data } from './gen_data.js';
import { apply_rules } from './rules/index.js';
import { context, copy_file, read_file, write_file } from './util.js'

export { apply_rules, get_rules } from './rules/index.js';
export { convert, context, supported_features, converter };

async function process(list) {
    const { silent, no_copy, no_convert } = context;

    // Ensure it's iterable, such as Array or Set
    if (list == null || typeof list[Symbol.iterator] !== 'function') return;
    let current_type = '';
    for (const item of list) {
        const type = item.type;
        if (type === 'copy' && !no_copy) {
            silent || current_type === type || console.log("\ncopy file to: 复制文件至：");
            current_type = type;
            const { source, distance, input_dir, output_dir, IE, OE, line_ending } = item;
            const src_file = posix.join(input_dir, source);
            const dst_file = posix.join(output_dir, distance);
            if (IE == null) { // copy directly without specifying encoding
                await copy_file(src_file, dst_file);
            } else {
                const content = await read_file(src_file, { encoding: IE });
                item.content = OE === 'gbk' && content.charCodeAt(0) === 0xFEFF
                    ? content.substring(1) : content;
                await write_file(dst_file, item.content, { encoding: OE, line_ending });
            }
            silent || console.log(`\t${dst_file}`)
        }
        if (type === 'convert') {
            silent || current_type === type || console.log("\ngenerate file: 生成文件：");
            current_type = type;
            // Asynchronous sequential execution
            const { distance, output_dir, tags, template, OE, line_ending } = item;
            const filename = posix.join(output_dir, distance);
            const content = gc(tags, template);
            item.content = content;
            // Whether to output is determined by the no_convert variable
            if (!no_convert) {
                await write_file(filename, content, { encoding: OE, line_ending });
                silent || console.log(`\t${filename}`);
            }
        }
    }
    return list;
}

async function convert(options = {}) {
    context.silent || console.log(`current conversion folder 当前转换文件夹: ${context.work_path}`);
    const { rules, ...opts } = options;
    let list = await gen_data(opts);
    if (Array.isArray(rules) && rules.length) {
        list = await apply_rules(list, rules);
    }
    return process(list);
}
