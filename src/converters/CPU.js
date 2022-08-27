import assert from 'assert/strict';
import { add_symbols } from '../symbols.js';

export const NAME = 'CPU';

export const device_types = [
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

export function is_type(type) {
    return type.toUpperCase() === 'CPU';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
`;

/**
 * 第一遍扫描 提取符号
 * @date 2022-02-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols({ CPU }) {
    const CM = CPU.symbols_dict['Clock_Memory'];
    if (!CM) return;
    assert(/^mb\d+$/i.test(CM.addr), new SyntaxError(`Clock_Memory 符号 "${CM.addr}" 无效！`));
    const CM_addr = CM.addr.substring(2);
    CM.comment = 'clock memory';
    const symbols = [
        ['Pulse_10Hz', `M${CM_addr}.0`],
        ['Pulse_5Hz', `M${CM_addr}.1`],
        ['Pulse_2.5Hz', `M${CM_addr}.2`],
        ['Pulse_2Hz', `M${CM_addr}.3`],
        ['Pulse_1.25Hz', `M${CM_addr}.4`],
        ['Pulse_1Hz', `M${CM_addr}.5`],
        ['Pulse_0.62Hz', `M${CM_addr}.6`],
        ['Pulse_0.5Hz', `M${CM_addr}.7`],
    ];
    add_symbols(CPU, symbols);
}

export function build({ CPU, options = {} }) {
    if (options.output_dir) CPU.output_dir = options.output_dir;
}

export function gen(CPU_list) {
    const CPU_rules = [];
    CPU_list.forEach(({ CPU, includes, options = {} }) => {
        const { name, output_dir } = CPU;
        const { output_file } = options;
        if (includes.length) CPU_rules.push({
            "name": `${output_dir}/${output_file ?? NAME}.scl`,
            "tags": {
                name,
                includes,
            }
        });
    });
    return [{ rules: CPU_rules, template }];
}

export function gen_copy_list() {
    return [];
}
