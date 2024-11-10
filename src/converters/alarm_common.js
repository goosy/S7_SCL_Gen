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

export function make_alarm_props(item, node, document) {
    const { CPU, gcl } = document;
    const tag = `${CPU.S7Program}/${item.DB.name}`;
    const alarms_list = [];
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
            alarms_list.push({
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

    return alarms_list;
}
