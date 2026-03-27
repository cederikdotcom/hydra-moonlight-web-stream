# moonlight-web-stream Runbook

## Overview

moonlight-web-stream is a Rust-based streaming client + web server that acts as a Moonlight client connecting to Sunshine, encapsulates the stream in WebRTC or WebSocket transport, and serves a browser UI for WebRTC peer negotiation. This is our fork of MrCreativ3001/moonlight-web-stream.

Two binaries in the workspace:
- **web-server** (`src/`): HTTP server + process manager
- **streamer** (`streamer/`): Child process handling actual stream (video/audio/input)

## Architecture

```
Browser ← WebRTC/WebSocket → web-server → spawns streamer
                                             ↓
                              streamer ← Moonlight protocol → Sunshine (body)
```

The streamer uses moonlight-common-rust (C FFI) to connect to Sunshine, receive encoded video/audio, and forward it to the browser via WebRTC. Input (keyboard, mouse, gamepad) flows in the opposite direction.

### Threading Model

The streamer uses a multi-threaded tokio runtime with 4 worker threads (hardcoded in `streamer/src/main.rs`). This is critical — on 2-vCPU machines, the default 2 threads caused ICE keepalive starvation.

Video and audio frames arrive from C FFI callbacks on native threads. These are delivered to the WebRTC transport via bounded mpsc channels (non-blocking `try_send`), with spawned consumer tasks handling the async send path. This prevents C callback threads from blocking tokio worker threads.

## Installation

The binary is deployed by hydraneckwebrtc workers. It must be at `/opt/moonlight-web-stream/web-server`.

```bash
# Download from release server
curl -o /opt/moonlight-web-stream/web-server \
  https://releases.experiencenet.com/moonlight-web-stream/production/latest/web-server-linux-amd64
chmod +x /opt/moonlight-web-stream/web-server
```

## Configuration

Configuration is via `server/config.json` in the working directory. hydraneckwebrtc generates this per-session.

Key fields:

```json
{
  "web_server": {
    "bind_address": "127.0.0.1:8080",
    "url_path_prefix": "/session/<id>",
    "first_login_create_admin": true,
    "forwarded_header": {
      "username_header": "X-Forwarded-User",
      "auto_create_missing_user": true
    }
  },
  "webrtc": {
    "port_range": {"min": 40000, "max": 40019},
    "ice_servers": [{"urls": ["stun:stun.l.google.com:19302"]}],
    "nat_1to1": {"ips": ["<public-ip>"], "ice_candidate_type": "srflx"},
    "network_types": ["udp4"],
    "relay_only": true,
    "ice_disconnected_timeout_seconds": 15
  },
  "default_settings": {
    "bitrate": 10000,
    "fps": 60,
    "videoSize": "1080p"
  }
}
```

### Critical Configuration Notes

- **`nat_1to1`**: Must be set when `relay_only` is true. Without it, ICE candidates are gathered on all interfaces (loopback, WireGuard), causing connections to unreachable addresses and disconnects at ~9 seconds.
- **`relay_only`**: Forces all WebRTC traffic through TURN relay. Used for production deployments where direct peer-to-peer is unreliable.
- **`ice_disconnected_timeout_seconds`**: How long to wait after ICE disconnection before failing. Default 15s. Dynamic values from hydraneckwebrtc: 10s (<80ms RTT), 15s (80-200ms), 25s (>200ms).

## Releasing

This repo uses direct commits to master (no branches/PRs).

1. Commit and push to master
2. CI runs tests on every push
3. To release: `git tag v<X.Y> && git push origin v<X.Y>`
4. CI builds linux-amd64, linux-arm64, windows, and publishes to GitHub Releases
5. hydraneckwebrtc workers download the binary from the release server

Note: Cargo.toml version and git tag version are different schemes. CI uses Cargo version for release naming.

## Troubleshooting

### ICE disconnects after ~9 seconds

**Most common cause**: Missing `nat_1to1` in config.json. Check that the config written by hydraneckwebrtc includes the `nat_1to1` field with the public IP.

**Second cause**: Tokio thread starvation. The 4-thread fix (main.rs) and channel-based delivery (video.rs/audio.rs) should prevent this. If it recurs, check if the consumer tasks are alive (look for "Dropping video frame" in logs — occasional drops are fine, sustained drops indicate a problem).

### Stream hangs with no video

- Check Sunshine is running on the body: `curl -sk https://<body-ip>:47990/api/currentClient`
- Check WireGuard connectivity: `ping <body-wireguard-ip>`
- Check pairing succeeded in hydraneckwebrtc logs

### Audio quality issues (metallic sound)

The fork uses a custom moonlight-common-rust with high-quality audio support (44100 Hz, hybrid AudioContext + audio element playback). If audio sounds metallic, check that the correct moonlight-common-rust revision is used in Cargo.toml.

### Process crashes

- Check session logs: `cat /tmp/hydraneckwebrtc-sessions/<session-id>/server/web-server.log`
- Common crash: config.json missing or malformed
- Common crash: port already in use (another session didn't clean up)

## Key Files

| File | Purpose |
|------|---------|
| `streamer/src/main.rs` | Tokio runtime setup (4 threads), stream lifecycle, connection listeners |
| `streamer/src/video.rs` | Video frame channel delivery (non-blocking try_send) |
| `streamer/src/audio.rs` | Audio sample channel delivery (non-blocking try_send) |
| `streamer/src/transport/webrtc/mod.rs` | WebRTC peer connection, ICE config, NAT 1:1, relay_only |
| `streamer/src/transport/webrtc/video.rs` | H264/H265/AV1 codec handling, NAL unit processing |
| `streamer/src/transport/webrtc/sender.rs` | RTP packet sending, frame queue management |
| `common/src/config.rs` | Config structs (WebRtcConfig, PortRange, etc.) |
| `src/main.rs` | Web server (actix-web), process manager for streamer |
