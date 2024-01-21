import { make_s7express } from '../symbols.js';
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
{{#for interlock in list}}
// {{interlock.comment}}
DATA_BLOCK {{interlock.DB.value}}{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'FALSE' }{{#else}}
{ S7_m_c := 'true' }{{#endif portal}}
AUTHOR:Goosy
FAMILY:GooLib
STRUCT{{#for fiels in interlock.declarations}}
    {{fiels.declaration}} // {{fiels.comment}}{{#endfor fiels}}{{#for edge in interlock.edges}}
    {{edge.edge_field}} : BOOL ; // 用于检测{{edge.name}}上升沿的追随变量{{#endfor edge}}
END_STRUCT;
BEGIN
END_DATA_BLOCK
{{#endfor interlock}}

FUNCTION "{{LOOP_NAME}}" : VOID{{#if platform == 'portal'}}
{ S7_Optimized_Access := 'TRUE' }{{#endif portal}}
// 联锁保护主循环

VAR_TEMP
    reset : BOOL ; // 复位
    output : BOOL ; // 输出
END_VAR

BEGIN{{#if loop_begin}}
{{loop_begin}}

{{#endif}}{{#for interlock in list}}
// {{interlock.comment}}{{#for assign in interlock.read_list}}
{{assign.assign_read}}{{#endfor assign}}
reset := NOT {{interlock.DB.value}}.enable{{#for reset in interlock.reset_list}}
         OR {{reset.read.value}}{{#endfor reset}};
IF reset THEN
    {{interlock.DB.value}}.reset := FALSE;  // 复位reset
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
{{interlock.DB.value}}.{{input.edge_field}} := {{input.read.value}};{{#endif}}{{#endfor}}
// 附加输出{{#for assign in interlock.write_list}}
{{assign.assign_write}}{{#endfor}}{{#if interlock.extra_code}}
{{interlock.extra_code}}{{#endif extra_code}}
{{#endfor interlock}}{{#if loop_end}}

{{loop_end}}{{#endif}}
END_FUNCTION
`

function create_fields() {
    const s7_m_c = true;
    const fields = {
        'enable': { name: 'enable', s7_m_c, comment: '允许报警或连锁' },
        'reset': { name: 'reset', s7_m_c, comment: '复位输出' },
        'output': { name: 'output', s7_m_c, comment: '联锁输出' },
        push(item) {
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

/**
 * 第一遍扫描 提取符号
 * @date 2021-12-07
 * @param {S7Item} VItem
 * @returns {void}
 */
export function initialize_list(area) {
    const document = area.document;
    area.list = area.list.map(node => {
        const fields = create_fields();
        const interlock = {
            node,
            fields,
            extra_code: nullable_value(STRING, node.get('extra_code'))?.value,
            comment: new STRING(node.get('comment') ?? '报警联锁')
        };
        const DB = node.get('DB');
        if (!DB) throw new SyntaxError("interlock转换必须有DB块!");
        const comment = interlock.comment.value;
        make_s7express(interlock, 'DB', DB, document, { default: { comment } });

        const enable = node.get('enable');
        if (enable) {
            make_s7express(fields.enable, 'read', enable, document, {
                s7express: true,
                force: { type: 'BOOL' },
            });
        }

        fields.enable.init = ensure_value(BOOL, node.get('$enable') ?? true);
        const default_type = nullable_value(STRING, node.get('type'))?.value.toLowerCase() ?? 'rising';

        const data_list = node.get('data')?.items ?? [];
        data_list.forEach(item => {
            if (!isMap(item)) throw new SyntaxError('interlock的data项输入错误!');
            const name = ensure_value(STRING, item.get('name'));
            const data = {
                name,
                s7_m_c: true,
                comment: new STRING(item.get('comment') ?? '')
            };
            const read = item.get('read');
            const write = item.get('write');
            const comment = data.comment.value;
            make_s7express(data, 'read', read, document, {
                s7express: true,
                default: { comment },
                force: { type: 'BOOL' }
            });
            make_s7express(data, 'write', write, document, {
                s7express: true,
                default: { comment },
                force: { type: 'BOOL' }
            });
            fields.push(data);
        });

        const input_list = node.get('input');
        if (!input_list || !isSeq(input_list) || input_list.items.length < 1) {
            throw new SyntaxError("interlock的input_list必须有1项以上!"); // 不能为空项
        }
        interlock.input_list = input_list.items.map((item, index) => {
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
                    name: `input_${index}`,
                    type: default_type,
                    comment: ''
                };
                make_s7express(input, 'read', item, document, {
                    s7express: true,
                    force: { type: 'BOOL' }
                });
                fields.push(input);
                return input;
            }
            if (!isMap(item)) throw new SyntaxError(`interlock的input项${item}输入错误，必须是input对象、data项名称、S7符号或SCL表达式`);

            const name = `input_${index}`;
            const type = nullable_value(STRING, item.get('type'))?.value.toLowerCase() ?? default_type;
            const comment = new STRING(item.get('comment') ?? '').value;
            const input = { name, type, comment };
            let read = item.get('read');
            if (isString(read)) read = read.value;
            const exist_item = fields[read];
            if (exist_item) {
                input.in_ref = exist_item;
                input.name = input.in_ref.name;
            } else {
                make_s7express(input, 'read', read, document, {
                    s7express: true,
                    default: { comment },
                    force: { type: 'BOOL' }
                });
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
            make_s7express(reset, 'read', item, document, {
                s7express: true,
                force: { type: 'BOOL' }
            });
            return reset;
        });
        interlock.reset_list.unshift(fields.reset);

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
                make_s7express(output, 'write', item, document, {
                    s7express: true,
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
                make_s7express(output, 'write', write, document, {
                    s7express: true,
                    default: { comment },
                    force: { type: 'BOOL' }
                });
            }
            return output;
        });
        interlock.output_list.unshift(fields.output);
        return interlock;
    });
}

export function build_list({ list }) {
    list.forEach(interlock => { // 处理配置，形成完整数据
        const S7_m_c = "{S7_m_c := 'true'}";
        const DB_name = interlock.DB.name;
        const fields = interlock.fields;
        const _fields = Object.values(fields);
        for (const item of _fields) {
            if (item.read) item.assign_read = `"${DB_name}".${item.name} := ${item.read.value};`;
            if (item.write) item.assign_write = `${item.write.value} := "${DB_name}".${item.name};`;
            const enable_str = item.name == 'enable'
                ? ` := ${item.init.value ? 'TRUE' : 'FALSE'}`
                : '';
            if (item.s7_m_c) item.declaration = `${item.name} ${S7_m_c} : BOOL${enable_str} ;`;
            item.comment ??= '';
        }
        fields.reset.read = { value: `"${DB_name}".reset` };
        fields.output.write = { value: `"${DB_name}".output` };
        interlock.edges = [];
        for (const input of interlock.input_list) {
            if (input.in_ref) {
                input.read = { value: `"${DB_name}".${input.in_ref.name}` };
            }
            const input_value = input.read.value;
            const parenthesized_value = input.read.isExpress ? `(${input_value})` : input_value;
            if (input.type === 'falling') {
                const edge_field = input.edge_field = `${input.name}_fo`;
                input.trigger = `NOT ${parenthesized_value} AND "${DB_name}".${edge_field}`;
                interlock.edges.push(input);
            } else if (input.type === 'change') {
                const edge_field = input.edge_field = `${input.name}_fo`;
                input.trigger = `${parenthesized_value} XOR "${DB_name}".${edge_field}`;
                interlock.edges.push(input);
            } else if (input.type === 'on') {
                input.trigger = `${input_value}`;
            } else if (input.type === 'off') {
                input.trigger = `NOT ${input_value}`;
            } else { // default rising
                const edge_field = input.edge_field = `${input.name}_fo`;
                input.trigger = `${parenthesized_value} AND NOT "${DB_name}".${edge_field}`;
                interlock.edges.push(input);
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
        const declarations = _fields.filter(field => field.s7_m_c);
        interlock.declarations = declarations;
        interlock.read_list = declarations.filter(
            field => field.read && field.assign_read
        );
        interlock.write_list = declarations.filter(
            field => field.write && field.assign_write
        );
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
