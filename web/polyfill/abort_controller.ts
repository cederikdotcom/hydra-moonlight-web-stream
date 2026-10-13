// -- Polyfill

class PolyfillAbortController {
    constructor() {
        this.signal = new PolyfillAbortSignal()
    }

    signal: PolyfillAbortSignal

    abort(reason?: any) {
        if (this.signal.aborted) {
            return
        }

        this.signal.aborted = true
        this.signal.reason = reason

        this.signal.dispatchEvent(new Event("abort"))
    }
}
class PolyfillAbortSignal extends EventTarget {
    static timeout(timeout: number): AbortSignal {
        if (timeout < 0 || timeout > Number.MAX_SAFE_INTEGER) {
            throw `Illegal argument for AbortSignal.timeout: timeout must be in range 0 to Number.MAX_SAFE_INTEGER`
        }

        const controller = new AbortController()

        setTimeout(controller.abort.bind(controller), timeout)

        return controller.signal
    }

    constructor() {
        super()
    }

    aborted: boolean = false
    reason: any

    throwIfAborted() {
        if (this.aborted) {
            throw this.reason
        }
    }
}

let realFetch: typeof fetch
function polyfillFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    return new Promise((resolve, reject) => {
        if (init && "signal" in init && init.signal) {
            const signal = init.signal
            init.signal = undefined

            signal.addEventListener("abort", () => {
                reject(signal.reason)
            })
        }

        realFetch(input, init)
            .then(resolve)
            .catch(reject)
    })
}

// AbortController and the EventTarget signal option arrived independently.
// Probe behavior instead of assuming one implies the other.
function fillEventListenerSignal(global: any) {
    const prototype = global.EventTarget.prototype
    const add = prototype.addEventListener
    const remove = prototype.removeEventListener
    const probe = new global.EventTarget()
    const controller = new global.AbortController()
    let calls = 0
    const listener = () => { calls++ }
    try {
        add.call(probe, "abort-option-probe", listener, { signal: controller.signal, capture: true })
        probe.dispatchEvent(new global.Event("abort-option-probe"))
        controller.abort()
        probe.dispatchEvent(new global.Event("abort-option-probe"))
        if (calls == 1) return
    } catch (_) {
        // Some engines reject the signal option; others silently ignore it.
    } finally {
        remove.call(probe, "abort-option-probe", listener, true)
    }

    console.info("using abortable event listener polyfill")
    type Registration = {
        type: string
        listener: EventListenerOrEventListenerObject
        capture: boolean
        wrapped: EventListener
        cleanup: () => void
    }
    const registrations = new WeakMap<EventTarget, Registration[]>()
    const captureOf = (options?: boolean | EventListenerOptions) =>
        typeof options == "boolean" ? options : !!options?.capture

    prototype.addEventListener = function (this: EventTarget, type: string,
        listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
        type = String(type)
        // DOM dictionaries read inherited properties too. Do not mutate callers'
        // options or turn an absent passive setting into an explicit false.
        const settings = options && typeof options == "object" ? {
            capture: !!options.capture,
            once: !!options.once,
            ...(options.passive === undefined ? {} : { passive: !!options.passive }),
            signal: options.signal
        } : options
        const signal = settings && typeof settings == "object" ? settings.signal : undefined
        if (signal !== undefined && (signal == null || typeof signal.aborted != "boolean" ||
            typeof signal.addEventListener != "function" || typeof signal.removeEventListener != "function")) {
            throw new TypeError("signal must be an AbortSignal")
        }
        if (signal?.aborted || listener == null) return
        const capture = captureOf(settings)
        const entries = registrations.get(this) ?? []
        // Native listener identity is type/callback/capture. A duplicate must
        // not replace its original lifetime, once or passive options.
        if (entries.some(entry => entry.type == type && entry.listener == listener && entry.capture == capture)) return
        const once = typeof settings == "object" && !!settings?.once
        if (settings && typeof settings == "object") delete settings.signal
        let active = true
        const cleanup = () => {
            if (!active) return
            active = false
            remove.call(this, type, wrapped, capture)
            if (signal) signal.removeEventListener("abort", cleanup)
            const index = entries.indexOf(entry)
            if (index >= 0) entries.splice(index, 1)
            if (entries.length == 0) registrations.delete(this)
        }
        const wrapped: EventListener = event => {
            // Also handles engines that snapshot listeners before dispatch.
            if (!active) return
            if (once) cleanup()
            if (typeof listener == "function") listener.call(this, event)
            else listener.handleEvent(event)
        }
        const entry = { type, listener, capture, wrapped, cleanup }
        add.call(this, type, wrapped, settings)
        entries.push(entry)
        registrations.set(this, entries)
        if (signal) {
            try {
                signal.addEventListener("abort", cleanup, { once: true })
            } catch (error) {
                cleanup()
                throw error
            }
            if (signal.aborted) cleanup()
        }
    }
    prototype.removeEventListener = function (this: EventTarget, type: string,
        listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
        type = String(type)
        const capture = captureOf(options)
        const entry = registrations.get(this)?.find(entry => entry.type == type &&
            entry.listener == listener && entry.capture == capture)
        if (entry) entry.cleanup()
        // Listeners installed before this module still use their original callback.
        remove.call(this, type, listener, capture)
    }
}

// -- Apply Polyfill if required

function fillAbortController(global: any) {
    if ("AbortController" in global) {
        return
    }
    console.info("using AbortController polyfill")

    global["AbortController"] = PolyfillAbortController;
    global["AbortSignal"] = PolyfillAbortSignal;

    // Overwrite fetch
    realFetch = global["fetch"]

    global["fetch"] = polyfillFetch


}
function fillTimeout(global: any) {
    const AbortSignal = global["AbortSignal"]
    if ("timeout" in AbortSignal) {
        return
    }
    console.info("using AbortSignal.timeout polyfill")

    AbortSignal["timeout"] = PolyfillAbortSignal.timeout
}

const globalObj = typeof globalThis !== 'undefined' ? globalThis : window
fillAbortController(globalObj)
fillTimeout(globalObj)
fillEventListenerSignal(globalObj)
