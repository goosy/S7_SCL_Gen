
const common_type = ['BOOL', 'BYTE', 'INT', 'WORD', 'REAL'];

export function add_symbol(symbols, symbol_raw, default_type) {
    if (!Array.isArray(symbol_raw)) return symbol_raw; // todo 非 array 不处理
    const
        name = symbol_raw[0],
        addr = symbol_raw[1],
        comment = symbol_raw[3];
    let type = symbol_raw[2] ?? default_type;
    if (type === addr) type = name;
    const reg = /^(MW|MD|M|FB|FC|DB|PIW|IW|I|PQW|QW|Q)(\d+|\+)(\.(\d))?$/;
    if (!typeof addr === 'string') throw new Error(`${symbol_raw} is wrong!`);
    let [, block_name, block_no, , block_bit] = reg.exec(addr.toUpperCase()) ?? [];
    if(!block_name || !block_no) return symbol_raw;
    if (block_name === 'FB' || block_name === 'FC') {
        // FB FC 的类型是自己
        type = name;
    }
    if (!type && block_name === 'DB') {
        // DB的默认类型是自己
        type = name;
    }
    if (!type && /^MD$/.test(block_name) ) {
        // MD 的默认类型是 DWORD
        type = 'DWORD';
    }
    if (!type && /^MW|PIW$/.test(block_name) ) {
        // MW PIW 的默认类型是 WORD
        type = 'WORD';
    }
    if (!type && /^I|Q$/.test(block_name) ) {
        // I Q 的默认类型是 BOOL
        type = 'BOOL';
    }
    let [, type_name, type_no] = reg.exec(type.toUpperCase()) ?? [type];
    const value = `"${name}"`;
    const symbol = { name, addr, type, value, block_name, block_no, block_bit, type_name, type_no, comment };
    symbols.push(symbol);
    return symbol;
}
export function add_symbols(symbols, symbol_raw_list) {
    symbol_raw_list.forEach(symbol_raw => add_symbol(symbols, symbol_raw));
}

// 检查并补全符号表
export function rebuild_symbols(CPU) {
    const exist_name = {};
    const exist_bno = {};
    const { DB_list, symbols } = CPU;
    // 检查重复并建立索引
    symbols.forEach(symbol => {
        const name = symbol.name;
        if (exist_name[name]) throw new Error(`存在重复的符号名称 ${name}!`)
        exist_name[name] = true;
        if (symbol.block_name === 'DB') { // 仅 DB 自动分配块号
            if (symbol.block_no === '+') symbol.block_no = null;
            else symbol.block_no = parseInt(symbol.block_no);
            symbol.block_bit = "";
            symbol.block_no = DB_list.push(symbol.block_no);
            symbol.addr = 'DB'+symbol.block_no;
        }
        if (exist_bno[symbol.addr]) throw new Error(`存在重复的地址 ${name} ${symbol.addr}!`)
        exist_bno[symbol.addr] = true;
        symbols[name] = symbol;
    });
    // 补全类型
    symbols.forEach(symbol => {
        if (symbol.block_name == "OB" || symbol.block_name == "FB" || symbol.block_name == "FC" || symbol.type == null) {
            symbol.type = symbol.name;
        }
        if (common_type.includes(symbol.type)) {
            symbol.type_name = symbol.type;
            symbol.type_no = '';
        } else {
            const type_block = symbols[symbol.type];
            if (!type_block) throw new Error(`${symbol.type} is required, but not defined`);
            symbol.type_name ??= type_block.block_name;
            symbol.type_no ??= type_block.block_no;
        }
    });
}

