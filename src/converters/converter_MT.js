import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { isSeq } from 'yaml';
import { make_s7_expression } from '../symbols.js';
import {
    BOOL, PINT, STRING, TIME,
    nullable_value, ensure_value,
    IntHashList
} from '../s7data.js';
import { context, fixed_hex, elog } from '../util.js';

export const platforms = ['step7']; // platforms supported by this feature
export const NAME = 'MT_Poll';
export const LOOP_NAME = 'MT_Loop';
export const POLLS_NAME = 'MT_polls_DB';
const feature = 'modbusTCP';

const DEFAULT_DEVICE_ID = "B#16#02"; //默认的设备号
const device_id = { // 只需要填写设备型号
    "IM151-8_PN/DP": "B#16#01",
    "CPU31x-2_PN/DP": "B#16#02",
    "CPU314C-2_PN/DP": "B#16#02",
    "IM154-8_PN/DP": "B#16#02",
    "CPU315T-3_PN/DP": "B#16#03",
    "CPU317T-3_PN/DP": "B#16#03",
    "CPU317TF-3_PN/DP": "B#16#03",
    "CPU412-2_PN": "B#16#05",
    "CPU414-3_PN/DP": "B#16#05",
    "CPU416-3_PN/DP": "B#16#05",
}
const device_X_id = { // 可能需要填写槽号的
    //['', 'X2', 'X4']
    "CPU317-2_PN/DP": "B#16#02",
    "CPU317-2_PN/DP_X2": "B#16#02",
    "CPU317-2_PN/DP_X4": "B#16#04",
    //['', 'X3', 'X4']
    "CPU319-3_PN/DP": "B#16#03",
    "CPU319-3_PN/DP_X3": "B#16#03",
    "CPU319-3_PN/DP_X4": "B#16#04",
}
const device_R_X_id = { // 可能需要填写槽号和机架号的
    // ['', 'R0', 'R1'] × ['', 'X5']
    // 412-5H
    "CPU412-5H_PN/DP": "B#16#05",
    "CPU412-5H_PN/DP_X5": "B#16#05",
    "CPU412-5H_PN/DP_R0": "B#16#05",
    "CPU412-5H_PN/DP_R0_X5": "B#16#05",
    "CPU412-5H_PN/DP_R1": "B#16#15",
    "CPU412-5H_PN/DP_R1_X5": "B#16#15",
    // 414-5H
    "CPU414-5H_PN/DP": "B#16#05",
    "CPU414-5H_PN/DP_X5": "B#16#05",
    "CPU414-5H_PN/DP_R0": "B#16#05",
    "CPU414-5H_PN/DP_R0_X5": "B#16#05",
    "CPU414-5H_PN/DP_R1": "B#16#15",
    "CPU414-5H_PN/DP_R1_X5": "B#16#15",
    // 416-5H
    "CPU416-5H_PN/DP": "B#16#05",
    "CPU416-5H_PN/DP_X5": "B#16#05",
    "CPU416-5H_PN/DP_R0": "B#16#05",
    "CPU416-5H_PN/DP_R0_X5": "B#16#05",
    "CPU416-5H_PN/DP_R1": "B#16#15",
    "CPU416-5H_PN/DP_R1_X5": "B#16#15",
    // 417-5H
    "CPU417-5H_PN/DP": "B#16#05",
    "CPU417-5H_PN/DP_X5": "B#16#05",
    "CPU417-5H_PN/DP_R0": "B#16#05",
    "CPU417-5H_PN/DP_R0_X5": "B#16#05",
    "CPU417-5H_PN/DP_R1": "B#16#15",
    "CPU417-5H_PN/DP_R1_X5": "B#16#15",
    // 410-5H  ['', 'R0', 'R1'] × ['', 'X5', 'X8']
    "CPU410-5H": "B#16#05",
    "CPU410-5H_X5": "B#16#05",
    "CPU410-5H_X8": "B#16#08",
    "CPU410-5H_R0": "B#16#05",
    "CPU410-5H_R0_X5": "B#16#05",
    "CPU410-5H_R0_X8": "B#16#08",
    "CPU410-5H_R1": "B#16#15",
    "CPU410-5H_R1_X5": "B#16#15",
    "CPU410-5H_R1_X8": "B#16#18",
}

export function is_feature(name) {
    name = name.toLowerCase();
    return name === 'mt' || name === 'modbustcp';
}

function get_device_id(device, R, X) {
    let id = device_id[device];
    if (id) return id; // device is valid
    const device_paras = [device];
    if (R) {
        device_paras.push(R);
    }
    if (X) {
        id = device_X_id[`${device}_${X}`];
        if (id) return id; // device_X is valid
        device_paras.push(X);
    }
    id = device_R_X_id[device_paras.join('_')]
    if (id) return id; // device_R_X is valid
    return null; // 没有对应设备号
}

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    const CPU = document.CPU;
    // CPU.device 必须第二遍扫描才有效
    area.list = area.list.map(node => {
        const conn = {
            node,
            ID: nullable_value(PINT, node.get('ID')),
            name: nullable_value(STRING, node.get('name') ?? node.get('polls_name')),
            comment: new STRING(node.get('comment') ?? '')
        };
        const comment = conn.comment.value;
        const name = conn.name?.value;
        const DB = node.get('DB');
        assert(DB, new SyntaxError(
            `${CPU.name}:MT:conn(${name ?? conn.ID}) DB is not defined correctly! 没有正确定义DB!`
        ));
        make_s7_expression(
            DB,
            {
                document,
                disallow_s7express: true,
                force: { type: NAME },
                default: { comment },
            },
        ).then(
            symbol => conn.DB = symbol
        );

        // host IP
        let host = node.get('host');
        host = isSeq(host) ? host.items.join('.') : ensure_value(STRING, host).value;
        assert(
            /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host),
            new SyntaxError(`配置项"host: ${host}"有误，必须提供IP地址，可以是数组形式!`)
        );
        conn.host = host;
        conn.port = nullable_value(PINT, node.get('port'));
        conn.IP = host.split('.').map(part => {
            const ip = ensure_value(PINT, part);
            assert(ip.value < 256, new SyntaxError(`配置项"host: ${host}"的IP地址越界!`));
            return ip;
        });
        const R = nullable_value(PINT, node.get('rack'));
        const X = nullable_value(PINT, node.get('XSlot'));
        conn.R = R ? 'R' + R : '';
        conn.X = X ? 'X' + X : '';
        conn.$interval_time = nullable_value(TIME, node.get('$interval_time'));
        const interval_time = node.get('interval_time');
        make_s7_expression(
            interval_time,
            {
                document,
                force: { type: 'DINT' },
                default: { comment: `interval time of ${comment}` },
                s7_expr_desc: `MT ${comment} conn.interval_time`,
            },
        ).then(
            symbol => conn.interval_time = symbol
        );

        const polls = node.get('polls');
        assert(isSeq(polls), SyntaxError(`配置项"polls"必须为数组且个数大于0!`));
        conn.polls = polls.items.map(item => {
            const poll = {
                comment: ensure_value(STRING, item.get('comment') ?? ''),
                deivce_ID: ensure_value(PINT, item.get('deivce_ID')),
                function: ensure_value(PINT, item.get('function')),
                started_addr: nullable_value(PINT, item.get('started_addr')) ?? ensure_value(PINT, item.get('address')),
                // TODO:上一句出错的正确信息应当是 new SyntaxError(`配置项 address 或 started_addr 必须有一个!`)
                data: nullable_value(PINT, item.get('data')) ?? ensure_value(PINT, item.get('length')),
                // TODO:上一句出错的正确信息应当是 new SyntaxError(`配置项 data 或 length 必须有一个!`)
                recv_start: ensure_value(PINT, item.get('recv_start')),
                uninvoke: nullable_value(BOOL, item.get('uninvoke')) ?? new BOOL(false),
            };
            const comment = poll.comment.value;
            const recv_DB = item.get('recv_DB');
            make_s7_expression(
                recv_DB,
                {
                    document,
                    disallow_s7express: true,
                    default: { comment },
                },
            ).then(
                symbol => poll.recv_DB = symbol
            );
            return poll;
        })
        return conn;
    });
}

export function build_list(MT) {
    const { document, list } = MT
    const CPU = document.CPU;
    const DBs = new Set(); // 去重
    list.forEach(conn => { // 处理配置，形成完整数据
        const {
            conn_ID_list,
            conn_host_list,
        } = CPU;

        conn.device ??= CPU.device;
        const {
            ID,
            local_device_id = get_device_id(conn.device, conn.R, conn.X), // 已是SCL字面量
            host,
            // interval_time, // 由SCL程序负责默认的间隔时长
        } = conn;
        const port = conn.port.value;

        // 指定的device没有对应的通信设备号
        if (local_device_id === null && conn.device) elog(new SyntaxError(`指定的通信设备号"${conn.device} rack${conn.rack} xslot${conn.XSlot}"不存在！`));
        // 如没指定device，则采用默认设备号
        conn.local_device_id = local_device_id ?? DEFAULT_DEVICE_ID;

        // port_list
        conn_host_list[host] ??= new IntHashList(502); // 默认一个host从502端口开始
        const port_list = conn_host_list[host];
        port_list.push(port);

        conn.ID = fixed_hex(conn_ID_list.push(ID), 4);
        conn.DB.name ??= "conn_MT" + ID;
        conn.IP1 = fixed_hex(conn.IP[0], 2);
        conn.IP2 = fixed_hex(conn.IP[1], 2);
        conn.IP3 = fixed_hex(conn.IP[2], 2);
        conn.IP4 = fixed_hex(conn.IP[3], 2);
        conn.port1 = fixed_hex((port >>> 8), 2);
        conn.port2 = fixed_hex((port & 0xff), 2);
        conn.name ??= new STRING("polls_" + conn.ID);
        conn.polls.forEach(poll => {
            poll.deivce_ID = fixed_hex(poll.deivce_ID, 2);
            poll.function = fixed_hex(poll.function, 2);
            poll.address = fixed_hex(poll.address ?? poll.started_addr, 4);
            poll.data = fixed_hex(poll.data ?? poll.length, 4);
            // 用 ??= 确保共用块只遵循第一次的设置
            poll.recv_DB.uninvoke ??= poll.recv_DB.type_name !== 'FB' || poll.uninvoke.value;
            DBs.add(poll.recv_DB);
        });
    });
    MT.invoke_code = [...DBs].map(DB => {
        const comment = DB.comment ? ` // ${DB.comment}` : '';
        return DB.uninvoke ? `// "${DB.name}" ${DB.comment ?? ''}` : `"${DB.type}"."${DB.name}"();${comment}`;
    }).join('\n');
}

export function gen({ document, invoke_code, options }) {
    const { CPU } = document;
    const { output_dir } = CPU;
    const { output_file = LOOP_NAME + '.scl' } = options;
    const dst = `${output_dir}/${output_file}`;
    const tags = { NAME, LOOP_NAME, invoke_code, POLLS_NAME };
    const template = posix.join(context.module_path, 'src/converters/MT.template');
    return [{ dst, tags, template }];
}

export function gen_copy_list({ document }) {
    const src = posix.join(NAME, `${NAME}.scl`);
    const source = posix.join(context.module_path, src);
    const dst = posix.join(document.CPU.output_dir, `${NAME}.scl`);
    const distance = posix.join(context.work_path, dst);
    const IE = 'utf8';
    return [{ src, source, dst, distance, IE }];
}
