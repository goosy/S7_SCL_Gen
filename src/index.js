import { posix } from "node:path";
import { convert as gc } from 'gooconverter';
import { converter, supported_features } from './converter.js';
import { gen_data } from './gen_data.js';
import { apply_rules } from './rules/index.js';
import { context, copy_file, read_file, write_file } from './util.js'

export { apply_rules, get_rules } from './rules/index.js';
export { convert, context, supported_features, converter };

async function _convert(copy_list, convert_list) {
    const { silent, no_copy, no_convert } = context;

    if (copy_list?.length && !no_copy) {
        silent || console.log("\ncopy file to: 复制文件至：");
        for (const copy_item of copy_list) {
            const { source, distance, input_dir, output_dir, IE, OE, line_ending } = copy_item;
            const src_file = posix.join(input_dir, source);
            const dst_file = posix.join(output_dir, distance);
            if (IE == null) { // copy directly without specifying encoding
                await copy_file(src_file, dst_file);
            } else {
                const content = await read_file(src_file, { encoding: IE });
                copy_item.content = OE === 'gbk' && content.charCodeAt(0) === 0xFEFF
                    ? content.substring(1) : content;
                await write_file(dst_file, copy_item.content, { encoding: OE, line_ending });
            }
            silent || console.log(`\t${dst_file}`)
        }
    }

    if (convert_list?.length) {
        silent || no_convert || console.log("\ngenerate file: 生成文件：");
        // Asynchronous sequential execution
        for (const convert_item of convert_list) {
            const { distance, output_dir, tags, template, OE, line_ending } = convert_item;
            const filename = posix.join(output_dir, distance);
            const content = gc(tags, template);
            convert_item.content = content;
            // Whether to output is determined by the no_convert variable
            if (!no_convert) {
                await write_file(filename, content, { encoding: OE, line_ending });
                silent || console.log(`\t${filename}`);
            }
        }
    }

    return { copy_list, convert_list };
}

async function convert(rules) {
    context.silent || console.log(`current conversion folder 当前转换文件夹: ${context.work_path}`);
    let { copy_list, convert_list } = await gen_data();
    if (Array.isArray(rules) && rules.length) {
        copy_list = await apply_rules(copy_list, rules);
        convert_list = await apply_rules(convert_list, rules);
    }
    return _convert(copy_list, convert_list);
}
