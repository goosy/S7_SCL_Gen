export const trace_info = {
    name: '',
    filename: '',
    doc_index: 0,
    CPU: '',
    type: '',
    documents: new Map(),
    symbols: new Map(),
    push_symbol(symbol) {
        this.symbols.set(symbol, this.get_doc());
    },
    get_symbol(symbol) {
        return this.symbols.get(symbol);
    },
    push_doc() {
        const { CPU, type, filename, doc_index } = this;
        this.name = `${CPU}:${type}`;
        if (this.documents.get(this.name)) { throw new Error(`inner error: 2001`) };
        this.documents.set(this.name, { filename, CPU, type, doc_index });
    },
    get_doc(CPU, type) {
        return this.documents.get(`${CPU ?? this.CPU}:${type ?? this.type}`);
    },
    clear() {
        this.name = null;
        this.filename = null;
        this.CPU = null;
        this.type = null;
        this.doc_index = null;
    }
}