const test = require('node:test');
const assert = require('node:assert/strict');
const { collect, codecsFromSdp } = require('../web/signage-probe.js');

const sdp = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=rtpmap:96 H264/90000\r\n' +
    'a=rtpmap:97 H264/90000\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n' +
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';

function fixture(behavior = 'success') {
    const state = { closed: 0, channelClosed: 0, callbacks: 0 };
    const env = {
        document: {
            createElement: tag => tag === 'video' ? { srcObject: null, canPlayType: () => 'probably' } : { noModule: false },
            documentElement: {}
        },
        navigator: { userAgent: 'test', maxTouchPoints: 2 }, screen: { width: 1920, height: 1080 },
        innerWidth: 1920, innerHeight: 1080, isSecureContext: true,
        Promise, fetch() {}, WebSocket() {}, MediaStream() {},
        setTimeout(callback) { state.timeout = callback; return 1; },
        clearTimeout(id) { state.cleared = id; },
        RTCPeerConnection: class {
            constructor(config) {
                assert.deepEqual(config, { iceServers: [] });
                if (behavior === 'constructor-error') throw new Error('unsupported');
            }
            createDataChannel() {
                if (behavior === 'channel-error') throw new Error('no SCTP');
                return { close() { state.channelClosed++; } };
            }
            createOffer(options) {
                assert.deepEqual(options, { offerToReceiveVideo: true, offerToReceiveAudio: true });
                if (behavior === 'reject') return Promise.reject(new Error('failed'));
                if (behavior === 'hang') return new Promise(resolve => { state.resolve = resolve; });
                return Promise.resolve({ sdp: behavior === 'no-codecs' ? 'v=0' : sdp });
            }
            setLocalDescription() { assert.fail('Must not gather ICE candidates'); }
            close() { state.closed++; }
        }
    };
    return { env, state };
}

test('SDP codecs are deduplicated and scoped to media sections', () => {
    assert.deepEqual(codecsFromSdp(sdp), { video: ['h264'], audio: ['opus'], dataChannel: true });
    assert.deepEqual(codecsFromSdp('m=audio 9 RTP/AVP 96\na=rtpmap:96 H264/90000'),
        { video: [], audio: ['h264'], dataChannel: false });
});

test('missing WebRTC, Promise, modules and secure context still produce a report', async () => {
    const { env } = fixture();
    delete env.RTCPeerConnection;
    delete env.Promise;
    env.isSecureContext = false;
    env.document.createElement = () => ({});
    const report = await new Promise(resolve => collect(env, resolve));
    assert.equal(report.offer.status, 'unavailable');
    for (const key of ['webRTC', 'promise', 'modules', 'secureContext', 'videoSrcObject']) {
        assert.ok(report.blockers.includes('Missing prerequisite: ' + key));
    }
});

test('receive offer probes H264, Opus and SCTP without WebCodecs or codec-capabilities API', async () => {
    const { env, state } = fixture();
    const report = await new Promise(resolve => collect(env, resolve));
    assert.equal(report.offer.status, 'created');
    assert.deepEqual(report.blockers, []);
    assert.equal(report.features.webCodecs, false);
    assert.match(report.validation, /unverified/);
    assert.equal(state.closed, 1);
    assert.equal(state.channelClosed, 1);
    assert.equal(state.cleared, 1);
});

test('MP4 file support does not imply WebRTC H264/Opus/SCTP support', async () => {
    const { env } = fixture('no-codecs');
    const report = await new Promise(resolve => collect(env, resolve));
    assert.equal(report.h264FilePlayback, 'probably');
    assert.equal(report.blockers.length, 3);
});

for (const behavior of ['constructor-error', 'channel-error', 'reject']) {
    test(behavior + ' returns evidence and releases allocated resources', async () => {
        const { env, state } = fixture(behavior);
        const report = await new Promise(resolve => collect(env, resolve));
        assert.equal(report.offer.status, behavior === 'reject' ? 'rejected' : 'failed');
        assert.equal(state.closed, behavior === 'constructor-error' ? 0 : 1);
        assert.equal(state.channelClosed, behavior === 'reject' ? 1 : 0);
    });
}

test('timeout closes resources once and ignores a late offer', async () => {
    const { env, state } = fixture('hang');
    let result;
    collect(env, report => { state.callbacks++; result = JSON.stringify(report); });
    state.timeout();
    state.resolve({ sdp });
    await Promise.resolve();
    assert.equal(state.callbacks, 1);
    assert.equal(state.closed, 1);
    assert.equal(state.channelClosed, 1);
    assert.equal(JSON.parse(result).offer.status, 'timed-out');
});
