import { convert as gc } from 'gooconverter';
import { copy_file, read_file, write_file, context } from './util.js'
import { gen_data } from './gen_data.js';
import { supported_features, converter } from './converter.js';

export { convert, context, supported_features, converter };

async function convert() {
    const silent = context.silent;
    silent || console.log(`current conversion folder 当前转换文件夹: ${context.work_path}`);

    const { copy_list, convert_list } = await gen_data();

    if (copy_list?.length) {
        silent || console.log("\ncopy file to: 复制文件至：");
        for (const copy_item of copy_list) {
            const { src, dst, IE, OE, line_ending } = copy_item;
            if (IE == null) { // copy directly without specifying encoding
                await copy_file(src, dst);
            } else {
                let content = await read_file(src, { encoding: IE });
                copy_item.content = content;
                if (OE == 'gbk' && content.charCodeAt(0) === 0xFEFF) { // remove BOM
                    content = content.substring(1);
                }
                await write_file(dst, content, { encoding: OE, line_ending });
            }
            silent || console.log(`\t${dst}`)
        }
    }

    if (convert_list?.length) {
        silent || console.log("\ngenerate file: 生成文件：");
        // Asynchronous sequential execution 异步顺序执行
        for (const convert_item of convert_list) {
            const { dst, tags, template, OE, line_ending } = convert_item;
            const content = gc(tags, template);
            convert_item.content = content;
            // 由 noconvert 变量决定是否输出
            context.noconvert || await write_file(dst, content, { encoding: OE, line_ending });
            context.silent || console.log(`\t${dst}`);
        }
    }
    return { copy_list, convert_list };
}