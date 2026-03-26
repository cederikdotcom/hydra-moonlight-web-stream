import { globalObject } from "../../util.js";
import { Pipe, PipeInfo } from "../pipeline/index.js";
import { addPipePassthrough } from "../pipeline/pipes.js";
import { AudioPlayerSetup, TrackAudioPlayer } from "./index.js";

export class AudioElementPlayer implements TrackAudioPlayer {

    static readonly type = "audiotrack"

    static async getInfo(): Promise<PipeInfo> {
        return {
            environmentSupported: "AudioContext" in globalObject() && "MediaStreamAudioSourceNode" in globalObject(),
        }
    }

    readonly implementationName: string = "audio_element"

    private audioContext: AudioContext | null = null
    private sourceNode: MediaStreamAudioSourceNode | null = null
    private oldTrack: MediaStreamTrack | null = null
    private stream = new MediaStream()
    private activated = false

    constructor() {
        this.implementationName = "audio_element"
        addPipePassthrough(this)
    }

    setup(setup: AudioPlayerSetup) {
        this.audioContext = new AudioContext({
            latencyHint: "playback",
            sampleRate: setup.sampleRate
        })
        // Suspend until user interaction to comply with autoplay policy
        this.audioContext.suspend()
        return true
    }
    cleanup(): void {
        if (this.sourceNode) {
            this.sourceNode.disconnect()
            this.sourceNode = null
        }
        if (this.oldTrack) {
            this.stream.removeTrack(this.oldTrack)
            this.oldTrack = null
        }
        if (this.audioContext) {
            this.audioContext.close()
            this.audioContext = null
        }
    }

    setTrack(track: MediaStreamTrack): void {
        if (this.sourceNode) {
            this.sourceNode.disconnect()
            this.sourceNode = null
        }
        if (this.oldTrack) {
            this.stream.removeTrack(this.oldTrack)
            this.oldTrack = null
        }

        this.stream.addTrack(track)
        this.oldTrack = track

        if (this.audioContext) {
            this.sourceNode = this.audioContext.createMediaStreamSource(this.stream)
            this.sourceNode.connect(this.audioContext.destination)
        }
    }

    onUserInteraction(): void {
        if (!this.activated && this.audioContext) {
            this.audioContext.resume()
            this.activated = true
        }
    }

    mount(_parent: HTMLElement): void {
    }
    unmount(_parent: HTMLElement): void {
    }

    getBase(): Pipe | null {
        return null
    }
}