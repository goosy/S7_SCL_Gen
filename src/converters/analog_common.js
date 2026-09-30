import { make_s7_expression } from "../symbols.js";
import { BOOL, INT, REAL, TIME, ensure_value, nullable_value } from '../s7data.js';
import { isString } from '../gcl.js';
import { isSeq } from 'yaml';
import { elog } from '../util.js';

// Raw values of the nominal range of S7 analog modules
export const S7_ZERO = 0;
export const S7_SPAN = 27648;
// Raw values reserved by AI_Proc as non-measurement markers (e.g. wire break)
export const S7_AI_MIN = -32768;
export const S7_AI_MAX = 32767;
// Hardware high limit of all AO_Proc output modes; the low limit depends on
// the mode, see MODES in converter_AO.js
export const S7_AO_MAX = 32511;

// Defaults written to the instance DB when the $ keys are omitted, so the
// conversion-time checks never depend on the defaults declared in the FBs
export const DEFAULT_ZERO = 0.0;
export const DEFAULT_SPAN = 100.0;
export const DEFAULT_ZERO_RAW = S7_ZERO;
export const DEFAULT_SPAN_RAW = S7_SPAN;
export const DEFAULT_OVERFLOW_SP = 28000;
// AI only; the AO default depends on the mode, see MODES in converter_AO.js
export const DEFAULT_UNDERFLOW_SP = -500;

function get_name(item) {
    if (typeof item === 'string') return item;
    if (isSeq(item)) return get_name(item.items[0]);
    if (Array.isArray(item)) return get_name(item[0]);
    if (isString(item)) return get_name(item.value);
    return undefined;
}

export function make_fake_DB(item) {
    const name = get_name(item);
    if (name) return { name };
    return undefined;
}

/**
 * Convert yaml node to s7 limit check properties.
 * The yaml node is expected to be a mapping with some specific keys:
 * - $zero: the zero initial value of the analog value
 * - $span: the span initial value of the analog value
 * - $enable_HH: bool initial value, whether to enable the high high limit check
 * - enable_HH: bool value, whether to enable the high high limit check
 * - $HH_limit: the high high limit initial value
 * - HH_limit: the high high limit value
 * - $enable_H: bool initial value, whether to enable the high limit check
 * - enable_H: bool value, whether to enable the high limit check
 * - $H_limit: the high limit initial value
 * - H_limit: the high limit value
 * - $enable_L: bool initial value, whether to enable the low limit check
 * - enable_L: bool value, whether to enable the low limit check
 * - $L_limit: the low limit initial value
 * - L_limit: the low limit value
 * - $enable_LL: bool initial value, whether to enable the low low limit check
 * - enable_LL: bool value, whether to enable the low low limit check
 * - $LL_limit: the low low limit initial value
 * - LL_limit: the low low limit value
 * - $enable_AH / $enable_WH / $enable_WL / $enable_AL: bool, whether the
 *   HH / H / L / LL limit exceedance raises an alarm on the upper system,
 *   defaults to true; used by rules only
 * - $dead_zone: the dead zone initial value of the analog value
 * - $FT_time: the fault tolerance time initial value
 * @param {object} item
 * @param {import('yaml').Node} node
 * @param {import('yaml').Document} document
 * @returns {void}
 */
export function make_alarms(item, node, document) {
    const info = document.gcl.get_pos_info(...node.range);
    item.$zero = nullable_value(REAL, node.get('$zero')) ?? new REAL(DEFAULT_ZERO);
    item.$span = nullable_value(REAL, node.get('$span')) ?? new REAL(DEFAULT_SPAN);
    for (const limit of ['HH', 'H', 'L', 'LL']) {
        const enable_str = `enable_${limit}`;
        const $enable_str = `$${enable_str}`;
        const $limit_str = `$${limit}_limit`;
        // as ex: item.$HH_limit
        item[$limit_str] = nullable_value(REAL, node.get($limit_str));
        // as ex: item.$enable_HH
        item[$enable_str] = ensure_value(BOOL, node.get($enable_str) ?? item[$limit_str] != null);
        // as ex: item.enable_HH
        make_s7_expression(
            node.get(enable_str),
            {
                document,
                force: { type: 'BOOL' },
                s7_expr_desc: `${item.DB.name} ${enable_str}`,
            },
        ).then(ret => {
            item[enable_str] = ret;
        });
    }
    // Alarm switches, extracted by rules only, never written to the PLC
    for (const alarm of ['AH', 'WH', 'WL', 'AL']) {
        const $enable_str = `$enable_${alarm}`;
        // as ex: item.$enable_AH
        item[$enable_str] = ensure_value(BOOL, node.get($enable_str) ?? true);
    }
    // limitation validity check
    const HH = item.$HH_limit ?? item.$H_limit ?? item.$L_limit ?? item.$LL_limit;
    const H = item.$H_limit ?? HH;
    const L = item.$L_limit ?? H;
    const LL = item.$LL_limit ?? L;
    if (H > HH || L > H || LL > L)
        elog(`the values of limitation were wrong 定义的限制值有错误\n${info}`);
    item.$dead_zone = nullable_value(REAL, node.get('$dead_zone'));
    item.$FT_time = nullable_value(TIME, node.get('$FT_time'));
}

const PERCENT_RE = /^\s*([+-]?\d+(\.\d+)?)\s*%\s*$/;

/**
 * Convert a raw limit setpoint ($overflow_SP / $underflow_SP) to an INT:
 * a number is the raw value itself, a '<n>%' string is a percentage of the
 * raw range, zero_raw being 0% and span_raw 100%.
 * The '%' must be recognized first, since Integer's parseInt would
 * silently read '105%' as 105.
 * @param {*} value GCL value of the setpoint
 * @param {string} desc description used in error messages
 * @param {number} [zero_raw=S7_ZERO] raw value of 0%
 * @param {number} [span_raw=S7_SPAN] raw value of 100%
 * @returns {INT|undefined}
 */
export function raw_SP(value, desc, zero_raw = S7_ZERO, span_raw = S7_SPAN) {
    if (value === undefined || value === null) return undefined;
    const format_error = new SyntaxError(`${desc} "${value}" 必须是整数原始值或百分比字符串（如 '105%'）`);
    let raw = value;
    if (typeof value === 'string') {
        const match = value.match(PERCENT_RE);
        if (!match) elog(format_error);
        raw = Math.round(zero_raw + Number(match[1]) * (span_raw - zero_raw) / 100);
    } else if (!Number.isInteger(value)) {
        elog(format_error);
    }
    return ensure_value(INT, raw, new SyntaxError(`${desc} "${value}" 超出 INT 范围`));
}
