# Signage head acceptance: issue 769

Status: **NOT RUN on Samsung QM43B-T, QM55B-T or iiyama T4362AS-B1**.
Desktop browser tests and vendor specifications cannot change this status.
Background and implementation gaps: [signage runbook](../runbooks/signage-heads.md).
Earlier Samsung work is recorded in issues 26 and 141. Issue 26's implementation
report still lists hardware/emulator testing as future work. Recover and inspect
that client first; its reported Tizen 7.0+ package target is above the requested
Samsung panels' Tizen 6.5. A prior `done` status is not an acceptance result.

## Preparation checks recorded on 2026-10-13

- PASS: eight Node tests for SDP parsing, missing APIs, codec absence, failed
  construction/channel/offer, timeout, late completion and resource cleanup.
- PASS: JavaScript syntax check; existing `npm run copy-static` copies both
  diagnostic files, with the script byte-identical to its source.
- PASS: headless desktop Chromium 155.0.8059.39 on loopback with touch emulation.
  H.264/Opus/SCTP offer detected, touch start/end recorded, rerun and report
  selection worked, no page errors. Observed page requests were only the two
  probe assets. This does not validate Tizen, Android 8 or display hardware.
- BLOCKED locally: `npm run build-light` cannot resolve the checkout's missing
  generated `web/api_bindings.js` declarations and reports downstream type
  errors. The normal full build first generates bindings with Cargo. No Rust
  build was attempted on this host with only approximately 411 MB disk free.
  The standalone diagnostic does not need those bindings.
- NOT RUN: APK/WGT build or installation, live body/relay streaming and every
  target-device acceptance gate below. No production deployment performed.

## Before hardware arrives

From this repository:

```sh
node --test tests/signage-probe.test.cjs
node --check web/signage-probe.js
npm run copy-static
```

Open `/signage-probe.html` on a test HTTPS origin serving the two probe files.
They are independent of generated Rust/TypeScript API bindings. A local desktop
smoke test can use a foreground loopback server:

```sh
python3 -m http.server 8769 --bind 127.0.0.1 --directory web
```

Browse to `http://127.0.0.1:8769/signage-probe.html`; stop the server afterward.
Loopback is not reachable from a display. For display testing, stage the two
files on an approved HTTPS origin or use a local port tunnel; do not expose a
workspace directory on a public listener. Use the intended signage runtime,
not only a laptop browser or a `file://` page.

Expected: report appears within five seconds, errors render as explicit
prerequisite/probe findings, rerun works, local touch events appear, and report
selection works. No request to a body, cluster, external STUN/TURN server or
telemetry endpoint should occur. Only the page/static asset requests are expected.
Missing WebCodecs and fullscreen are observations, not automatic streaming failure.

For the future flat Android implementation, CI must compile the non-VR variant,
verify APK ABI coverage and the merged manifest, and test enrollment role,
identity persistence, flat catalog, bitrate bounds, start/stop and error recovery
against fake services. This preparation does not deliver that variant.

## Capture the unit before changing it

Record model and regional suffix, firmware/build, OS/browser version, installation
method (browser/custom launcher/WGT/APK/external PC), orientation, network, app
commit/artifact hash, body/relay versions and experience version. Avoid recording
tokens or private keys. Record whether a firmware update changes any result.

For iiyama, if ADB is available and explicitly authorized on that unit:

```sh
adb -s DEVICE shell getprop ro.product.model
adb -s DEVICE shell getprop ro.build.version.release
adb -s DEVICE shell getprop ro.build.version.sdk
adb -s DEVICE shell getprop ro.product.cpu.abilist
adb -s DEVICE shell getprop ro.product.cpu.abi
adb -s DEVICE shell wm size
adb -s DEVICE shell wm density
adb -s DEVICE shell dumpsys media.codec
```

Vendor codec output may be incomplete. Confirm the actual decoder selected in
Moonlight logs and measure frames; do not treat a listed codec as proof of
hardware performance. Check APK libraries against reported userspace ABIs.
ADB absence does not itself disqualify a sideloaded application, but requires
another supported update and diagnostics path. Use the existing hydraadb host
only over the managed network, with device authorization.

## Gates (run independently for each model)

| Gate | Procedure | Required evidence |
|---|---|---|
| Installation | Install the test APK or signage package using its supported route; start without developer workstation attached. | Correct app/version, no missing library, certificate or unsupported privilege errors. |
| Browser preflight | Run the probe in the actual launch mode. Save JSON with model/firmware. | H.264 and Opus in receive offer, SCTP, required web APIs. A clear probe only permits the next test. |
| Enrollment | Enroll, restart, reboot, disconnect/reconnect. Then revoke that device credential. | One stable head identity; correct venue/flat catalog; no Quest role or XR offerings; revoked access stops. |
| First stream | Use a reserved test body with H.264 SDR, 720p30/5 Mbps; then 1080p60/10 Mbps. | Correct experience, negotiated codec/resolution, decoder, audio, FPS/drop counters and connection timing. |
| Touch | Tap a nine-point grid and drag between corners. Test long press, two fingers, edge gestures, touch cancel, overlays, focus loss and reconnect. | Correct coordinates; no duplicate clicks, stuck presses or browser scrolling over content. Verify mouse-bound and native-touch experiences separately. |
| DT23 peripherals | On the actual DT23 TV/client, connect the intended mouse, keyboard and gamepad. Test held and simultaneous keys, modifiers, key release, buttons, wheel, focus loss and continuous relative mouse movement where the game needs it. Repeat after reconnect and reboot. | The assigned body receives the intended events without TV menus intercepting required controls, stuck keys/buttons or cursor-edge limits. Menu navigation and text entry alone do not pass. If using an external head, attach peripherals to that head and record this deployment route. |
| Orientation | Landscape, portrait, letterboxed content and non-native stream size. On external heads, test USB mapping with two displays. | Encoding, host display, app window and touch coordinates agree. No stretched or rotated input. |
| Audio | Start from a user tap; restart after idle/reboot. Check speakers, mute and sync. If needed, separately test microphone capture. | Audible, synchronized output; visible recovery if autoplay is blocked. Voice is not silently assumed supported. |
| Session lifecycle | Start/stop 20 times, interrupt network, kill client, restart relay and reboot body. Start a second head while the first is busy. | Clear state transitions; no eviction of another head, orphan stream or stuck allocation; returns to catalog/retry state. |
| Kiosk | Cold boot, power loss, standby/wake, scheduled power cycle, network unavailable at boot. Attempt visitor escape. | Returns to assigned kiosk without workstation/manual login; defined operator escape and offline UI; no exposed credentials/admin desktop. |
| Network | Venue Ethernet first, then actual deployment Wi-Fi/routed path; force relay path where required. | ICE connection and input channel work, recover after outage; packet loss/RTT measured at that venue. |
| Performance | 30-minute interactive run followed by an 8-hour loop with repeated session transitions. Try higher resolutions only after baseline passes. | FPS/drop trend, decoder/thermal/memory behavior, audio drift and measured touch-to-photon distribution. Agree a latency budget for the experience before marking this gate passed. |
| Update/recovery | Update test build, interrupt a download, restart, roll back to last working signed build. | Identity/trust preserved, invalid/incomplete artifacts rejected, recovery without a development laptop. |

The 720p/1080p values and soak durations are proposed acceptance workloads, not
manufacturer guarantees. Record the tested ceiling. Do not claim 4K60, HEVC,
HDR or 20 simultaneous remote touches from panel marketing specifications.

If the browser path cannot run, record which requirement failed before moving
to a native Samsung WASM trial. If embedded deployment remains unsuitable,
test an external Linux head with both HDMI/DP video and the correct USB touch
upstream port. The external route must pass touch, boot and lifecycle gates too.

## Result record

Create one record per model/firmware/launch method, attached to #769:

```text
Model / regional suffix:
Firmware / OS / web engine / ABI:
Launch method and artifact SHA256 / commit:
Network / body / relay / experience versions:
Probe JSON:
Each gate: PASS / FAIL / NOT RUN, with evidence:
Measured stream settings / decoder / FPS / drops / latency:
Touch mode and supported gesture set:
Boot / recovery / update results:
Known limitations:
Operator / date:
Support decision: experimental / accepted for these settings / rejected
```

Only mark a model supported after its required gates pass. Keep untested models
explicitly unverified even when they share an OS or product family.
