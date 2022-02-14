import { get_S7_symbol } from '../symbols.js';

export const CPU_NAME = 'CPU';

const CPU_type = [
    "IM151-8PN/DP",
    "CPU31x-2PN/DP",
    "CPU314C-2PN/DP",
    "CPU317-2PN/DP",
    "IM154-8PN/DP",
    "CPU319-3PN/DP",
    "CPU315T-3PN/DP",
    "CPU317T-3PN/DP",
    "CPU317TF-3PN/DP",
    "CPU412-2PN",
    "CPU414-3PN/DP",
    "CPU416-3PN/DP",
    "CPU412-5H_PN/DP",
    "CPU414-5H_PN/DP",
    "CPU416-5H_PN/DP",
    "CPU417-5H_PN/DP",
    "CPU410-5H",
];
const DEFAULT_DEVICE = "CPU31x-2PN/DP"; //默认的CPU设备

export function is_type_CPU(type) {
    return type.toUpperCase() === 'CPU';
}

export function parse_symbols_CPU({ CPU, options = {} }) {
    if (options.output_dir) CPU.output_dir = options.output_dir;
}

const template_CPU = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
`;

const template_symbols = `{{#for sym in symbol_list}}{{sym}}
{{#endfor sym}}`;

export function gen_CPU(CPU_list) {
    const CPU_rules = [];
    const symbols_rules = [];
    CPU_list.forEach(({ CPU, includes, options = {} }) => {
        const { name, output_dir } = CPU;
        const { output_file = CPU_NAME } = options;
        if (includes.length) CPU_rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                name,
                includes,
            }
        });
        const symbol_list = Object.values(CPU.symbols_dict).map(get_S7_symbol);
        if (symbol_list.length) symbols_rules.push({
            "name": `${output_dir}/symbols.asc`,
            "tags": { symbol_list }
        });
    });
    return [
        { rules: CPU_rules, template: template_CPU },
        { rules: symbols_rules, template: template_symbols }
    ];
}

export function gen_CPU_copy_list() {
    return [];
}
