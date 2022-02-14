import { join } from 'path';
import { readdir } from 'fs/promises';
import { module_path, write_file } from './src/util.js';
import { convertRules } from 'gooconverter';

const supported_types = (await readdir(join(module_path, 'src/converters'))).map(
    file => file.replace(/\.js$/, '')
);

const rules = [{
    "name": `converter.js`,
    "tags": {
        supported_types,
    }
}];
const template = `// 本代码为 ./build.js 自动生成
// 在 ./src/converters 目录下编写转换器代码，文件名称必须是 {type}.js 的格式。
// 每个转换器必须实现
//   function if_type_<type>        判断是否为当前转换类型
//   function gen_<type>            生成转换列表，转换列表可为空，即没有转换项
//                                  列表的每一项是一个转换对象 { rules, template }
//   function gen_<type>_copy_list  生成复制列表，转换列表可为空，即没有复制项
// 每个转换器可选实现
//   Array <type>_BUILDIN           该转换类型的内置符号列表
//   function parse_symbols_<type>  第一遍扫描文档时提取符号
//   function build_<type>          第二遍扫描文档时构建完善的转换数据
// 转换器文件定义了目前支持的转换类型
export const supported_types = ['{{supported_types.join("', '")}}'];

// 引入所有的转换器{{#for type in supported_types}}
import * as {{type}}_converter from './converters/{{type}}.js';{{#endfor}}

export const converter = { {{#for type in supported_types}}
    ...{{type}}_converter,{{#endfor}}
}
`;

for (let { name, content } of convertRules(rules, template)) {
    const output_file = join(module_path, 'src', name);
    await write_file(output_file, content, {});
    console.log(`created ${output_file}`);
};