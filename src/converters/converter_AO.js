import { posix } from 'node:path';
import { is_assignable, make_s7_expression } from '../symbols.js';
import { REAL, STRING, ensure_value, nullable_value } from '../s7data.js';
import { context, elog } from '../util.js';
import {
    DEFAULT_OVERFLOW_SP, DEFAULT_SPAN, DEFAULT_UNDERFLOW_SP, DEFAULT_ZERO, S7_AO_MAX, S7_AO_MIN, S7_SPAN,
    raw_SP,
} from './analog_common.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = 'AO_Proc';
export const LOOP_NAME = 'AO_Loop';
const feature = 'AO';

export function is_feature(name) {
    return name.toUpperCase() === feature;
}

/**
 * First scan to extract symbols
 * @param {Area} area
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const comment = ensure_value(STRING, node.get('comment') ?? '').value;
        const AO = { node, comment };
        const DB = node.get('DB');
        if (!DB) return AO; // An AO without DB is not processed

        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(ret => { AO.DB = ret; });
        make_s7_expression(
            node.get('PV'),
            {
                document,
                force: { type: 'REAL' },
                default: { comment },
                s7_expr_desc: `AO ${comment} PV`,
            },
        ).then(ret => { AO.PV = ret; });
        make_s7_expression(
            node.get('output'),
            {
                document,
                force: { type: 'WORD' },
                default: { comment },
                s7_expr_desc: `AO ${comment} output`,
            },
        ).then(ret => { AO.output = ret; });

        // These keys are always written to the instance DB, defaults included
        AO.$zero = new REAL(node.get('$zero') ?? DEFAULT_ZERO);
        AO.$span = new REAL(node.get('$span') ?? DEFAULT_SPAN);
        AO.$overflow_SP = raw_SP(node.get('$overflow_SP') ?? DEFAULT_OVERFLOW_SP, `AO (${comment}) 的 $overflow_SP`);
        AO.$underflow_SP = raw_SP(node.get('$underflow_SP') ?? DEFAULT_UNDERFLOW_SP, `AO (${comment}) 的 $underflow_SP`);
        const $PV = nullable_value(REAL, node.get('$PV'));
        AO.explicit_PV = $PV !== undefined;
        AO.$PV = $PV ?? AO.$zero;
        AO.extra_code = nullable_value(STRING, node.get('extra_code'))?.value;

        return AO;
    });
}

/**
 * Second scan: validate output and range
 * @param {Area} area
 * @returns {void}
 */
export function build_list({ document, list }) {
    for (const AO of list) {
        if (!AO.DB) continue;
        const output = AO.output;
        // biome-ignore lint/suspicious/noDoubleEquals: may be null
        if (output != undefined && !is_assignable(output)) {
            elog(new SyntaxError(`${document.CPU.name}:AO (${AO.comment}) 的 output "${output.value}" 必须是可赋值的 WORD 变量，不能是常量或表达式`));
        }
        const zero = AO.$zero.value;
        const span = AO.$span.value;
        if (zero === span) {
            elog(new SyntaxError(`${document.CPU.name}:AO (${AO.comment}) 的 zero 与 span 不能相等 (${zero})`));
        }
        // Clamp limits in raw units
        for (const key of ['$overflow_SP', '$underflow_SP']) {
            const raw = AO[key].value;
            if (raw < S7_AO_MIN || raw > S7_AO_MAX) {
                elog(new SyntaxError(`${document.CPU.name}:AO (${AO.comment}) 的 ${key} 原始值 ${raw} 超出输出范围 ${S7_AO_MIN} ~ ${S7_AO_MAX}`));
            }
        }
        const high = AO.$overflow_SP.value;
        const low = AO.$underflow_SP.value;
        if (high <= low) {
            elog(new SyntaxError(`${document.CPU.name}:AO (${AO.comment}) 的限幅上限 (overflow_SP ${high}) 必须大于下限 (underflow_SP ${low})`));
        }
        const PV = AO.$PV.value;
        const to_PV = raw => zero + raw * (span - zero) / S7_SPAN;
        const PV_high = to_PV(high);
        const PV_low = to_PV(low);
        if (AO.explicit_PV && (PV < Math.min(PV_low, PV_high) || PV > Math.max(PV_low, PV_high))) {
            console.error(`warning: 警告：
        info 信息: $PV ${PV} is outside the clamp range ${PV_low} ~ ${PV_high}. $PV 超出限幅范围，会被限幅
        file 文件:"${document.gcl.file}"
        item 条目:AO (${AO.comment})`);
        }
    }
}

export function gen({ document, options = {} }) {
    const output_dir = context.work_path;
    const { output_file = `${LOOP_NAME}.scl` } = options;
    const distance = `${document.CPU.output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME };
    const template = 'AO.template';
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
