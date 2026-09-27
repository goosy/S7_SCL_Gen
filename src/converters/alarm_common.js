import { make_s7_expression } from "../symbols.js";
import { BOOL, REAL, TIME, ensure_value, nullable_value } from '../s7data.js';
import { isString } from '../gcl.js';
import { isSeq } from 'yaml';
import { elog } from '../util.js';

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
 * - $dead_zone: the dead zone initial value of the analog value
 * - $FT_time: the fault tolerance time initial value
 * @param {object} item
 * @param {import('yaml').Node} node
 * @param {import('yaml').Document} document
 * @returns {void}
 */
export function make_alarms(item, node, document) {
    const info = document.gcl.get_pos_info(...node.range);
    item.$zero = nullable_value(REAL, node.get('$zero')) ?? new REAL(0);
    item.$span = nullable_value(REAL, node.get('$span')) ?? new REAL(100);
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
