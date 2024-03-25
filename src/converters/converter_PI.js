/**
 * 高速脉冲计数处理
 * 依照3阶段提供3个函数， get_symbols_PI build_PI gen_PI
 * @file PI
 */

import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { context, elog } from '../util.js';
import { STRING, PINT, PDINT, ensure_value, nullable_value } from '../s7data.js';
import { make_s7_expression } from '../symbols.js';

export const platforms = ['step7']; // platforms supported by this feature
export const NAME = 'PI_Proc';
export const LOOP_NAME = 'PI_Loop';
export const FM3502_CNT_NAME = 'FM350-2';
const feature = 'PI';

export function is_feature(name) {
    return name.toUpperCase() === feature;
}

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
            elog(new SyntaxError(`${CPU.name}: PI: module${comment} 的类型 "${module.model}" 不支持`));
        })(module.model.value);

        const DB = node.get('DB');
        assert(DB, new SyntaxError(`${CPU.name}:PI 第${index + 1}个 module 没有正确定义背景块!`));
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type },
                default: { comment },
            },
        ).then(
            symbol => module.DB = symbol
        );

        let module_symbol = node.get('module');
        const module_addr = nullable_value(PINT, node.get('module_addr'));
        assert(module_symbol || module_addr, new SyntaxError(`${CPU.name}:PI 第${index}个模块未提供 module 或 module_addr!`));
        module_symbol ??= [`PI${index + 1}_addr`, `IW${module_addr.value}`];
        make_s7_expression(
            module_symbol,
            {
                document,
                disallow_s7express: true,
                force: { type: 'WORD' },
                default: { comment: 'HW module address' },
            },
        ).then(
            symbol => module.module = symbol
        );

        const count_DB = node.get('count_DB');
        assert(count_DB, new SyntaxError(`${CPU.name}:PI 第${index + 1}个 module 没有正确定义专用数据块!`));
        make_s7_expression(
            count_DB,
            {
                document,
                disallow_s7express: true,
                force: { type: FM3502_CNT_NAME },
            },
        ).then(
            symbol => module.count_DB = symbol
        );

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

export function gen({ document, options = {} }) {
    const { CPU } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME + '.scl' } = options;
    const dst = `${output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME, FM3502_CNT_NAME };
    const template = 'PI.template';
    return [{ dst, tags, template }];
}

export function gen_copy_list({ document }) {
    const src = posix.join(NAME, `${NAME}.scl`);
    const source = posix.join(context.module_path, src);
    const dst = posix.join(document.CPU.output_dir, `${NAME}.scl`);
    const distance = posix.join(context.work_path, dst);
    const IE = 'utf8';
    return [{ src, source, dst, distance, IE }];
}