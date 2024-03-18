import { make_s7_expression, add_symbol, is_common_type } from '../symbols.js';
import { BOOL, STRING, ensure_value, nullable_value } from '../s7data.js';
import { isString } from '../gcl.js';
import { isMap, isSeq } from 'yaml';
import { elog } from '../util.js';

export const platforms = ['step7', 'portal']; // platforms supported by this feature
export const LOOP_NAME = 'Interlock_Loop';
const feature = 'interlock';

export function is_feature(name) {
    name = name.toLowerCase();
    return name === feature || name === 'IL';
}

function create_fields() {
    const s7_m_c = true;
    let index = 0;
    const fields = {
        'enable': { name: 'enable', s7_m_c, init: 'TRUE', comment: '允许报警或连锁' },
        push(item) {
            item.name ??= `b_${++index}`;
            const name = item.name;
            if (this[name]) elog(new SyntaxError(`interlock 项属性 name:${name} 重复定义或已保留!请改名`));
            this[name] = item;
        }
    };
    Object.defineProperty(fields, 'push', {
        enumerable: false,
        configurable: false,
        writable: false
    });
    return fields;
}

function create_DB_set(document) {
    const DB_list = [];

    /**
     * 按照名称建立一个新DB
     * @param {string} name
     * @returns {DB}
     */
    function create_DB(name) {
        const fields = create_fields();
        const data_dict = {};
        const interlocks = [];
        const edges = [];
        const DB = { name, fields, data_dict, interlocks, edges };
        DB_list.push(DB);
        make_s7_expression(
            name,
            {
                document,
                disallow_s7express: true,
                disallow_symbol_def: true,
            },
        ).then(
            symbol => DB.symbol = symbol
        );
        return DB;
    }

    /**
     * 按照名称返回一个DB，如果该名称DB不存在，就产生一个新DB
     * @param {string|node} name
     * @returns {DB}
     */
    function get_or_create(name) {
        let symbol;
        if (Array.isArray(name) || isSeq(name)) {
            // 如是符号定义，则新建一个符号
            symbol = add_symbol(document, name);
            name = symbol.name;
        }
        if (isString(name)) name = name.value;
        if (typeof name !== 'string') elog(Error(`Interlock DB"${name}" 输入错误！`));
        // 从已有DB中找，如没有则建立一个初始DB资源数据
        const DB = DB_list.find(DB => DB.name === name) ?? create_DB(name);
        return DB;
    }
    return { DB_list, get_or_create };
}

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const { document, list } = area;
    const { DB_list, get_or_create } = create_DB_set(document);
    area.list = DB_list;
    for (const node of list) {
        const _DB = node.get('DB');
        if (!_DB) elog(new SyntaxError("interlock转换必须有DB块!"));
        const DB = get_or_create(_DB);
        const fields = DB.fields;
        const DB_name = DB.name;
        const data_dict = DB.data_dict;

        function parse_IL_expression(item, options = {}) {
            if (item == undefined) return item;

            const { comment, s7_expr_desc, trigger_type } = options;
            if (isString(item)) item = item.value;
            if (typeof item === 'string') {
                const ref = data_dict[item];
                if (ref) {
                    const value = { value: `"${DB_name}".${ref.name}` };
                    return {
                        ref,
                        value,
                        trigger_type,
                        comment,
                    }
                }
            }

            if (typeof item === 'string' || isString(item) || isSeq(item)) {
                const ret = { trigger_type, comment }; //...options
                make_s7_expression(
                    item,
                    {
                        document,
                        force: { type: 'BOOL' },
                        default: { comment },
                        s7_expr_desc,
                    },
                ).then(expr => ret.value = expr);
                return ret;
            }

            return null;
        }

        const enable = node.get('enable');
        if (enable) {
            if (DB.enable_readable) elog(new SyntaxError('enable 重复定义!'));
            make_s7_expression(
                enable,
                {
                    document,
                    force: { type: 'BOOL' },
                    s7_expr_desc: `interlock DB:${DB_name} enable.read`,
                },
            ).then(ret => fields.enable.read = ret);
            DB.enable_readable = true;
        }
        const $enable = nullable_value(BOOL, node.get('$enable'))?.value;
        if ($enable !== undefined) {
            if (DB.enable_initialized) elog(new SyntaxError('$enable 重复定义!'));
            DB.enable_initialized = true;
            fields.enable.init = $enable ? 'TRUE' : 'FALSE';
        }

        const comment = new STRING(node.get('comment') ?? '报警联锁').value;
        const name = ensure_value(STRING, node.get('name') ?? `IL${DB.length}`);
        const interlock = {
            node,
            name,
            extra_code: nullable_value(STRING, node.get('extra_code'))?.value,
            comment
        };
        const default_trigger = nullable_value(STRING, node.get('trigger'))?.value.toLowerCase() ?? 'rising';

        const data_node = node.get('data');
        if (data_node && !isSeq(data_node)) elog(new SyntaxError('interlock 的 data 列表必须是数组!'));
        for (let item of (data_node?.items ?? [])) {
            let data;
            if (isString(item)) item = item.value;
            if (typeof item === 'string') {
                data = {
                    name: item,
                    s7_m_c: true
                };
            } else if (isMap(item)) {
                const name = ensure_value(STRING, item.get('name'));
                const comment = ensure_value(STRING, item.get('comment') ?? '').value;
                let type = nullable_value(STRING, item.get('type'))?.value;
                type = is_common_type(type) ? type : 'BOOL';
                data = {
                    name,
                    type,
                    s7_m_c: true,
                    comment
                };
                const read = item.get('read');
                make_s7_expression(
                    read,
                    {
                        document,
                        force: { type },
                        default: { comment },
                        s7_expr_desc: `interlock DB:${DB_name} ${name}.read`,
                    },
                ).then(ret => data.read = ret);
                const write = item.get('write');
                make_s7_expression(
                    write,
                    {
                        document,
                        force: { type },
                        default: { comment },
                        s7_expr_desc: `interlock DB:${DB_name} ${name}.write`,
                    },
                ).then(ret => data.write = ret);
            } else {
                elog(new SyntaxError('interlock的data项输入错误!'));
            }
            fields.push(data);
            data_dict[data.name] = data;
        };

        const input_node = node.get('input');
        if (!input_node || !isSeq(input_node) || input_node.items.length < 1) {
            elog(new SyntaxError("interlock的input_list必须有1项以上!")); // 不能为空项
        }
        interlock.input_list = input_node.items.map((item) => {
            // if item is IL_expression then convert to input_item
            let input = parse_IL_expression(item, {
                s7_expr_desc: `interlock DB:${DB_name} input.value`,
                trigger_type: default_trigger,
                comment: ''
            });
            if (!input) {
                if (!isMap(item)) elog(new SyntaxError(`interlock的input项${item}输入错误，必须是input对象、data项名称、S7符号或SCL表达式`));
                const trigger_type = nullable_value(STRING, item.get('trigger'))?.value.toLowerCase() ?? default_trigger;
                const comment = new STRING(item.get('comment') ?? '').value;
                const and = item.get('and');
                const value = item.get('value');
                if (and) {
                    if (!isSeq(and)) elog(new SyntaxError('interlock 有 is_and 属性的 input 项必须是数组!'));
                    const items = and.items.map(item => {
                        return parse_IL_expression(item, {
                            s7_expr_desc: `interlock DB:${DB_name} input.value[index]`,
                        })
                    });
                    input = { items, trigger_type, comment, };
                } else {
                    input = parse_IL_expression(value, {
                        s7_expr_desc: `interlock DB:${DB_name} input.value`,
                        trigger_type, comment,
                    });
                }
            }
            fields.push(input);
            return input;
        });

        function conv_rest(item){
            if (typeof item !== 'string' && !isString(item) && !isSeq(item)) {
                elog(new SyntaxError('interlock 的 reset 项必须是data项名称、S7符号或SCL表达式!'));
            }

            // if reset is symbol then convert to interlock_item
            let reset = parse_IL_expression(item, {
                s7_expr_desc: `interlock DB:${DB_name} reset.value`,
                comment: ''
            });
            return reset;
        }
        const reset_node = node.get('reset');
        if (reset_node && !isSeq(reset_node)) elog(new SyntaxError('interlock 的 reset 列表必须是数组!'));
        interlock.reset_list = (reset_node?.items ?? []).map(conv_rest);

        const output_node = node.get('output');
        if (output_node && !isSeq(output_node)) elog(new SyntaxError('interlock 的 output 列表必须是数组!'));
        interlock.output_list = (output_node?.items ?? []).map(item => {
            // if item is IL_expression then convert to output_item
            let output = parse_IL_expression(item, {
                s7_expr_desc: `interlock DB:${DB_name} output.value`,
                comment: ''
            });
            let inversion = false;
            if (!output) {
                if (!isMap(item)) {
                    elog(new SyntaxError('interlock 的 output 项必须是output对象、data项名称、S7符号或SCL表达式!'));
                }
                const comment = new STRING(item.get('comment') ?? '').value;
                const value = item.get('value');
                inversion = nullable_value(STRING, item.get('inversion'))?.value ?? false;
                output = parse_IL_expression(value, {
                    s7_expr_desc: `interlock DB:${DB_name} output.value`,
                    comment,
                });
                const reset = item.get('reset');
                if (reset) output.reset = conv_rest(reset);
            }
            output.setvalue = inversion ? 'FALSE' : 'TRUE';
            output.resetvalue = inversion ? 'TRUE' : 'FALSE';
            return output;
        });
        DB.interlocks.push(interlock);
    };
}

export function build_list({ list }) {
    list.forEach(DB => {
        const interlocks = DB.interlocks;
        DB.symbol.comment ||= interlocks[0].comment;
        DB.comment ??= DB.symbol.comment;

        const DB_name = DB.name;
        const S7_m_c = "{S7_m_c := 'true'}";
        const fields = DB.fields;
        const _fields = Object.values(fields);
        for (const item of _fields) {
            if (item.read) item.assign_read = `"${DB_name}".${item.name} := ${item.read.value};`;
            if (item.write) item.assign_write = `${item.write.value} := "${DB_name}".${item.name};`;
            const init_value = item.init
                ? ` := ${item.init}`
                : '';
            const type = item.type ?? 'BOOL';
            if (item.s7_m_c) item.declaration = `${item.name} ${S7_m_c} : ${type}${init_value} ;`;
            item.comment ??= '';
        }

        const declarations = _fields.filter(field => field.s7_m_c);
        DB.declarations = declarations;
        DB.read_list = declarations.filter(
            field => field.read && field.assign_read
        );
        DB.write_list = declarations.filter(
            field => field.write && field.assign_write
        );
        const edges = DB.edges;
        interlocks.forEach((interlock) => { // 处理配置，形成完整数据
            for (const input of interlock.input_list) {
                let value;
                if (input.items) {
                    const items = input.items.map(item => {
                        const item_value = item.value;
                        return item_value.isExpress ? `(${item_value.value})` : item_value.value;
                    });
                    value = items.join(' AND ');
                    input.value = { value };
                } else {
                    const input_value = input.value;
                    value = input_value.isExpress ? `(${input_value.value})` : input_value.value;
                }
                if (input.trigger_type === 'falling') {
                    const edge_field = input.edge_field = `${input.name}_fo`;
                    input.trigger = `NOT ${value} AND "${DB_name}".${edge_field}`;
                    edges.push(input);
                } else if (input.trigger_type === 'change') {
                    const edge_field = input.edge_field = `${input.name}_fo`;
                    input.trigger = `${value} XOR "${DB_name}".${edge_field}`;
                    edges.push(input);
                } else if (input.trigger_type === 'on') {
                    input.trigger = value;
                } else if (input.trigger_type === 'off') {
                    input.trigger = `NOT ${value}`;
                } else { // default rising
                    const edge_field = input.edge_field = `${input.name}_fo`;
                    input.trigger = `${value} AND NOT "${DB_name}".${edge_field}`;
                    edges.push(input);
                }
            }
            for (const reset of interlock.reset_list) {
                reset.resettable = (reset.ref ?? false) && !reset.ref.read;
            }
            for (const output of interlock.output_list) {
                if (output.ref) {
                    if (output.ref.read) elog(new SyntaxError('interlock 的 output 项不能有 read 属性!'));
                }
                const reset = output.reset;
                if(reset){
                    reset.resettable = (reset.ref ?? false) && !reset.ref.read;
                }
            }
        });
    });
}

export function gen({ document, includes, loop_begin, loop_end, list, options = {} }) {
    const { CPU, gcl } = document;
    const { output_dir, platform } = CPU;
    const { output_file = LOOP_NAME + '.scl' } = options;
    const rules = [{
        "name": `${output_dir}/${output_file}`,
        "tags": {
            feature,
            platform,
            includes,
            loop_begin,
            loop_end,
            LOOP_NAME,
            list,
            gcl,
        }
    }];
    return [{ rules }];
}

export function gen_copy_list() {
    return [];
}
