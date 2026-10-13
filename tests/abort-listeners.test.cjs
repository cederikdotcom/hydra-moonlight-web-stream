const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../web/polyfill/abort_controller.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2015, module: ts.ModuleKind.CommonJS }
}).outputText;

function fixture({ listenerSignal = false, controller = true } = {}) {
    // Model the older DOM independently: listener identity/capture/once work,
    // but the signal dictionary member is ignored unless explicitly enabled.
    class Event { constructor(type) { this.type = type; } }
    class Target {
        constructor() { this.listeners = []; }
        addEventListener(type, fn, options) {
            if (fn == null) return;
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            const signal = listenerSignal && options?.signal;
            if (signal?.aborted || this.listeners.some(x => x.type === type && x.fn === fn && x.capture === capture)) return;
            const entry = { type, fn, capture, once: !!options?.once };
            this.listeners.push(entry);
            if (signal) signal.addEventListener('abort', () => this.removeEventListener(type, fn, capture), { once: true });
        }
        removeEventListener(type, fn, options) {
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            this.listeners = this.listeners.filter(x => x.type !== type || x.fn !== fn || x.capture !== capture);
        }
        dispatchEvent(event) {
            for (const entry of [...this.listeners]) {
                if (entry.type !== event.type || !this.listeners.includes(entry)) continue;
                if (entry.once) this.removeEventListener(entry.type, entry.fn, entry.capture);
                if (typeof entry.fn === 'function') entry.fn.call(this, event);
                else entry.fn.handleEvent(event);
            }
        }
    }
    class Signal extends Target { constructor() { super(); this.aborted = false; } }
    class Controller {
        constructor() { this.signal = new Signal(); }
        abort(reason) {
            if (this.signal.aborted) return;
            this.signal.aborted = true;
            this.signal.reason = reason;
            this.signal.dispatchEvent(new Event('abort'));
        }
    }
    const fetch = () => Promise.resolve({ ok: true });
    const timers = [];
    const env = { EventTarget: Target, Event, fetch, console: { info() {} }, setTimeout: fn => timers.push(fn) };
    if (controller) Object.assign(env, { AbortController: Controller, AbortSignal: Signal });
    const before = { add: Target.prototype.addEventListener, remove: Target.prototype.removeEventListener, fetch, controller: Controller };
    const context = vm.createContext(env);
    vm.runInContext('window = globalThis', context);
    vm.runInContext(source, context);
    return { ...env, Target, before, emit: target => target.dispatchEvent(new Event('input')), timers };
}

test('native AbortController alone does not imply abortable event listeners', () => {
    const f = fixture(), target = new f.Target(), ac = new f.AbortController();
    assert.equal(f.AbortController, f.before.controller);
    assert.equal(f.fetch, f.before.fetch);
    let count = 0;
    target.addEventListener('input', () => count++, { signal: ac.signal });
    f.emit(target); ac.abort(); f.emit(target);
    assert.equal(count, 1);
    assert.equal(target.listeners.length, 0);
    assert.equal(ac.signal.listeners.length, 0);
});

test('capture is preserved and frozen options are not mutated', () => {
    const f = fixture(), target = new f.Target(), ac = new f.AbortController();
    const options = Object.freeze({ capture: true, signal: ac.signal });
    let count = 0;
    const listener = () => count++;
    target.addEventListener('input', listener, options);
    target.addEventListener('input', listener, false);
    f.emit(target); ac.abort(); f.emit(target);
    assert.equal(count, 3);
    target.removeEventListener('input', listener, false);
    f.emit(target);
    assert.equal(count, 3);
    assert.equal(options.signal, ac.signal);
});

test('pre-aborted signals add nothing, and invalid signals fail', () => {
    const f = fixture(), target = new f.Target(), ac = new f.AbortController();
    ac.abort();
    target.addEventListener('input', () => assert.fail('pre-aborted listener'), { signal: ac.signal });
    f.emit(target);
    assert.equal(target.listeners.length, 0);
    assert.throws(() => target.addEventListener('input', null, { signal: null }), /AbortSignal/);
});

test('inherited options preserve capture, once and signal', () => {
    const f = fixture(), target = new f.Target(), ac = new f.AbortController();
    const options = Object.create({ capture: true, once: true, signal: ac.signal });
    let count = 0;
    target.addEventListener('input', () => count++, options);
    assert.equal(target.listeners[0].capture, true);
    f.emit(target); f.emit(target);
    assert.equal(count, 1);
    target.addEventListener('input', () => count++, options);
    ac.abort(); f.emit(target);
    assert.equal(count, 1);
    assert.deepEqual(Object.keys(options), []);
});

test('once listeners release their abort hook before a reentrant dispatch', () => {
    const f = fixture(), target = new f.Target(), ac = new f.AbortController();
    let count = 0;
    target.addEventListener('input', function () { assert.equal(this, target); count++; f.emit(target); }, { signal: ac.signal, once: true });
    f.emit(target); ac.abort(); f.emit(target);
    assert.equal(count, 1);
    assert.equal(ac.signal.listeners.length, 0);
});

test('manual remove releases the old signal without removing a later registration', () => {
    const f = fixture(), target = new f.Target(), first = new f.AbortController(), next = new f.AbortController();
    let count = 0;
    const listener = { handleEvent() { assert.equal(this, listener); count++; } };
    target.addEventListener('input', listener, { signal: first.signal, capture: true });
    target.removeEventListener('input', listener, { capture: true });
    assert.equal(first.signal.listeners.length, 0);
    target.addEventListener('input', listener, { signal: next.signal, capture: true });
    first.abort(); f.emit(target);
    assert.equal(count, 1);
    next.abort(); f.emit(target);
    assert.equal(count, 1);
});

test('duplicates keep the original registration lifetime and once setting', () => {
    const f = fixture(), target = new f.Target(), unused = new f.AbortController();
    let count = 0;
    const listener = () => count++;
    target.addEventListener('input', listener);
    target.addEventListener('input', listener, { signal: unused.signal, once: true });
    unused.abort(); f.emit(target); f.emit(target);
    assert.equal(count, 2);
    assert.equal(target.listeners.length, 1);
});

test('aborting during dispatch removes later listeners on the same signal', () => {
    const f = fixture(), target = new f.Target(), ac = new f.AbortController();
    target.addEventListener('input', () => ac.abort(), { signal: ac.signal });
    target.addEventListener('input', () => assert.fail('stale input listener fired'), { signal: ac.signal });
    f.emit(target);
    assert.equal(target.listeners.length, 0);
});

test('engines without AbortController also receive listener cleanup', () => {
    const f = fixture({ controller: false }), target = new f.Target(), ac = new f.AbortController();
    let count = 0;
    target.addEventListener('input', () => count++, { signal: ac.signal, capture: true });
    f.emit(target); ac.abort(); f.emit(target);
    assert.equal(count, 1);
});

test('working native listener support is preserved and timeout still aborts', () => {
    const f = fixture({ listenerSignal: true });
    assert.equal(f.Target.prototype.addEventListener, f.before.add);
    assert.equal(f.Target.prototype.removeEventListener, f.before.remove);
    assert.equal(f.fetch, f.before.fetch);
    const signal = f.AbortSignal.timeout(10);
    assert.equal(signal.aborted, false);
    f.timers.shift()();
    assert.equal(signal.aborted, true);
});
