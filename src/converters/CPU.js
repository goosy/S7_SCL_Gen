import assert from 'assert/strict';
import { convert } from 'gooconverter';
import { add_symbols, make_prop_symbolic } from '../symbols.js';
import { STRING } from '../value.js';

export const NAME = 'CPU';
export const platforms = ['step7', 'portal'];

export const devices = [
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

export function is_feature(feature) {
    return feature.toUpperCase() === 'CPU';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}
{{#for FN in list}}{{#if FN.block.block_name === 'OB'}}
ORGANIZATION_BLOCK "{{FN.block.name}}"{{#if FN.title}}
TITLE = "{{FN.title}}"{{#endif title}}{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }{{#endif portal}}
BEGIN
{{FN.code}}
END_ORGANIZATION_BLOCK{{#else}}
FUNCTION "{{FN.block.name}}"
BEGIN
{{FN.code}}
END_FUNCTION{{#endif block_name}}
{{#endfor FN}}
`;

/**
 * 第一遍扫描 提取符号
 * @date 2022-02-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols(area) {
    const document = area.document;
    const list = area.list.map(item => item.toJSON());
    area.list = list;
    const CPU = document.CPU;
    const CM = CPU.symbols_dict.Clock_Byte;
    if (CM) {
        assert(/^mb\d+$/i.test(CM.address), new SyntaxError(`${CPU.name}-CPU:符号 Clock_Byte 的地址 "${CM.address}" 无效！`));
        CM.name = 'Clock_Byte';
        CPU.symbols_dict.Clock_Byte ??= CM;

        const CM_address = CM.address.substring(2);
        CM.comment = 'clock memory';
        const symbols = [
            ['Pulse_10Hz', `M${CM_address}.0`],
            ['Pulse_5Hz', `M${CM_address}.1`],
            ['Pulse_2.5Hz', `M${CM_address}.2`],
            ['Pulse_2Hz', `M${CM_address}.3`],
            ['Pulse_1.25Hz', `M${CM_address}.4`],
            ['Pulse_1Hz', `M${CM_address}.5`],
            ['Pulse_0.62Hz', `M${CM_address}.6`],
            ['Pulse_0.5Hz', `M${CM_address}.7`],
        ];
        add_symbols(document, symbols);
    }
    list.forEach(FN => {
        if (!FN.block) throw new SyntaxError(`${CPU.name}-CPU: 转换配置项必须有block!`);
        make_prop_symbolic(FN, 'block', document, { default: { comment: FN.comment } }); //S7函数类型
        FN.code = new STRING(FN.code ?? '');
    });
}

export function build({ document, list, options}) {
    const CPU = document.CPU;
    CPU.device = document.get('device');
    list.forEach(FN => {
        if (!['OB', 'FC'].includes(FN.block.block_name)) throw new SyntaxError(`${CPU.name}-CPU: 转换配置项block必须是一个 OB 或 FC 符号!`);
    });
    const name = CPU.name;
    if (options.output_dir) CPU.output_dir = convert({ name, CPU: name }, options.output_dir);
}

export function gen(CPU_list) {
    const CPU_rules = [];
    CPU_list.forEach(({ document, includes, list, options }) => {
        const { CPU, gcl } = document;
        const { output_dir, platform } = CPU;
        const { output_file } = options;
        if (includes.length || list.length) CPU_rules.push({
            "name": `${output_dir}/${output_file ?? NAME}.scl`,
            "tags": {
                platform,
                includes,
                list,
                gcl,
            }
        });
    });
    return [{ rules: CPU_rules, template }];
}

export function gen_copy_list() {
    return [];
}
