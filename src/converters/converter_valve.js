import { posix } from 'node:path';
import { make_s7_expression } from '../symbols.js';
import { BOOL, INT, REAL, STRING, TIME, ensure_value, nullable_value } from '../s7data.js';
import { context } from '../util.js';

export const platforms = ['step7', 'pcs7', 'portal']; // platforms supported by this feature
export const NAME = 'Valve_Proc';
export const LOOP_NAME = 'Valve_Loop';
const feature = 'valve';

export function is_feature(name) {
    return name.toLowerCase() === feature;
}

/**
 * First scan to extract symbols
 * @param {S7Item} valve_area
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const valve = {
            node,
            comment: new STRING(node.get('comment') ?? '')
        };
        const comment = valve.comment.value;
        const DB = node.get('DB');
        if (!DB) return valve; // Empty valves are not processed
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(symbol => {
            valve.DB = symbol;
        });
        const AI = node.get('AI');
        const _comment = comment ? `${comment} AI` : '';
        make_s7_expression(
            AI,
            {
                document,
                force: { type: 'WORD' },
                default: { comment: _comment },
                s7_expr_desc: `valve ${_comment}`,
            },
        ).then(symbol => {
            valve.AI = symbol;
        });

        const props = ['CP', 'OP', 'error', 'remote', 'close_action', 'open_action', 'stop_action', 'control_action'];
        for (const prop of props) {
            const _comment = comment ? `${comment} ${prop}` : '';
            const value = node.get(prop);
            if (value !== undefined) make_s7_expression(
                value,
                {
                    document,
                    force: { type: 'BOOL' },
                    default: { comment: _comment },
                    s7_expr_desc: `valve ${comment} ${prop}`,
                },
            ).then(symbol => {
                valve[prop] = symbol;
            });
        }

        valve.$zero_raw = nullable_value(INT, node.get('$zero_raw'));
        valve.$span_raw = nullable_value(INT, node.get('$span_raw'));
        valve.$overflow_SP = nullable_value(INT, node.get('$overflow_SP'));
        valve.$underflow_SP = nullable_value(INT, node.get('$underflow_SP'));
        valve.$FT_zone = nullable_value(REAL, node.get('$FT_zone'));
        valve.$action_time = nullable_value(TIME, node.get('$action_time'));
        valve.$signal_time = nullable_value(TIME, node.get('$signal_time'));

        return valve;
    });
}

export function gen({ document, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME };
    const template = posix.join(context.module_path, 'src/converters/valve.template');
    return [{ distance, output_dir, tags, template }];
}

export function gen_copy_list({ document }) {
    const source = posix.join(NAME, `${NAME}(${document.CPU.platform}).scl`);
    const input_dir = context.module_path;
    const distance = posix.join(document.CPU.output_dir, `${NAME}.scl`);
    const output_dir = context.work_path;
    const IE = 'utf8';
    return [{ source, input_dir, distance, output_dir, IE }];
}