import { posix } from 'node:path';
import { make_s7_expression } from '../symbols.js';
import { STRING } from '../s7data.js';
import { context, elog } from '../util.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = `Timer_Proc`;
export const LOOP_NAME = 'Timer_Loop';
const feature = 'timer';

export function is_feature(name) {
    return name.toLowerCase() === feature;
}

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const timer = {
            node,
            comment: new STRING(node.get('comment') ?? '')
        };
        const DB = node.get('DB');
        if (!DB) elog(new SyntaxError("timer转换必须有DB块!"));
        const comment = timer.comment.value;
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(
            symbol => timer.DB = symbol
        );

        const infos = {
            document,
            force: { type: 'BOOL' },
            s7_expr_desc: `timer ${comment}`,
        };
        make_s7_expression(node.get('enable'), infos).then(symbol => timer.enable = symbol);
        make_s7_expression(node.get('reset'), infos).then(symbol => timer.reset = symbol);
        make_s7_expression(node.get('PPS') ?? "Clock_1Hz", infos).then(symbol => timer.PPS = symbol);
        return timer;
    });
}

export function gen({ document, options = {} }) {
    const { CPU } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME + '.scl' } = options;
    const rules = [{
        "name": `${output_dir}/${output_file}`,
        "tags": {
            NAME,
            LOOP_NAME,
        }
    }];
    return [{ rules }];
}

export function gen_copy_list(item) {
    const filename = item.document.CPU.platform == 'portal' ? `${NAME}(portal).scl` : `${NAME}.scl`;
    const src = {
        filename: posix.join(context.module_path, NAME, filename),
        encoding: 'utf8',
    };
    const dst = posix.join(context.work_path, item.document.CPU.output_dir, `${NAME}.scl`);
    return [{ src, dst }];
}
