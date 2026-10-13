const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the production input/serialization code without generating Rust
// bindings or connecting to a body. Only browser APIs and binding constants
// are fixtures; packets below are decoded independently of ByteBuffer.
const root = path.resolve(__dirname, '..');
function fixture(mode = 'touch', pads = []) {
    const packets = {}, listeners = {}, timers = new Map();
    let nextTimer = 1, now = 0, fail = false;
    const bindings = {
        TransportChannelId: new Proxy({}, { get: (_, key) => key }),
        StreamMouseButton: { LEFT: 1, MIDDLE: 2, RIGHT: 3, X1: 4, X2: 5 },
        StreamKeys: { VK_KEY_A: 0x41, VK_KEY_W: 0x57, VK_SHIFT: 0x10 },
        StreamKeyModifiers: { MASK_SHIFT: 1, MASK_CTRL: 2, MASK_ALT: 4, MASK_META: 8 },
        StreamControllerButton: { BUTTON_A: 0x1000, BUTTON_B: 0x2000 },
        StreamControllerCapabilities: { CAPABILITY_RUMBLE: 1, CAPABILITY_TRIGGER_RUMBLE: 2 },
    };
    const context = vm.createContext({
        console: { debug() {}, warn() {} }, EventTarget, TextEncoder, TextDecoder,
        performance: { now: () => now }, Date: { now: () => now },
        navigator: { getGamepads: () => pads },
        setTimeout: fn => { timers.set(nextTimer, fn); return nextTimer++; },
        clearTimeout: id => timers.delete(id),
        window: { setInterval: () => 1, clearInterval() {} },
    });
    const cache = {};
    function load(file) {
        if (file.endsWith('/api_bindings.js')) return bindings;
        file = file.replace(/\.js$/, '.ts');
        if (cache[file]) return cache[file].exports;
        const module = cache[file] = { exports: {} };
        const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            compilerOptions: { target: ts.ScriptTarget.ES2015, module: ts.ModuleKind.CommonJS }
        }).outputText;
        const run = vm.runInContext(`(function(require, module, exports) { ${source}\n})`, context, { filename: file });
        run(name => load(path.resolve(path.dirname(file), name)), module, module.exports);
        return module.exports;
    }
    const { StreamInput, defaultStreamInputConfig } = load(path.join(root, 'web/stream/input.ts'));
    const input = new StreamInput({ ...defaultStreamInputConfig(), touchMode: mode });
    const channels = {};
    const transport = { getChannel: id => channels[id] ??= {
        type: 'data', canSend: true, estimatedBufferedBytes: () => 0,
        addReceiveListener: fn => (listeners[id] ??= new Set()).add(fn),
        removeReceiveListener: fn => listeners[id]?.delete(fn),
        send: data => { if (fail) throw Error('closed'); (packets[id] ??= []).push(Buffer.from(new Uint8Array(data))); }
    } };
    input.setTransport(transport);
    input.onStreamStart({ touch: true }, [1920, 1080]);
    return { input, packets, bindings, pads, transport, listeners,
        time: value => now = value,
        fail: value => fail = value,
        flush: () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); },
    };
}
const rect = { left: 100, top: 50, width: 800, height: 450 };
const touch = (identifier, clientX = 500, clientY = 275) => ({ identifier, clientX, clientY, force: 0.5, radiusX: 3, radiusY: 4, rotationAngle: 0 });
const event = (...changedTouches) => ({ changedTouches });
const key = code => ({ code });
function decode(packet) {
    assert.equal(packet.length, 27);
    return { type: packet[0], id: packet.readUInt32BE(1), x: packet.readFloatBE(5), y: packet.readFloatBE(9), force: packet.readFloatBE(13) };
}

test('native contacts encode down/move/up separately from cancel', () => {
    const f = fixture();
    f.input.onTouchStart(event(touch(7), touch(19, 100, 50)), rect);
    f.input.onTouchMove(event(touch(7, 700, 275)), rect);
    f.input.onTouchEnd(event(touch(7, 700, 275)), rect);
    f.input.onTouchCancel(event(touch(19, 100, 50)), rect);
    assert.deepEqual(f.packets.TOUCH.map(decode), [
        { type: 0, id: 7, x: .5, y: .5, force: .5 },
        { type: 0, id: 19, x: 0, y: 0, force: .5 },
        { type: 1, id: 7, x: .75, y: .5, force: .5 },
        { type: 3, id: 7, x: .75, y: .5, force: 0 },
        { type: 2, id: 19, x: 0, y: 0, force: 0 },
    ]);
});

test('out-of-bounds release clamps and a hidden frame releases at last position', () => {
    const f = fixture();
    f.input.onTouchStart(event(touch(1), touch(2)), rect);
    f.input.onTouchEnd(event(touch(1, 1200, -10)), rect);
    f.input.onTouchEnd(event(touch(2, 0, 0)), { ...rect, width: 0, height: 0 });
    assert.deepEqual(f.packets.TOUCH.slice(2).map(decode), [
        { type: 3, id: 1, x: 1, y: 0, force: 0 },
        { type: 3, id: 2, x: .5, y: .5, force: 0 },
    ]);
});

test('letterbox starts, orphan moves/ends, duplicate ends and invalid geometry are ignored', () => {
    const f = fixture();
    f.input.onTouchStart(event(touch(1, 50)), rect);
    f.input.onTouchMove(event(touch(1)), rect);
    f.input.onTouchEnd(event(touch(1)), rect);
    f.input.onTouchStart(event(touch(2)), { ...rect, width: 0 });
    f.input.onTouchStart(event(touch(3, NaN)), rect);
    assert.equal(f.packets.TOUCH, undefined);
    f.input.onTouchStart(event(touch(4)), rect);
    f.input.onTouchEnd(event(touch(4)), rect);
    f.input.onTouchEnd(event(touch(4)), rect);
    assert.equal(f.packets.TOUCH.length, 2);
});

test('portrait frame coordinates follow the displayed stream rectangle', () => {
    const f = fixture();
    f.input.onTouchStart(event(touch(5, 325, 850)), { left: 100, top: 50, width: 450, height: 800 });
    assert.deepEqual(decode(f.packets.TOUCH[0]), { type: 0, id: 5, x: .5, y: 1, force: .5 });
});

test('cancel does not click in either mouse-emulation mode, including delayed taps', () => {
    for (const mode of ['mouseRelative', 'pointAndDrag']) {
        const f = fixture(mode);
        f.input.onTouchStart(event(touch(1)), rect);
        f.input.onTouchCancel(event(touch(1)), rect);
        f.flush();
        assert.equal(f.packets.MOUSE_RELIABLE, undefined);
        f.input.onTouchStart(event(touch(2)), rect);
        f.input.onTouchEnd(event(touch(2)), rect);
        f.input.onTouchCancel(event(), rect);
        f.flush();
        assert.equal((f.packets.MOUSE_RELIABLE ?? []).filter(p => p[0] === 2).length, 0);
    }
});

test('mouse-emulated drag cancellation releases the button without another press', () => {
    const f = fixture('pointAndDrag');
    f.input.onTouchStart(event(touch(1)), rect);
    f.input.onTouchMove(event(touch(1, 600)), rect);
    f.input.onTouchCancel(event(touch(1, 1200)), rect);
    f.flush();
    assert.deepEqual(f.packets.MOUSE_RELIABLE.filter(p => p[0] === 2).map(p => [...p]), [[2, 1, 1], [2, 0, 1]]);
});

test('held simultaneous keys deduplicate repeats and focus loss releases keys/buttons/contacts', () => {
    const f = fixture();
    f.input.onKeyDown(key('KeyW')); f.input.onKeyDown(key('KeyW')); f.input.onKeyDown(key('KeyA'));
    f.input.onMouseDown({ button: 0 }, rect); f.input.onMouseDown({ button: 2 }, rect);
    f.input.onTouchStart(event(touch(3)), rect);
    f.input.setFocused(false);
    assert.deepEqual(f.packets.KEYBOARD.map(p => [p[1], p.readUInt16BE(3)]), [[1, 0x57], [1, 0x41], [0, 0x57], [0, 0x41]]);
    assert.deepEqual(f.packets.MOUSE_RELIABLE.map(p => [...p]), [[2, 1, 1], [2, 1, 3], [2, 0, 1], [2, 0, 3]]);
    assert.equal(decode(f.packets.TOUCH.at(-1)).type, 2);
    f.input.onKeyDown(key('KeyW'));
    assert.equal(f.packets.KEYBOARD.length, 4);
    f.input.setFocused(true); f.input.onKeyDown(key('KeyW')); f.input.onKeyUp(key('KeyW'));
    assert.equal(f.packets.KEYBOARD.length, 6);
});

test('cleanup survives closed channels, cancels delayed clicks and allows fresh input after reconnect', () => {
    const f = fixture('pointAndDrag');
    f.input.onKeyDown(key('KeyW'));
    f.input.onTouchStart(event(touch(1)), rect); f.input.onTouchEnd(event(touch(1)), rect);
    f.fail(true); assert.doesNotThrow(() => f.input.onStreamStop()); f.fail(false);
    f.flush();
    assert.equal((f.packets.MOUSE_RELIABLE ?? []).filter(p => p[0] === 2).length, 0);
    f.input.setTransport(f.transport); f.input.onStreamStart({ touch: true }, [1920, 1080]);
    f.input.onKeyDown(key('KeyW'));
    assert.equal(f.packets.KEYBOARD.length, 2);
    assert.equal(f.listeners.TOUCH.size, 1); assert.equal(f.listeners.CONTROLLERS.size, 1);
});

test('normal tap emits exactly one click and leaving the frame does not create a click', () => {
    const f = fixture('pointAndDrag');
    f.input.onTouchStart(event(touch(1)), rect); f.input.onTouchEnd(event(touch(1)), rect); f.flush();
    assert.deepEqual(f.packets.MOUSE_RELIABLE.filter(p => p[0] === 2).map(p => [...p]), [[2, 1, 1], [2, 0, 1]]);
    f.input.onTouchStart(event(touch(2, 0, 0)), rect); f.input.onTouchEnd(event(touch(2, 0, 0)), rect); f.flush();
    assert.equal(f.packets.MOUSE_RELIABLE.filter(p => p[0] === 2).length, 2);
});

test('mouse wheel, relative movement and physical button release retain their wire encodings', () => {
    const f = fixture();
    f.input.setConfig({ ...f.input.getConfig(), mouseMode: 'relative' });
    f.input.onMouseMove({ movementX: 10, movementY: -10 }, rect);
    f.input.onMouseWheel({ deltaX: 2, deltaY: 5 });
    f.input.onMouseDown({ button: 1 }, rect); f.input.onMouseUp({ button: 1 });
    assert.deepEqual([...f.packets.MOUSE_RELATIVE[0]], [0, 0, 24, 255, 232]);
    assert.deepEqual([...f.packets.MOUSE_RELATIVE[1]], [3, 0, 2, 255, 251]);
    assert.deepEqual(f.packets.MOUSE_RELIABLE.map(p => [...p]), [[2, 1, 2], [2, 0, 2]]);
});

function pad(index) { return { index, mapping: 'standard', buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })), axes: [0, 0, 0, 0] }; }
test('sparse browser gamepad IDs use relay slots and surviving controllers still update', () => {
    const pads = []; pads[2] = pad(2); pads[5] = pad(5);
    const f = fixture('touch', pads);
    assert.deepEqual(f.packets.CONTROLLERS.map(p => p[1]), [0, 1]);
    f.input.onGamepadDisconnect({ gamepad: pads[2] }); pads[2] = null;
    assert.deepEqual([...f.packets.CONTROLLERS.at(-1)], [1, 0]);
    f.input.onGamepadUpdate();
    assert.equal(f.packets.CONTROLLER1.length, 1);
    pads[7] = pad(7); f.input.onGamepadConnect(pads[7]);
    assert.equal(f.packets.CONTROLLERS.at(-1)[1], 0);
    f.input.setFocused(false); const count = f.packets.CONTROLLER1.length;
    f.input.onGamepadUpdate(); assert.equal(f.packets.CONTROLLER1.length, count);
    assert.deepEqual(f.packets.CONTROLLERS.slice(-2).map(p => [...p]), [[1, 0], [1, 1]]);
    f.input.setFocused(true); assert.equal(f.packets.CONTROLLERS.at(-1)[0], 0);
    f.input.onStreamStop();
});
