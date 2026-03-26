import { globalObject } from "../../util.js";
import { Pipe, PipeInfo } from "../pipeline/index.js";
import { addPipePassthrough } from "../pipeline/pipes.js";
import { AudioPlayerSetup, TrackAudioPlayer } from "./index.js";

export class AudioElementPlayer implements TrackAudioPlayer {

    static readonly type = "audiotrack"

    static async getInfo(): Promise<PipeInfo> {
        return {
            environmentSupported: "HTMLAudioElement" in globalObject() && "srcObject" in HTMLAudioElement.prototype,
        }
    }

    readonly implementationName: string = "audio_element"

    private audioElement = document.createElement("audio")
    private audioContext: AudioContext | null = null
    private destinationNode: MediaStreamAudioDestinationNode | null = null
    private sourceNode: MediaStreamAudioSourceNode | null = null
    private oldTrack: MediaStreamTrack | null = null
    private inputStream = new MediaStream()

    constructor() {
        this.implementationName = "audio_element"

        this.audioElement.classList.add("audio-stream")
        this.audioElement.preload = "none"
        this.audioElement.controls = false
        this.audioElement.autoplay = true
        this.audioElement.muted = true

        addPipePassthrough(this)
    }

    setup(setup: AudioPlayerSetup) {
        try {
            this.audioContext = new AudioContext({
                latencyHint: "playback",
                sampleRate: setup.sampleRate
            })
            this.destinationNode = this.audioContext.createMediaStreamDestination()
            this.audioElement.srcObject = this.destinationNode.stream
        } catch (e) {
            // AudioContext failed — fall back to direct track playback
            this.audioContext = null
            this.destinationNode = null
        }
        return true
    }
    cleanup(): void {
        if (this.sourceNode) {
            this.sourceNode.disconnect()
            this.sourceNode = null
        }
        if (this.oldTrack) {
            this.inputStream.removeTrack(this.oldTrack)
            this.oldTrack = null
        }
        if (this.audioContext) {
            this.audioContext.close()
            this.audioContext = null
        }
        this.destinationNode = null
        this.audioElement.srcObject = null
    }

    setTrack(track: MediaStreamTrack): void {
        if (this.sourceNode) {
            this.sourceNode.disconnect()
            this.sourceNode = null
        }
        if (this.oldTrack) {
            this.inputStream.removeTrack(this.oldTrack)
            this.oldTrack = null
        }

        this.inputStream.addTrack(track)
        this.oldTrack = track

        if (this.audioContext && this.destinationNode) {
            // Route through AudioContext for high-quality resampling
            this.sourceNode = this.audioContext.createMediaStreamSource(this.inputStream)
            this.sourceNode.connect(this.destinationNode)
        } else {
            // Fallback: direct track to audio element
            this.audioElement.srcObject = this.inputStream
        }
    }

    onUserInteraction(): void {
        this.audioElement.muted = false
        this.audioContext?.resume()
    }

    mount(parent: HTMLElement): void {
        parent.appendChild(this.audioElement)
    }
    unmount(parent: HTMLElement): void {
        parent.removeChild(this.audioElement)
    }

    getBase(): Pipe | null {
        return null
    }
}
