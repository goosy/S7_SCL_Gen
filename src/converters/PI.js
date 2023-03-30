/**
 * 高速脉冲计数处理
 * 依照3阶段提供3个函数， get_symbols_PI build_PI gen_PI
 * @file PI
 */

import { context } from '../util.js';
import { fixed_hex, STRING, ensure_typed_value, nullable_PINT } from '../value.js';
import { make_prop_symbolic } from '../symbols.js';
import { posix } from 'path';
import assert from 'assert/strict';

export const platforms = ['step7'];
export const NAME = 'PI_Proc';
export const LOOP_NAME = 'PI_Loop';
export const FM3502_CNT_NAME = 'FM350-2';

export function is_feature(feature) {
  return feature.toUpperCase() === 'PI';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
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
export function parse_symbols(area) {
  const document = area.document;
  const CPU = document.CPU;
  const options = area.options;
  const list = area.list.map(item => item.toJSON());
  area.list = list;
  let index = 0;
  list.forEach(module => {
    module.comment = new STRING(module.comment ?? '');
    const comment = module.comment.value;
    ++index;
    if (!module?.DB) throw new Error(`${CPU.name}:PI 第${index}个module(${comment}) 没有正确定义数据块!`);

    let type = '';
    const model = ensure_typed_value(STRING, module.model ??= FM3502_CNT_NAME).value; // 目前只支持FM350-2
    if (model === FM3502_CNT_NAME) {
      options.has_FM3502 = true;
      type = NAME;
    } else {
      model = null;
    }
    if (model === null) throw new Error(`${CPU.name}:PI:module${comment} 的类型 "${module.model}" 不支持`);
    module.model = model;

    const module_addr = nullable_PINT(module.module_addr);
    assert(module.module || module_addr, new SyntaxError(`${CPU.name}:PI 第${index}个module(${comment}) 未提供 module 或 module_addr!`));
    module.module ??= [
      `PI${index}_addr`,
      `IW${module_addr.value}`,
      'WORD',
      'HW module address'
    ];
    module.module[3] ??= 'HW module address';

    make_prop_symbolic(module, 'module', document);
    make_prop_symbolic(module, 'DB', document, { force: { type }, default: { comment } });
    make_prop_symbolic(module, 'count_DB', document, { force: { type: FM3502_CNT_NAME } });
  });
}

/**
 * 第二遍扫描 建立数据并查错
 * @date 2021-12-07
 * @param {S7Item} PI
 * @returns {void}
 */
export function build({ document, list }) {
  const CPU = document.CPU;
  list.forEach(module => { // 处理配置，形成完整数据
    assert.equal(typeof module.module?.block_no, 'number', new SyntaxError(`${CPU.name}:PI 的模块(${module.comment}) 模块地址有误!`));
    const MNO = module.module.block_no;
    module.module_no = fixed_hex(MNO * 1, 4);
    module.channel_no = fixed_hex(MNO * 8, 8);
  });
}

export function gen(PI_list) {
  const rules = [];
  PI_list.forEach(({ document, includes, loop_additional_code, list: modules, options }) => {
    const { CPU, gcl } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME } = options;
    rules.push({
      "name": `${output_dir}/${output_file}.scl`,
      "tags": {
        modules,
        includes,
        loop_additional_code,
        NAME,
        LOOP_NAME,
        FM3502_CNT_NAME,
        gcl,
      }
    })
  });
  return [{ rules, template }];
}

export function gen_copy_list(item) {
  const filename = `${NAME}.scl`;
  const src = posix.join(context.module_path, NAME, filename);
  const dst = posix.join(context.work_path, item.document.CPU.output_dir, filename);
  return [{ src, dst }];
}