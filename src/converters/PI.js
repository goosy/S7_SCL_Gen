/**
 * 高速脉冲计数处理
 * 依照3阶段提供3个函数， get_symbols_PI build_PI gen_PI
 * @file PI
 */

import { fixed_hex } from "../util.js";
import { make_prop_symbolic } from '../symbols.js';
import { join } from 'path';

export const PI_NAME = 'PI_Proc';
export const PI_LOOP_NAME = 'PI_Loop';
export const FM3502_CNT_NAME = 'FM350-2';
export const PI_BUILDIN = [
    [PI_NAME, 'FB350', PI_NAME, 'PI main FB'],
    [PI_LOOP_NAME, "FC350", PI_LOOP_NAME, 'main PI cyclic call function'],
    [FM3502_CNT_NAME, "UDT350", FM3502_CNT_NAME, 'FM350-2 count DB'],
];
export function is_type_PI(type) {
    return type.toUpperCase() === 'PI';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 依据配置 "{{name}}" 自动生成。 author: goosy.jo@gmail.com
{{includes}}
{{#for module in modules}}
// FM350-2专用数据块"{{module.count_DB.name}}"
DATA_BLOCK "{{module.count_DB.name}}" "{{FM3502_CNT_NAME}}"
BEGIN
  MOD_ADR := W#16#{{module.module_no}}; // FM350-2模块地址
  CH_ADR := DW#16#{{module.channel_no}}; // 通道地址，即模块地址乘8
END_DATA_BLOCK{{#endfor module}}


// 主调用
FUNCTION "{{PI_LOOP_NAME}}" : VOID
{{#for no, module in modules}}
// {{no+1}}. {{module.type}} {{module.comment}}
"{{PI_NAME}}"."{{module.DB.name}}"(DB_NO := {{module.count_DB.block_no}}); // DB_NO指向"{{module.count_DB.name}}"
{{#endfor module}}{{#if loop_additional_code}}
{{loop_additional_code}}{{#endif}}
END_FUNCTION
`;

/**
 * @typedef {object} S7Item
 * @property {Object} CPU
 * @property {Array} list
 * @property {Object} Options
 * @property {Array|string} includes
 */

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-14
 * @param {S7Item} VItem
 * @returns {void}
 */
export function parse_symbols_PI({ CPU, list, options }) {
    const document = CPU.PI;
    let index = 0;
    list.forEach(module => {
        if (!module?.DB) throw Error(`${CPU.name}:SC:module(${module.module_addr ?? module.comment}) 没有正确定义背景块!`);
        module.type ??= 'FM350-2';
        let type = 'notype';
        if (module.type === 'FM350-2') {
            options.has_FM3502 = true;
            type = PI_NAME;
        }
        if (type === 'notype') throw new Error(`${CPU.name}:SC:module${module.module_addr} 的类型 "${module.type}" 不支持`);
        module.module_addr = [`${module.type}_${++index}_addr`, 'IW' + module.module_addr];
        make_prop_symbolic(module, 'module_addr', CPU, { document, range: [0, 0, 0], default_type: 'WORD' });
        make_prop_symbolic(module, 'DB', CPU, { document, range: [0, 0, 0], default_type: type });
        make_prop_symbolic(module, 'count_DB', CPU, { document, range: [0, 0, 0], default_type: FM3502_CNT_NAME });
    });
}

/**
 * 第二遍扫描 建立数据并查错
 * @date 2021-12-07
 * @param {S7Item} PI
 * @returns {void}
 */
export function build_PI(PI) {
    const { CPU, list } = PI;
    list.forEach(module => { // 处理配置，形成完整数据
        if (Array.isArray(module.module_addr)) throw Error(`${CPU.name}:PI 的模块${module?.DB.name}未提供 module_addr 或提供错误!`);
        const MNO = module.module_addr.block_no;
        module.module_no = fixed_hex(MNO, 4);
        module.channel_no = fixed_hex(MNO * 8, 8);
    });
}

export function gen_PI(PI_list) {
    const rules = [];
    PI_list.forEach(({ CPU, includes, loop_additional_code, list: modules, options }) => {
        const { name, output_dir } = CPU;
        const { output_file = PI_LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                name,
                modules,
                includes,
                loop_additional_code,
                PI_NAME,
                PI_LOOP_NAME,
                FM3502_CNT_NAME,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_PI_copy_list(item) {
    const output_dir = item.CPU.output_dir;
    return [{
        src: `PI_Proc/${PI_NAME}.scl`,
        dst: `${output_dir}/`,
        desc: `${join(process.cwd(), output_dir, PI_NAME)}.scl`,
    }];
}