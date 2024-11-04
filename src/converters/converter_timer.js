import { posix } from 'node:path';
import { make_s7_expression } from '../symbols.js';
import { STRING } from '../s7data.js';
import { context, elog } from '../util.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = 'Timer_Proc';
export const LOOP_NAME = 'Timer_Loop';
const feature = 'timer';

export function is_feature(name) {
    return name.toLowerCase() === feature;
}

/**
 * First scan to extract symbols
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
        ).then(symbol => {
            timer.DB = symbol;
        });

        const infos = {
            document,
            force: { type: 'BOOL' },
            s7_expr_desc: `timer ${comment}`,
        };
        make_s7_expression(node.get('enable'), infos).then(
            symbol => { timer.enable = symbol; }
        );
        make_s7_expression(node.get('reset'), infos).then(
            symbol => { timer.reset = symbol; }
        );
        make_s7_expression(node.get('PPS') ?? "Clock_1Hz", infos).then(
            symbol => { timer.PPS = symbol; }
        );
        return timer;
    });
}

export function gen({ document, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME };
    const template = posix.join(context.module_path, 'src/converters/timer.template');
    return [{ distance, output_dir, tags, template }];
}

export function gen_copy_list({ document }) {
    const filename = document.CPU.platform === 'portal' ? `${NAME}(portal).scl` : `${NAME}.scl`;
    const source = posix.join(NAME, filename);
    const input_dir = context.module_path;
    const distance = posix.join(document.CPU.output_dir, `${NAME}.scl`);
    const output_dir = context.work_path;
    const IE = 'utf8';
    return [{ source, input_dir, distance, output_dir, IE }];
}
