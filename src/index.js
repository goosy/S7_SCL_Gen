import { posix } from "node:path";
import { convert as gc } from 'gooconverter';
import { copy_file, read_file, write_file, context } from './util.js'
import { gen_data } from './gen_data.js';
import { supported_features, converter } from './converter.js';
import { apply_rules } from './rules.js';

export { convert, context, supported_features, converter };
export { get_rules } from './rules.js';

async function _convert(copy_list, convert_list) {
    const silent = context.silent;

    if (copy_list?.length) {
        silent || console.log("\ncopy file to: 复制文件至：");
        for (const copy_item of copy_list.filter(item => item.enable)) {
            const { source, distance, input_dir, output_dir, IE, OE, line_ending } = copy_item;
            const src_file = posix.join(input_dir, source);
            const dst_file = posix.join(output_dir, distance);
            if (IE == null) { // copy directly without specifying encoding
                await copy_file(src_file, dst_file);
            } else {
                let content = await read_file(src_file, { encoding: IE });
                copy_item.content = content;
                if (OE == 'gbk' && content.charCodeAt(0) === 0xFEFF) { // remove BOM
                    content = content.substring(1);
                }
                await write_file(dst_file, content, { encoding: OE, line_ending });
            }
            silent || console.log(`\t${dst_file}`)
        }
    }

    if (convert_list?.length) {
        silent || console.log("\ngenerate file: 生成文件：");
        // Asynchronous sequential execution 异步顺序执行
        for (const convert_item of convert_list.filter(item => item.enable)) {
            const { distance, output_dir, tags, template, OE, line_ending } = convert_item;
            const filename = posix.join(output_dir, distance);
            const content = gc(tags, template);
            convert_item.content = content;
            // 由 noconvert 变量决定是否输出
            context.noconvert || await write_file(filename, content, { encoding: OE, line_ending });
            context.silent || console.log(`\t${filename}`);
        }
    }

    return { copy_list, convert_list };
}

async function convert(rules) {
    context.silent || console.log(`current conversion folder 当前转换文件夹: ${context.work_path}`);
    const { copy_list, convert_list } = await gen_data();
    const has_rules = Array.isArray(rules) && rules.length;
    return _convert(
        has_rules ? apply_rules(copy_list, rules) : copy_list,
        has_rules ? apply_rules(convert_list, rules) : convert_list
    );
}
