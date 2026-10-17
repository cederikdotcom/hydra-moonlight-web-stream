import { OpusMultistreamDecoder } from "../../libopus/index.js";
// Type only on purpose: a value import of the Emscripten glue puts it in the
// main bundle, where it is evaluated on page load. Tizen 6.5 (Chromium M85)
// cannot compile this module at all, so loading it eagerly kills the whole
// page before any capability check runs.
import type { MainModule as OpusModule } from "../../libopus/libopus.js";
import { Logger } from "../log.js";
import { Pipe, PipeInfo } from "../pipeline/index.js";
import { addPipePassthrough } from "../pipeline/pipes.js";
import { AudioDecodeUnit, AudioPlayerSetup, DataAudioPlayer, PcmAudioPlayer } from "./index.js";

// TODO: use AudioWorklets? https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_AudioWorklet

export class OpusAudioDecoderPipe implements DataAudioPlayer {

    static async getInfo(): Promise<PipeInfo> {
        // Claiming support unconditionally made this pipe selectable on
        // engines that cannot run it. On Samsung QMB signage (Tizen 6.5,
        // Chromium M85) WebAssembly.instantiateStreaming throws
        // "return count of 2 exceeds that of 1": the module uses multi-value
        // returns, which that engine rejects. Importing alone does not reveal
        // it, so instantiate to find out, exactly as OpenH264DecoderPipe does.
        let environmentSupported = false
        try {
            const module = await import("../../libopus/libopus.js")
            await module.default()
            environmentSupported = true
        } catch (e) { }

        return {
            environmentSupported
        }
    }

    static readonly baseType = "audiopcm"
    static readonly type = "audiodata"

    readonly implementationName: string

    private logger: Logger | null = null

    private base: PcmAudioPlayer

    private errored: boolean = false

    private decoder: OpusMultistreamDecoder | null = null

    private opusModule: OpusModule | null = null
    private setupData: AudioPlayerSetup | null = null

    private buffer: Float32Array = new Float32Array([])
    private channelBuffers: Array<Float32Array> = []

    constructor(base: PcmAudioPlayer, logger?: Logger) {
        // Lazy, and failure must not become an unhandled rejection: an engine
        // that cannot compile the module marks this pipe errored instead.
        const loadOpusModule = async () => {
            const module = await import("../../libopus/libopus.js")
            return await module.default()
        }
        loadOpusModule()
            .then(module => this.opusModule = module)
            .catch(() => this.errored = true)

        this.logger = logger ?? null

        this.implementationName = `opus_decode -> ${base.implementationName}`
        this.base = base

        addPipePassthrough(this)
    }

    setup(setup: AudioPlayerSetup) {
        this.setupData = setup

        if ("setup" in this.base && typeof this.base.setup == "function") {
            return this.base.setup(...arguments)
        }
    }

    decodeAndPlay(unit: AudioDecodeUnit): void {
        if (this.errored) {
            return
        }

        if (!this.setupData) {
            this.errored = true
            this.logger?.debug("Failed to play audio sample because audio player is not initialized")
            return
        }

        if (!this.decoder) {
            if (!this.opusModule) {
                return
            }

            try {
                this.decoder = new OpusMultistreamDecoder(this.opusModule, this.setupData.sampleRate, this.setupData.channels, this.setupData.streams, this.setupData.coupledStreams, this.setupData.mapping)
            } catch (e: any) {
                this.errored = true

                const message = `Failed to initialize opus decoder: ${"toString" in e && typeof e.toString == "function" ? e.toString() : e}`
                this.logger?.debug(message, { type: "informError" })

                return
            }
            this.buffer = new Float32Array(this.setupData.samplesPerFrame * this.setupData.channels)
        }

        // -- Decode samples
        let samplesDecoded
        try {
            samplesDecoded = this.decoder.decodeFloat(unit.data, this.buffer, this.setupData.samplesPerFrame, false)
        } catch (e: any) {
            this.errored = true

            const message = `Failed to decode audio sample: ${"toString" in e && typeof e.toString == "function" ? e.toString() : e}`
            this.logger?.debug(message, { type: "informError" })

            return
        }

        // -- De-interleave interleaved PCM

        // Initialize channel arrays
        const channels = this.setupData.channels

        if (this.channelBuffers.length != channels) {
            this.channelBuffers = new Array(channels)

            for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
                this.channelBuffers[channelIndex] = new Float32Array(samplesDecoded)
            }
        }

        for (let channelIndex = 0; channelIndex < channels; channelIndex++) {
            if (this.channelBuffers[channelIndex].byteLength < samplesDecoded) {
                this.channelBuffers[channelIndex] = new Float32Array(samplesDecoded)
            }

            for (let sample = 0; sample < samplesDecoded; sample++) {
                this.channelBuffers[channelIndex][sample] = this.buffer[(sample * channels) + channelIndex]
            }
        }

        // -- Pass data to next decoder
        this.base.playPcm({
            durationMicroseconds: unit.durationMicroseconds,
            timestampMicroseconds: unit.timestampMicroseconds,
            channelData: this.channelBuffers
        })
    }

    cleanup() {
        this.decoder?.destroy()

        if ("cleanup" in this.base && typeof this.base.cleanup == "function") {
            return this.base.cleanup(...arguments)
        }
    }

    getBase(): Pipe | null {
        return this.base
    }
}