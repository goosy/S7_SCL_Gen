export function lazyassign(obj, prop, lazyvalue, options) {
    const { writable = false, enumerable = false, configurable = false } = options ?? {};
    if (typeof lazyvalue === 'function') {
        Object.defineProperty(obj, prop, {
            get() {
                const value = lazyvalue();
                if (value == null) throw new Error(`lazyvalue not ready`);
                lazyassign(obj, prop, value, options);
                return value;
            },
            enumerable,
            configurable: true
        });
    } else {
        Object.defineProperty(obj, prop, {
            value: lazyvalue,
            writable,
            enumerable,
            configurable,
        });
    }
}