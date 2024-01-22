import { make_s7_prop, add_symbol } from '../symbols.js';
import { BOOL, STRING, ensure_value, nullable_value } from '../value.js';
import { isString } from '../gcl.js';
import { isMap, isSeq } from 'yaml';

export const platforms = ['step7', 'portal']; // platforms supported by this feature
export const LOOP_NAME = 'Interlock_Loop';

export function is_feature(name) {
    name = name.toLowerCase();
    return name === 'interlock' || name === 'IL';
}

const template = `// 本代码由 S7_SCL_SRC_GEN 自动生成。author: goosy.jo@gmail.com
// 配置文件: {{gcl.file}}
// 摘要: {{gcl.MD5}}
{{includes}}
{{#for DB in list}}
// {{DB.comment}}
DATA_BLOCK "{{DB.name}}"{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'FALSE' }{{#else}}
{ S7_m_c := 'true' }{{#endif portal}}
AUTHOR:Goosy
FAMILY:GooLib
STRUCT{{#for fields in DB.declarations}}
    {{fields.declaration}} // {{fields.comment}}{{#endfor fields}}{{#for edge in DB.edges}}
    {{edge.edge_field}} : BOOL ; // 用于检测{{edge.name}}上升沿的追随变量{{#endfor edge}}
END_STRUCT;
BEGIN
END_DATA_BLOCK
{{#endfor DB}}

FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }{{#endif portal}}
// 联锁保护主循环

VAR_TEMP
    reset : BOOL ; // 复位
    output : BOOL ; // 输出
END_VAR

BEGIN{{#if loop_begin}}
{{loop_begin}}
{{#endif}}{{#for DB in list}}
// DB "{{DB.name}}" 读入{{#for assign in DB.read_list}}
{{assign.assign_read}}{{#endfor assign}}
{{#for interlock in DB.interlocks}}
// {{interlock.comment}}
reset := NOT "{{DB.name}}".enable{{#for reset in interlock.reset_list}}
         OR {{reset.read.value}}{{#endfor reset}};
IF reset THEN
    // 复位联锁输出{{#for output in interlock.output_list}}
    {{output.write.value}} := {{output.resetvalue}};{{#endfor output}}
ELSE
    output := {{#for no, input in interlock.input_list}}{{#if no}}
              OR {{#endif}}{{input.trigger}}{{#endfor}};
    IF output THEN
        // 置位联锁输出{{#for output in interlock.output_list}}
        {{output.write.value}} := {{output.setvalue}};{{#endfor output}}
    END_IF;
END_IF;
// 输入边沿维护{{#for no, input in interlock.input_list}}{{#if input.edge_field}}
"{{DB.name}}".{{input.edge_field}} := {{input.read.value}};{{#endif}}{{#endfor}}{{#if interlock.extra_code}}
// 附加输出
{{interlock.extra_code}}{{#endif extra_code}}
{{#endfor interlock}}
// DB "{{DB.name}}" 写出{{#for assign in DB.write_list}}
{{assign.assign_write}}{{#endfor}}
{{#endfor DB}}{{#if loop_end}}

{{loop_end}}{{#endif}}
END_FUNCTION
`

function create_fields() {
    const s7_m_c = true;
    let index = 0;
    const fields = {
        'enable': { name: 'enable', s7_m_c, comment: '允许报警或连锁' },
        push(item) {
            item.name ??= `b_${++index}`;
            const name = item.name;
            if (this[name]) throw new SyntaxError(`interlock 项属性 name:${name} 重复定义或已保留!请改名`);
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

function create_DB_dict(document) {
    const DB_dict = {
        _list: [], // DB 列表
        /**
         * 按照名称建立一个新DB
         * @param {string} name
         * @returns {DB}
         */
        create(name) {
            const fields = create_fields();
            const interlocks = [];
            const edges = [];
            const DB = { name, fields, interlocks, edges };
            DB_dict[name] = DB;
            DB_dict._list.push(DB);
            make_s7_prop(DB, 'symbol', name, document, {
                disallow_s7express: true,
                disallow_symbol_def: true,
            });
            return DB;
        },
        /**
         * 按照名称返回一个DB，如果该名称DB不存在，就产生一个新DB
         * @param {string|node} name
         * @returns {DB}
         */
        get(name) {
            let symbol;
            if (Array.isArray(name) || isSeq(name)) {
                // 如是符号定义，则新建一个符号
                symbol = add_symbol(document, name);
                name = symbol.name;
            }
            if (isString(name)) name = name.value;
            if (typeof name !== 'string') throw Error(`Interlock DB"${name}" 输入错误！`);
            // 从已有DB中找，如没有则建立一个初始DB资源数据
            const DB = DB_dict[name] ?? DB_dict.create(name);
            return DB;
        },
    };
    return DB_dict;
}

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const { document, list } = area;
    const DB_dict = create_DB_dict(document);
    area.list = DB_dict._list;
    list.forEach(node => {
        const _DB = node.get('DB');
        if (!_DB) throw new SyntaxError("interlock转换必须有DB块!");
        const DB = DB_dict.get(_DB);

        const fields = DB.fields;
        const enable = node.get('enable');
        if (enable) {
            if (DB.enable_readable) throw new SyntaxError('enable 重复定义!');
            make_s7_prop(fields.enable, 'read', enable, document, {
                force: { type: 'BOOL' },
            });
            DB.enable_readable = true;
        }
        const enable_init = node.get('$enable');
        if (enable_init !== undefined) {
            if (DB.enable_init === undefined) {
                DB.enable_init = ensure_value(BOOL, enable_init).value ? 'TRUE' : 'FALSE';
            } else {
                throw new SyntaxError('$enable 重复定义!');
            }
        }

        const comment = new STRING(node.get('comment') ?? '报警联锁').value;
        const name = ensure_value(STRING, node.get('name') ?? `IL${DB.length}`);
        const interlock = {
            node,
            name,
            extra_code: nullable_value(STRING, node.get('extra_code'))?.value,
            comment
        };
        const default_type = nullable_value(STRING, node.get('type'))?.value.toLowerCase() ?? 'rising';

        const data_list = node.get('data')?.items ?? [];
        data_list.forEach(item => {
            if (isString(item)) item = item.value;
            if (typeof item === 'string') {
                const data = {
                    name: item,
                    s7_m_c: true
                };
                fields.push(data);
                return;
            }
            if (!isMap(item)) throw new SyntaxError('interlock的data项输入错误!');
            const name = ensure_value(STRING, item.get('name'));
            const comment = ensure_value(STRING, item.get('comment') ?? '').value;
            const data = {
                name,
                s7_m_c: true,
                comment
            };
            const read = item.get('read');
            const write = item.get('write');
            make_s7_prop(data, 'read', read, document, {
                default: { comment },
                force: { type: 'BOOL' }
            });
            make_s7_prop(data, 'write', write, document, {
                default: { comment },
                force: { type: 'BOOL' }
            });
            fields.push(data);
        });

        const input_list = node.get('input');
        if (!input_list || !isSeq(input_list) || input_list.items.length < 1) {
            throw new SyntaxError("interlock的input_list必须有1项以上!"); // 不能为空项
        }
        interlock.input_list = input_list.items.map((item) => {
            // if input is symbol then convert to interlock_item
            if (isString(item)) item = item.value;
            if (typeof item === 'string') {
                const exist_item = fields[item];
                if (exist_item) return {
                    name: exist_item.name,
                    type: default_type,
                    in_ref: exist_item
                };
            }
            if (typeof item === 'string' || isSeq(item)) {
                const input = {
                    type: default_type,
                    comment: ''
                };
                make_s7_prop(input, 'read', item, document, {
                    force: { type: 'BOOL' }
                });
                fields.push(input);
                return input;
            }
            if (!isMap(item)) throw new SyntaxError(`interlock的input项${item}输入错误，必须是input对象、data项名称、S7符号或SCL表达式`);

            const type = nullable_value(STRING, item.get('type'))?.value.toLowerCase() ?? default_type;
            const comment = new STRING(item.get('comment') ?? '').value;
            const input = { type, comment };
            let read = item.get('read');
            if (isString(read)) read = read.value;
            const exist_item = fields[read];
            if (exist_item) {
                input.in_ref = exist_item;
                input.name = input.in_ref.name;
            } else {
                make_s7_prop(input, 'read', read, document, {
                    default: { comment },
                    force: { type: 'BOOL' }
                });
                fields.push(input);
            }
            return input;
        });

        const reset_list = node.get('reset');
        if (reset_list && !isSeq(reset_list)) throw new SyntaxError('interlock 的 reset 列表必须是数组!');
        interlock.reset_list = (reset_list?.items ?? []).map((item, index) => {
            // if reset is symbol then convert to interlock_item
            if (isString(item)) item = item.value;
            if (typeof item === 'string') {
                const exist_item = fields[item];
                if (exist_item) return {
                    name: exist_item.name,
                    in_ref: exist_item
                };
            }
            if (typeof item !== 'string' && !isSeq(item)) {
                throw new SyntaxError('interlock 的 reset 项必须是data项名称、S7符号或SCL表达式!');
            }
            const reset = { name: `reset_${index}` };
            make_s7_prop(reset, 'read', item, document, {
                force: { type: 'BOOL' }
            });
            return reset;
        });

        const output_list = node.get('output');
        if (output_list && !isSeq(output_list)) throw new SyntaxError('interlock 的 output 列表必须是数组!');
        interlock.output_list = (output_list?.items ?? []).map((item, index) => {
            if (isString(item)) item = item.value;
            if (typeof item === 'string') {
                const exist_item = fields[item];
                if (exist_item) {
                    if (exist_item.read) throw new SyntaxError('interlock 的 output 项不能有 read 属性!');
                    return {
                        name: exist_item.name,
                        out_ref: exist_item
                    };
                }
            }
            if (typeof item === 'string' || isSeq(item)) {
                const output = { name: `output_${index}` };
                make_s7_prop(output, 'write', item, document, {
                    force: { type: 'BOOL' }
                });
                return output;
            }
            if (!isMap(item)) throw new SyntaxError('interlock 的 output 项必须是output对象、data项名称、S7符号或SCL表达式!');

            const name = `output_${index}`;
            const inversion = nullable_value(STRING, item.get('inversion'))?.value ?? false;
            const comment = new STRING(item.get('comment') ?? '').value;
            const output = { name, inversion, comment };
            let write = item.get('write');
            if (isString(write)) write = write.value;
            const exist_item = fields[write];
            if (exist_item) {
                output.out_ref = exist_item;
                output.name = output.out_ref.name;
            } else {
                make_s7_prop(output, 'write', write, document, {
                    default: { comment },
                    force: { type: 'BOOL' }
                });
            }
            return output;
        });
        DB.interlocks.push(interlock);
    });
}

export function build_list({ list }) {
    list.forEach(DB => {
        const interlocks = DB.interlocks;
        DB.symbol.comment ||= interlocks[0].comment;
        DB.comment ??= DB.symbol.comment;
        DB.enable_init ??= 'TRUE';

        const DB_name = DB.name;
        const S7_m_c = "{S7_m_c := 'true'}";
        const fields = DB.fields;
        const _fields = Object.values(fields);
        for (const item of _fields) {
            if (item.read) item.assign_read = `"${DB_name}".${item.name} := ${item.read.value};`;
            if (item.write) item.assign_write = `${item.write.value} := "${DB_name}".${item.name};`;
            const enable_str = item.name == 'enable'
                ? ` := ${DB.enable_init}`
                : '';
            if (item.s7_m_c) item.declaration = `${item.name} ${S7_m_c} : BOOL${enable_str} ;`;
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
                if (input.in_ref) {
                    input.read = { value: `"${DB_name}".${input.in_ref.name}` };
                }
                const input_value = input.read.value;
                const parenthesized_value = input.read.isExpress ? `(${input_value})` : input_value;
                if (input.type === 'falling') {
                    const edge_field = input.edge_field = `${input.name}_fo`;
                    input.trigger = `NOT ${parenthesized_value} AND "${DB_name}".${edge_field}`;
                    edges.push(input);
                } else if (input.type === 'change') {
                    const edge_field = input.edge_field = `${input.name}_fo`;
                    input.trigger = `${parenthesized_value} XOR "${DB_name}".${edge_field}`;
                    edges.push(input);
                } else if (input.type === 'on') {
                    input.trigger = `${input_value}`;
                } else if (input.type === 'off') {
                    input.trigger = `NOT ${input_value}`;
                } else { // default rising
                    const edge_field = input.edge_field = `${input.name}_fo`;
                    input.trigger = `${parenthesized_value} AND NOT "${DB_name}".${edge_field}`;
                    edges.push(input);
                }
                input.ID = `${DB_name}_${input.name}`;
                input.comment ??= '';
            }
            for (const reset of interlock.reset_list) {
                if (reset.in_ref) {
                    reset.read = { value: `"${DB_name}".${reset.in_ref.name}` };
                }
            }
            for (const output of interlock.output_list) {
                if (output.out_ref) {
                    output.write = { value: `"${DB_name}".${output.out_ref.name}` };
                }
                output.setvalue = output.inversion ? 'FALSE' : 'TRUE';
                output.resetvalue = output.inversion ? 'TRUE' : 'FALSE';
            }
        });
    });
}

export function gen(interlock_list) {
    const rules = [];
    interlock_list.forEach(({ document, includes, loop_begin, loop_end, list }) => {
        const { CPU, gcl } = document;
        const { output_dir, platform } = CPU;
        rules.push({
            "name": `${output_dir}/${LOOP_NAME}.scl`,
            "tags": {
                platform,
                includes,
                loop_begin,
                loop_end,
                LOOP_NAME,
                list,
                gcl,
            }
        })
    });
    return [{ rules, template }];
}

export function gen_copy_list() {
    return [];
}
