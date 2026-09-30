import { posix } from 'node:path';
import { is_assignable, make_s7_expression } from '../symbols.js';
import { INT, REAL, STRING, ensure_value, nullable_value } from '../s7data.js';
import { context, elog } from '../util.js';

export const platforms = ['step7', 'portal', 'pcs7']; // platforms supported by this feature
export const NAME = 'AO_Proc';
export const LOOP_NAME = 'AO_Loop';
const feature = 'AO';

// Defaults of the AO_Proc FB, used when the $ keys are omitted
const FB_ZERO = 0.0;
const FB_SPAN = 100.0;
const FB_MODE = 0;
const FB_OVERFLOW_SP = 28000;
// Raw values shared by all output modes
const S7_SPAN = 27648;
const S7_AO_MAX = 32511;

// Output modes of AO_Proc 0.2, indexed by mode:
// raw_zero: raw value at range low, raw_min: hardware low limit,
// def_low: underflow_SP category default used by the FB when omitted
const CAT_OFFSET = { raw_zero: 0, raw_min: -6912, def_low: -500 }; // unipolar with offset
const CAT_UNIPOLAR = { raw_zero: 0, raw_min: 0, def_low: 0 };
const CAT_BIPOLAR = { raw_zero: -27648, raw_min: -32512, def_low: -28000 };
const MODES = [
    { name: '4-20mA', ...CAT_OFFSET },
    { name: '0-20mA', ...CAT_UNIPOLAR },
    { name: '0-10V', ...CAT_UNIPOLAR },
    { name: '1-5V', ...CAT_OFFSET },
    { name: '+-10V', ...CAT_BIPOLAR },
    { name: '+-20mA', ...CAT_BIPOLAR },
];

export function is_feature(name) {
    return name.toUpperCase() === feature;
}

const PERCENT_RE = /^\s*([+-]?\d+(\.\d+)?)\s*%\s*$/;

/**
 * Convert a clamp limit to a raw INT: a number is the raw value itself,
 * a '<n>%' string is a percentage of the nominal full scale S7_SPAN.
 * The '%' must be recognized first, since Integer's parseInt would
 * silently read '105%' as 105.
 * @param {*} value GCL value of $overflow_SP or $underflow_SP
 * @param {string} desc description used in error messages
 * @returns {INT|undefined}
 */
function raw_SP(value, desc) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') {
        const match = value.match(PERCENT_RE);
        if (!match) elog(new SyntaxError(`${desc} "${value}" 必须是整数原始值或百分比字符串（如 '105%'）`));
        return new INT(Math.round(S7_SPAN * Number(match[1]) / 100));
    }
    if (!Number.isInteger(value)) elog(new SyntaxError(`${desc} "${value}" 必须是整数原始值或百分比字符串（如 '105%'）`));
    return ensure_value(INT, value, new SyntaxError(`${desc} "${value}" 超出 INT 范围`));
}

/**
 * Convert $mode to an INT: an index of MODES, or a mode name (case-insensitive)
 * @param {*} value GCL value of $mode
 * @param {string} desc description used in error messages
 * @returns {INT|undefined}
 */
function mode_of(value, desc) {
    if (value === undefined || value === null) return undefined;
    const index = typeof value === 'string'
        ? MODES.findIndex(mode => mode.name.toLowerCase() === value.trim().toLowerCase())
        : Number.isInteger(value) && value >= 0 && value < MODES.length ? value : -1;
    if (index === -1) {
        const names = MODES.map((mode, i) => `${i}|${mode.name}`).join(', ');
        elog(new SyntaxError(`${desc} "${value}" 必须是以下输出模式之一: ${names}`));
    }
    return new INT(index);
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

        AO.$mode = mode_of(node.get('$mode'), `AO (${comment}) 的 $mode`);
        AO.$zero = nullable_value(REAL, node.get('$zero'));
        AO.$span = nullable_value(REAL, node.get('$span'));
        AO.$overflow_SP = raw_SP(node.get('$overflow_SP'), `AO (${comment}) 的 $overflow_SP`);
        AO.$underflow_SP = raw_SP(node.get('$underflow_SP'), `AO (${comment}) 的 $underflow_SP`);
        const $PV = nullable_value(REAL, node.get('$PV'));
        AO.explicit_PV = $PV !== undefined;
        if (AO.explicit_PV) {
            AO.$PV = $PV;
        } else {
            // Default to the engineering value of raw 0, the zero signal of the mode:
            // zero for unipolar, the range midpoint for bipolar.
            // Not written when equal to the FB default 0.0.
            const cat = MODES[AO.$mode?.value ?? FB_MODE];
            const zero = AO.$zero?.value ?? FB_ZERO;
            const span = AO.$span?.value ?? FB_SPAN;
            const PV = zero + (0 - cat.raw_zero) * (span - zero) / (S7_SPAN - cat.raw_zero);
            if (PV !== 0) AO.$PV = new REAL(PV);
        }
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
        const zero = AO.$zero?.value ?? FB_ZERO;
        const span = AO.$span?.value ?? FB_SPAN;
        if (zero === span) {
            elog(new SyntaxError(`${document.CPU.name}:AO (${AO.comment}) 的 zero 与 span 不能相等 (${zero})`));
        }
        // Clamp limits in raw units, bounded by the hardware range of the mode
        const cat = MODES[AO.$mode?.value ?? FB_MODE];
        for (const key of ['$overflow_SP', '$underflow_SP']) {
            const raw = AO[key]?.value;
            if (raw !== undefined && (raw < cat.raw_min || raw > S7_AO_MAX)) {
                elog(new SyntaxError(`${document.CPU.name}:AO (${AO.comment}) 的 ${key} 原始值 ${raw} 超出 ${cat.name} 的输出范围 ${cat.raw_min} ~ ${S7_AO_MAX}`));
            }
        }
        // An omitted $underflow_SP is not written: the FB takes def_low by mode
        const high = AO.$overflow_SP?.value ?? FB_OVERFLOW_SP;
        const low = AO.$underflow_SP?.value ?? cat.def_low;
        if (high <= low) {
            elog(new SyntaxError(`${document.CPU.name}:AO (${AO.comment}) 的限幅上限 (overflow_SP ${high}) 必须大于下限 (underflow_SP ${low})`));
        }
        const PV = AO.$PV?.value;
        const to_PV = raw => zero + (raw - cat.raw_zero) * (span - zero) / (S7_SPAN - cat.raw_zero);
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
