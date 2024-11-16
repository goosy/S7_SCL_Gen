import { make_s7_expression } from "../symbols.js";
import { BOOL, REAL, TIME, ensure_value, nullable_value } from '../s7data.js';
import { isString } from '../gcl.js';
import { isSeq } from 'yaml';
import { elog } from '../util.js';

const event_desc = {
    'AH': '高高报警',
    'WH': '高警告',
    'WL': '低警告',
    'AL': '低低报警'
};

export function make_fake_DB(item) {
    let name = item;
    if (isSeq(item)) name = item.items[0];
    else if (Array.isArray(item)) name = item[0];
    if (isString(name)) name = name.value;
    if (typeof name === 'string') return { name };
    return undefined;
}

/**
 * Convert yaml node to s7 alarm properties and return a list of s7 alarm definitions.
 * The yaml node is expected to be a mapping with some specific keys:
 * - $zero: the zero initial value of the analog value
 * - $span: the span initial value of the analog value
 * - $enable_AH: bool initial value, whether to enable high high alarm
 * - enable_AH: bool value, whether to enable high high alarm
 * - $AH_limit: the high high alarm limit initial value
 * - AH_limit: the high high alarm limit vlaue
 * - $enable_WH: bool initial value, whether to enable high alarm
 * - enable_WH: bool value, whether to enable high alarm
 * - $WH_limit: the high alarm limit initial value
 * - WH_limit: the high alarm limit value
 * - $enable_WL: bool initial value, whether to enable low alarm
 * - enable_WL: bool value, whether to enable low alarm
 * - $WL_limit: the low alarm limit initial value
 * - WL_limit: the low alarm limit value
 * - $enable_AL: bool initial value, whether to enable low low alarm
 * - enable_AL: bool value, whether to enable low low alarm
 * - $AL_limit: the low low alarm limit initial value
 * - AL_limit: the low low alarm limit value
 * - $dead_zone: the dead zone initial value of the analog value
 * - $FT_time: the fault tolerance time initial value
 * @param {import('yaml').ASTNode} node
 * @param {import('../gcl.js').GCL} gcl
 * @param {import('../gcl.js').Document} document
 * @returns {void}
 */
export function make_alarms(item, node, document) {
    const { CPU, gcl } = document;
    const tag = `${CPU.S7Program}/${item.DB.name}`;
    const info = gcl.get_pos_info(...node.range);

    item.$zero = nullable_value(REAL, node.get('$zero')) ?? new REAL(0);
    item.$span = nullable_value(REAL, node.get('$span')) ?? new REAL(100);
    for (const limit of ['AH', 'WH', 'WL', 'AL']) {
        const enable_str = `enable_${limit}`;
        const $enable_str = `$${enable_str}`;
        const $limit_str = `$${limit}_limit`;
        // as ex: item.$AH_limit
        item[$limit_str] = nullable_value(REAL, node.get($limit_str));
        // as ex: item.$enable_AH
        item[$enable_str] = ensure_value(BOOL, node.get($enable_str) ?? item[$limit_str] != null);
        if (item[$enable_str].value) {
            item.alarms.push({
                tagname: `${tag}.${limit}_flag`,
                location: item.location,
                event: `${item.type}${event_desc[limit]}`,
                PV1: `${tag}.${limit}_PV`,
            });
        }
        // as ex: item.enable_AH
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
    const AH = item.$AH_limit ?? item.$WH_limit ?? item.$WL_limit ?? item.$AL_limit;
    const WH = item.$WH_limit ?? AH;
    const WL = item.$WL_limit ?? WH;
    const AL = item.$AL_limit ?? WL;
    if (WH > AH || WL > WH || AL > WL)
        elog(`the values of limitation were wrong 定义的限制值有错误\n${info}`);
    item.$dead_zone = nullable_value(REAL, node.get('$dead_zone'));
    item.$FT_time = nullable_value(TIME, node.get('$FT_time'));
}
