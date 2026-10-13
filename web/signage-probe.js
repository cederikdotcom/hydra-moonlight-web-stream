/* Issue 769: keep this diagnostic independent of the streaming app and ES modules.
 * ES5 syntax lets old signage browsers report missing features instead of blanking.
 * No enrollment, requests, ICE gathering, camera access, or persistent storage.
 */
(function (root) {
    "use strict";

    function codecsFromSdp(sdp) {
        var result = { video: [], audio: [], dataChannel: false };
        var section = "";
        String(sdp || "").split(/\r?\n/).forEach(function (line) {
            if (line.indexOf("m=") === 0) {
                section = line.slice(2).split(" ")[0];
                if (section === "application" && /SCTP/i.test(line)) {
                    result.dataChannel = true;
                }
            }
            var match = /^a=rtpmap:\d+ ([^/]+)\//i.exec(line);
            if (match && (section === "video" || section === "audio")) {
                var codec = match[1].toLowerCase();
                if (result[section].indexOf(codec) === -1) result[section].push(codec);
            }
        });
        return result;
    }

    function collect(env, done) {
        var doc = env.document;
        var video = doc.createElement("video");
        var report = {
            schemaVersion: 1,
            capturedAt: new Date().toISOString(),
            validation: "capability-probe-only; device streaming unverified",
            userAgent: env.navigator.userAgent || "",
            screen: {
                width: env.screen.width, height: env.screen.height,
                viewportWidth: env.innerWidth, viewportHeight: env.innerHeight,
                pixelRatio: env.devicePixelRatio || 1
            },
            features: {
                secureContext: env.isSecureContext === true,
                promise: typeof env.Promise === "function",
                modules: "noModule" in doc.createElement("script"),
                fetch: typeof env.fetch === "function",
                webSocket: typeof env.WebSocket === "function",
                webRTC: typeof env.RTCPeerConnection === "function",
                mediaStream: typeof env.MediaStream === "function",
                videoSrcObject: "srcObject" in video,
                touchEvents: "ontouchstart" in env,
                maxTouchPoints: env.navigator.maxTouchPoints || 0,
                pointerEvents: typeof env.PointerEvent === "function",
                fullscreen: typeof doc.documentElement.requestFullscreen === "function",
                webkitFullscreen: typeof doc.documentElement.webkitRequestFullscreen === "function",
                webCodecs: typeof env.VideoDecoder === "function",
                abortController: typeof env.AbortController === "function",
                abortTimeout: !!(env.AbortSignal && typeof env.AbortSignal.timeout === "function")
            },
            // File playback capability is separate from the WebRTC offer below.
            h264FilePlayback: video.canPlayType ? video.canPlayType('video/mp4; codecs="avc1.42E01E"') : "",
            offer: { status: "not-run", video: [], audio: [], dataChannel: false },
            blockers: [],
            unverified: ["relay connectivity and ICE", "hardware decode and sustained FPS",
                "audio playback and autoplay", "remote touch mapping", "boot and recovery", "fleet enrollment"]
        };
        ["secureContext", "promise", "modules", "fetch", "webSocket", "webRTC", "mediaStream", "videoSrcObject"].forEach(function (key) {
            if (!report.features[key]) report.blockers.push("Missing prerequisite: " + key);
        });
        var peer = null;
        var channel = null;
        var finished = false;
        var timer;
        function finish(status) {
            if (finished) return;
            finished = true;
            env.clearTimeout(timer);
            if (channel) { try { channel.close(); } catch (ignore) {} }
            if (peer) { try { peer.close(); } catch (ignore) {} }
            report.offer.status = status;
            if (status === "created") {
                if (report.offer.video.indexOf("h264") === -1) report.blockers.push("H.264 absent from receive offer");
                if (report.offer.audio.indexOf("opus") === -1) report.blockers.push("Opus absent from receive offer");
                if (!report.offer.dataChannel) report.blockers.push("SCTP absent from offer");
            } else {
                report.blockers.push("WebRTC offer probe: " + status);
            }
            done(report);
        }
        if (!report.features.webRTC || !report.features.promise) {
            finish("unavailable");
            return;
        }
        timer = env.setTimeout(function () { finish("timed-out"); }, 5000);
        try {
            peer = new env.RTCPeerConnection({ iceServers: [] });
            channel = peer.createDataChannel("signage-probe");
            // Do not setLocalDescription: no candidate gathering or network traffic.
            // Legacy options intentionally work without addTransceiver/getCapabilities.
            peer.createOffer({ offerToReceiveVideo: true, offerToReceiveAudio: true }).then(function (offer) {
                if (finished) return;
                var codecs = codecsFromSdp(offer.sdp);
                report.offer.video = codecs.video;
                report.offer.audio = codecs.audio;
                report.offer.dataChannel = codecs.dataChannel;
                finish("created");
            }, function () { finish("rejected"); });
        } catch (error) {
            finish("failed");
        }
    }

    function mount(env) {
        var doc = env.document;
        var output = doc.getElementById("report");
        var status = doc.getElementById("status");
        var run = doc.getElementById("run");
        var pad = doc.getElementById("touch-pad");
        var events = doc.getElementById("events");
        var history = [];
        var report = null;
        function render() {
            if (report) {
                report.localInputEvents = history.slice();
                output.value = JSON.stringify(report, null, 2);
            }
        }
        function record(event) {
            if (event.cancelable) event.preventDefault();
            var point = event.changedTouches ? event.changedTouches[0] : event;
            var rect = pad.getBoundingClientRect();
            history.push({ type: event.type, touches: event.touches ? event.touches.length : null,
                x: point ? Math.round(point.clientX - rect.left) : null,
                y: point ? Math.round(point.clientY - rect.top) : null });
            if (history.length > 30) history.shift();
            events.textContent = JSON.stringify(history[history.length - 1]);
            render();
        }
        ["touchstart", "touchmove", "touchend", "touchcancel", "pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(function (type) {
            pad.addEventListener(type, record, { passive: false });
        });
        run.onclick = function () {
            run.disabled = true;
            status.textContent = "Checking local capabilities...";
            collect(env, function (value) {
                report = value;
                run.disabled = false;
                status.textContent = report.blockers.length ? "Prerequisites need attention. See report." :
                    "Prerequisites detected. Streaming and device support are still unverified.";
                render();
            });
        };
        doc.getElementById("select-report").onclick = function () { output.focus(); output.select(); };
        run.onclick();
    }

    var api = { collect: collect, codecsFromSdp: codecsFromSdp, mount: mount };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.SignageProbe = api;
}(typeof window !== "undefined" ? window : this));
