import { COMMON_NAME } from "./symbols.js";

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
`;

export function gen_common(common_list) {
    const rules = [];
    common_list.forEach(({ CPU, includes, options = {} }) => {
        const { name, output_dir } = CPU;
        const { output_file = COMMON_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                name,
                includes,
            }
        })
    });
    return { rules, template }
}
