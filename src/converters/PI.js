/**
 * 高速脉冲计数处理
 * 依照3阶段提供3个函数， get_symbols_PI build_PI gen_PI
 * @file PI
 */

import { fixed_hex, context } from '../util.js';
import { make_prop_symbolic } from '../symbols.js';
import { posix } from 'path';

export const platforms = ['step7'];
export const NAME = 'PI_Proc';
export const LOOP_NAME = 'PI_Loop';
export const FM3502_CNT_NAME = 'FM350-2';

export function is_feature(feature) {
  return feature.toUpperCase() === 'PI';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{document.gcl.file}}
// 摘要: {{document.gcl.MD5}}
{{includes}}
{{#for module in modules}}
// FM350-2专用数据块"{{module.count_DB.name}}"
DATA_BLOCK "{{module.count_DB.name}}" "{{FM3502_CNT_NAME}}"
BEGIN
  MOD_ADR := W#16#{{module.module_no}}; // FM350-2模块地址
  CH_ADR := DW#16#{{module.channel_no}}; // 通道地址，即模块地址乘8
END_DATA_BLOCK{{#endfor module}}


// 主调用
FUNCTION "{{LOOP_NAME}}" : VOID
{{#for no, module in modules}}
// {{no+1}}. {{module.model}} {{module.comment}}
"{{NAME}}"."{{module.DB.name}}"(DB_NO := {{module.count_DB.block_no}}); // DB_NO指向"{{module.count_DB.name}}"
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
export function parse_symbols({ CPU, list, options }) {
  const document = CPU.PI;
  let index = 0;
  list.forEach(module => {
    if (!module?.DB) throw Error(`${CPU.name}:PI:module(${module.module_addr ?? module.comment}) 没有正确定义背景块!`);
    module.model ??= FM3502_CNT_NAME; // 目前只支持FM350-2
    let model = 'nomodel';
    if (module.model === FM3502_CNT_NAME) {
      options.has_FM3502 = true;
      model = NAME;
    }
    if (model === 'nomodel') throw new Error(`${CPU.name}:PI:module${module.module_addr} 的类型 "${module.model}" 不支持`);
    module.module_addr = [
      `${module.model}_${++index}_addr`,
      'IW' + module.module_addr,
      'WORD',
      'FM350-2 address'
    ];
    make_prop_symbolic(module, 'module_addr', CPU, { document });
    make_prop_symbolic(module, 'DB', CPU, { document, force: { type: model }, default: { comment: module.comment } });
    make_prop_symbolic(module, 'count_DB', CPU, { document, force: { type: FM3502_CNT_NAME } });
  });
}

/**
 * 第二遍扫描 建立数据并查错
 * @date 2021-12-07
 * @param {S7Item} PI
 * @returns {void}
 */
export function build(PI) {
  const { CPU, list } = PI;
  list.forEach(module => { // 处理配置，形成完整数据
    if (Array.isArray(module.module_addr)) throw Error(`${CPU.name}:PI 的模块${module?.DB.name}未提供 module_addr 或提供错误!`);
    const MNO = module.module_addr.block_no;
    module.module_no = fixed_hex(MNO * 1, 4);
    module.channel_no = fixed_hex(MNO * 8, 8);
  });
}

export function gen(PI_list) {
  const rules = [];
  PI_list.forEach(({ CPU, includes, loop_additional_code, list: modules, options }) => {
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME } = options;
    const document = CPU.PI;
    rules.push({
      "name": `${output_dir}/${output_file}.scl`,
      "tags": {
        modules,
        includes,
        loop_additional_code,
        NAME,
        LOOP_NAME,
        FM3502_CNT_NAME,
        document,
      }
    })
  });
  return [{ rules, template }];
}

export function gen_copy_list(item) {
  const filename = `${NAME}.scl`;
  const src = posix.join(context.module_path, NAME, filename);
  const dst = posix.join(context.work_path, item.CPU.output_dir, filename);
  return [{ src, dst }];
}