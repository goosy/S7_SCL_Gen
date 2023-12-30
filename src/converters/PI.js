/**
 * 高速脉冲计数处理
 * 依照3阶段提供3个函数， get_symbols_PI build_PI gen_PI
 * @file PI
 */

import { context } from '../util.js';
import { STRING, PINT, PDINT, ensure_value, nullable_value } from '../value.js';
import { make_s7express } from '../symbols.js';
import { posix } from 'path';
import assert from 'assert/strict';

export const platforms = ['step7']; // platforms supported by this feature
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
// FM350-2专用数据块{{module.count_DB.value}}
DATA_BLOCK {{module.count_DB.value}} "{{FM3502_CNT_NAME}}"
BEGIN
    MOD_ADR := {{module.module_no.wordHEX}}; // FM350-2模块地址
    CH_ADR := {{module.channel_no.dwordHEX}}; // 通道地址，即模块地址乘8
END_DATA_BLOCK{{#endfor module}}

// 主调用
FUNCTION "{{LOOP_NAME}}" : VOID{{#if loop_begin}}
{{loop_begin}}

{{#endif}}{{#for no, module in modules}}
// {{no+1}}. {{module.model}} {{module.comment}}
"{{NAME}}".{{module.DB.value}}(DB_NO := {{module.count_DB.block_no}}); // DB_NO指向{{module.count_DB.value}}{{
#endfor module}}{{#if loop_end}}

{{loop_end}}{{#endif}}
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
export function initialize_list(area) {
    const document = area.document;
    const CPU = document.CPU;
    const options = area.options;
    area.list = area.list.map((node, index) => {
        const module = {
            node,
            comment: new STRING(node.get('comment') ?? ''),
            model: ensure_value(STRING, node.get('model') ?? FM3502_CNT_NAME), // 目前只支持FM350-2
        };

        const comment = module.comment.value;

        const type = (model => {
            if (model === FM3502_CNT_NAME) {
                options.has_FM3502 = true;
                return NAME;
            }
            throw new SyntaxError(`${CPU.name}: PI: module${comment} 的类型 "${module.model}" 不支持`);
        })(module.model.value);

        const DB = node.get('DB');
        assert(DB, new SyntaxError(`${CPU.name}:PI 第${index + 1}个 module 没有正确定义背景块!`));
        make_s7express(module, 'DB', DB, document, { force: { type }, default: { comment } });

        const module_symbol = node.get('module');
        const module_addr = nullable_value(PINT, node.get('module_addr'));
        assert(module_symbol || module_addr, new SyntaxError(`${CPU.name}:PI 第${index}个模块未提供 module 或 module_addr!`));
        make_s7express(
            module,
            'module',
            module_symbol ?? [`PI${index + 1}_addr`, `IW${module_addr.value}`],
            document,
            { link: true, force: { type: 'WORD' }, default: { comment: 'HW module address' } }
        );

        const count_DB = node.get('count_DB');
        assert(count_DB, new SyntaxError(`${CPU.name}:PI 第${index + 1}个 module 没有正确定义专用数据块!`));
        make_s7express(module, 'count_DB', count_DB, document, { force: { type: FM3502_CNT_NAME } });

        return module;
    });
}

/**
 * 第二遍扫描 建立数据并查错
 * @date 2021-12-07
 * @param {S7Item} PI
 * @returns {void}
 */
export function build_list({ document, list }) {
    const CPU = document.CPU;
    list.forEach(module => { // 处理配置，形成完整数据
        assert.equal(typeof module.module?.block_no, 'number', new SyntaxError(`${CPU.name}:PI 的模块(${module.comment}) 模块地址有误!`));
        const MNO = module.module.block_no;
        module.module_no = new PINT(MNO * 1);
        module.channel_no = new PDINT(MNO * 8);
    });
}

export function gen(PI_list) {
    const rules = [];
    PI_list.forEach(({ document, includes, loop_begin, loop_end, list: modules, options }) => {
        const { CPU, gcl } = document;
        const { output_dir } = CPU;
        const { output_file = LOOP_NAME } = options;
        rules.push({
            "name": `${output_dir}/${output_file}.scl`,
            "tags": {
                modules,
                includes,
                loop_begin,
                loop_end,
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