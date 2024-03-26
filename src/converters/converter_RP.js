import { posix } from 'node:path';
import { make_s7_expression } from '../symbols.js';
import { context, elog } from '../util.js';
import { STRING, ensure_value, TIME } from '../s7data.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const CP_NAME = 'CP';
export const DP_NAME = 'DP';
export const LOOP_NAME = 'RP_Loop';
const feature = 'RP';

export function is_feature(name) {
    name = name.toUpperCase();
    return name === feature || name === 'RELAY' || name === 'PULSE';
}

const FB_dict = {
    onDelay: 'TON',
    offDelay: 'TOF',
    onPulse: 'TP',
    onDPulse: 'DP',
    changePulse: 'CP',
    changeDPulse: 'DP',
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
        const RP = {
            node,
            comment: new STRING(node.get('comment') ?? '信号近期有变化')
        };
        RP.type = ensure_value(STRING, node.get('type'));
        if (!Object.keys(FB_dict).includes(RP.type?.value)) {
            elog(new SyntaxError(`${document.CPU.name}:RP (${comment}) 的类型 "${RP.type}" 不支持`));
        };
        RP.FB = FB_dict[RP.type.value];
        const DB = node.get('DB');
        if (!DB) elog(new SyntaxError("RP转换必须有DB块!"));
        const comment = RP.comment.value;
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: RP.FB },
                default: { comment },
            },
        ).then(
            symbol => RP.DB = symbol
        );
        make_s7_expression(
            node.get('input'),
            {
                document,
                force: { type: 'BOOL' },
                default: { comment },
                s7_expr_desc: `RP ${comment} input`,
            },
        ).then(
            symbol => RP.IN = symbol
        );
        make_s7_expression(
            node.get('output'),
            {
                document,
                force: { type: 'BOOL' },
                default: { comment },
                s7_expr_desc: `RP ${comment} output`,
            },
        ).then(
            symbol => RP.Q = symbol
        );
        if (RP.type.value === 'onDPulse' || RP.type.value === 'changeDPulse') {
            RP.IncludeFallingEdge = RP.type.value === 'changeDPulse';
        }
        RP.$PT = ensure_value(TIME, node.get('$time') ?? 0);
        // @TODO 增加运行时PT的符号输入
        // RP.PT = ensure_value(TIME, node.get('time') ?? 0);

        return RP;
    });
}

export function gen({ document, options = {} }) {
    const { CPU } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME + '.scl' } = options;
    const dst = `${output_dir}/${output_file}`;
    const tags = { LOOP_NAME };
    const template = posix.join(context.module_path, 'src/converters/RP.template');
    return [{ dst, tags, template }];
}

export function gen_copy_list({ document }) {
    const copy_list = [];
    const IE = 'utf8';
    function push_copy_item(filename) {
        const src = posix.join('RP_Trigger', filename);
        const source = posix.join(context.module_path, src);
        const dst = posix.join(document.CPU.output_dir, filename);
        const distance = posix.join(context.work_path, dst);
        copy_list.push({ src, source, dst, distance, IE });
    }
    push_copy_item(`${CP_NAME}.scl`);
    push_copy_item(`${DP_NAME}.scl`);
    return copy_list;
}
