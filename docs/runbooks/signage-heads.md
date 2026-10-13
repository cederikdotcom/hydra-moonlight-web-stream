# Touch signage heads: issue 769

Research and preparation: 2026-10-13. Tracker: [ExperienceNet #769](https://issues.experiencenet.com/admin/issues/769).

**Status: feasibility assessed; no target display tested; no model certified.**
The delivered code is a local browser capability probe, not a signage client.
The implementation backlog below is still open. Keep #769 open until the
model-specific acceptance results exist.

**Correction after reviewing earlier issues:** ExperienceNet already recorded
Samsung client work under `hydraheadsamsungtv`. The initial inventory missed
that tracker history. Recover and assess this work before creating a new
Samsung client. The absence of an accessible repository is not evidence that
the earlier implementation never existed.

## Existing Samsung work: issues 26 and 141

- [Issue 26](https://issues.experiencenet.com/admin/issues/26), marked done,
  contains a 2026-03-15 implementation report for a Phase 1 WebRTC proof of
  concept named `hydraheadsamsungtv`: `config.xml`, fullscreen iframe in
  `index.html`, `js/main.js` creating a neck-controller session and loading its
  stream URL, connection-status overlay, visibility handling and
  `TECHNICAL_NOTES.md`. Its completion report explicitly leaves deployment to
  an emulator/physical Samsung TV and streaming validation as next steps.
  Its declared target was Tizen 7.0+, so it cannot be assumed installable on
  the requested Tizen 6.5 QMB-T panels. Recover the code to inspect actual
  APIs, credentials, frame policies and signaling before adapting the target.
- [Issue 141](https://issues.experiencenet.com/admin/issues/141), still open,
  proposes a later native GameStream approach: fork
  `brightcraft/moonlight-tizen`, add a Hydra JS/WASM bridge, cluster-mediated
  pairing and remote `.wgt` deployment. It names QE43Q7FA/QE55Q7FA consumer TVs
  as its intended bench, not the QM43B-T/QM55B-T signage panels. This is a
  plan, not a retrieved implementation or validation report.
- Neither record establishes a fork of `tsoas/moonlight-webrtc-tizen`. The
  March PoC instead reused Hydra's own browser/relay infrastructure; the May
  proposal names Brightcraft explicitly.

Source recovery status on 2026-10-13: direct GitHub lookups for
`cederikdotcom/hydraheadsamsung` and `cederikdotcom/hydraheadsamsungtv` did not
resolve under the current credentials. A paginated accessible-repository
inventory and the ExperienceNet organization listing did not return them.
No matching checkout or the issue-141 plan file
`~/.claude/plans/shimmering-rolling-avalanche.md` was found in the searched
workspace locations. The source may be on the original workstation, under
another name/account, or inaccessible; it has not been inspected. Do not
equate the tracker status `done` with hardware validation.

## Direction

Prefer the displays' built-in computers. Reuse the browser relay for the Samsung
trial and the existing Android Moonlight/Hydra code for the iiyama trial. An
external Linux head connected by HDMI and USB is the fallback proposal. This
preference is an engineering assumption pending the owner's response, not a
decision to purchase additional computers.

Do not create three model-specific forks. The useful split is Tizen signage,
Android flat signage, and an external desktop head. Model/firmware capability
profiles should sit above those shared transports.

## Hardware evidence

| Requested model | Vendor evidence | Consequence | Still unknown |
|---|---|---|---|
| Samsung QM43B-T | Tizen 6.5, 3840×2160, capacitive touch; HDMI/DP and touch-out | No Android APK or desktop AppImage installation. Trial a signage web app. | Exact firmware/web engine, WebRTC codec/data-channel support, app installation/signing and boot behavior |
| Samsung QM55B-T | Same Tizen 6.5 / SSSP 10 generation, UHD and touch-out | Share the Samsung implementation; qualify this size independently. | Same unknowns; passing the 43-inch unit does not certify the 55-inch unit |
| iiyama T4362AS-B1 | Android 8.0; CA73×2 + A53×2, Mali G51; 2 GB RAM + 1 GB embedded; 16 GB eMMC; 20-point USB HID touch with supported OS | Native Android candidate; query actual ABI and MediaCodec capabilities. | Android userspace bitness, decoder throughput, APK/VPN permissions, boot launcher and update support |

Sources: Samsung [QM43B-T product page](https://www.samsung.com/sg/business/smart-signage/interactive-display/qmb-t-smart-signage-qmb-t-43-lh43qmbtbgcxxs/),
[QM55B-T product page](https://www.samsung.com/sg/business/smart-signage/interactive-display/qmb-t-smart-signage-qm55b-t-uhd-4k-capacitive-touch-8ms-lh55qmbtbgcxxy/),
and [QMB-T brochure](https://images.samsung.com/is/content/samsung/assets/global/business/ds-showcase-2021/pdf/SMART_Signage_QMR-T_series_Brochure_200529_WEB_final.pdf).
iiyama [product page](https://iiyama.com/gb_en/products/prolite-t4362as-b1/)
and [datasheet](https://iiyama.com/pdf/Product/933/en.pdf).

iiyama lists this model as EOL, with a successor. Its documentation permits
sideloading rather than Play Store installation and lists Windows/Linux for
external USB touch, with macOS unsupported. Do not choose a Mac Mini as the
default touch fallback. A 4K panel or file playback specification does not prove
low-latency 4K decoding over WebRTC or GameStream.

## Existing repositories checked

These are inspected local revisions, not claims that every deployed machine is
running them. `hydra-moonlight-web-stream` and `hydraheadquest` matched their
origin/master after fetch. The owner's GitHub repository inventory was also
searched; no dedicated Samsung/Tizen/iiyama head repository was found in the
returned inventory. This search missed the recorded `hydraheadsamsungtv` work
described above; its source remains unlocated.

| Repository / revision | Reuse and limitations |
|---|---|
| `hydraheadflatscreen` `6c9867a` | Desktop head agent: enrollment/config, pairing, catalog, stream lifecycle, updates. Linux kiosk implementation exists; Windows kiosk/Qt installation remains a stub per `docs/platform-parity.md`. Go's Linux target does not make this installable on Tizen or Android. |
| `hydra-experiencenet` `80789518` | Moonlight-Qt/SDL kiosk and desktop streaming, including `--display-index`. Reuse with an external Linux computer. HDMI alone does not carry touch; USB upstream and OS display mapping are also required. |
| `hydraheadquest` `9eaf8ee5` | Existing Android Moonlight fork, Kotlin Hydra enrollment/state machine, catalog, Sunshine pairing, heartbeat, screenshots, WireGuard and plain `Game` activity. Best starting point for an Android flat variant. Shipped Quest defaults are not a signage profile. |
| `hydracluster` `c7d7ab0` | `handleFleetEnrollHead` accepts only iPad/Quest types; unknown types return HTTP 400. Head-role allowlists, catalog XR filtering and node/update handling also need review for a new flat Android/browser type. |
| `hydraheadwebstream` `a0bfda5` | Serve mode selects experience/body and creates relay sessions. Run mode is a legacy desktop polling agent. Serve mode is a browser-session orchestrator, not a persistent enrolled signage kiosk. Existing local changes were left untouched. |
| `hydraneckwebrtc` `8f4632b` | Existing relay session orchestration, quality selection and orientation path. Keep Sunshine credentials and body orchestration here/on the server. |
| `hydra-moonlight-web-stream` `d225b81` | Existing Rust Moonlight-to-WebRTC bridge and browser video/input client. Place browser diagnostics and transport compatibility work here; no duplicate gateway needed for the initial trial. |
| `hydraadb` `a61196b` | Existing Android debugging host. Useful only if the iiyama firmware actually exposes and authorizes ADB. It does not provide Android MDM or kiosk provisioning. |
| `hydramdm` `54bbc5f` | Apple device management; does not establish Android/Tizen enrollment or deployment support. |
| `hydraheadipad` `e6def28`, `hydraheadmacos` `be5cc18` | Native Apple siblings. The iPad API contract and absolute-mouse touch behavior are useful references, not binaries for these displays. |
| `hydrahead` `50bfa06` | Older head repository/name. Current desktop work belongs in `hydraheadflatscreen`; its release updater still uses the `hydrahead` project name. |
| `omarchy-hydra-experiencenet` `1e28532` | Omarchy bar integration, not a Tizen/Android application. Useful on the external Linux fallback only. |

## Samsung: browser first, native transport as an alternative

The first trial should use this existing path:

```text
Samsung signage web app/browser
  -> hydraheadwebstream (catalog and session orchestration)
  -> hydraneckwebrtc (relay lifecycle)
  -> hydra-moonlight-web-stream (WebRTC + input <-> GameStream)
  -> Sunshine body
```

Use H.264, SDR, stereo Opus and the WebRTC video-track/video-element path for
the first measurement. Start at 1280×720, 30 fps, 5 Mbps, then attempt 1080p60
at 10 Mbps. These are proposed trial settings, not measured limits. Disable
microphone requirements for the first trial; add voice only for experiences
that require it and test permission/audio behavior separately.

`web/stream/video/pipeline.ts` already has a direct video-track renderer; this
path does not require WebCodecs. Missing `VideoDecoder` alone is not a blocker.
An MP4 `canPlayType` result also cannot establish WebRTC codec support. Verify
the actual received codec, audio and input channel with a real session.

Samsung's [web engine table](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html)
associates Tizen 6.5 with Chromium M85. This is a baseline to investigate, not
proof of the installed signage runtime. Browser, URL/custom launcher and a
packaged app can expose different features. Record which one was tested.

Samsung's [signage FAQ](https://developer.samsung.com/smarttv/develop/faq/changes-and-news.html?device=signage)
documents USB installation through Custom App Launcher, a 6.5 required-version
setting when using the newer product APIs, and no Node.js application runtime
since 6.5. Confirm privileges, certificates and update/recovery on the exact
firmware. [Signage model-group distribution](https://developer.samsung.com/smarttv/develop/specifications/signage-model-groups.html?device=signage)
requires contact with Samsung for store submission; consumer TV installation
instructions do not establish a production signage distribution route.

Other existing projects were checked, rather than assuming we need a new port:

- [brightcraft/moonlight-tizen](https://github.com/brightcraft/moonlight-tizen)
  offers direct GameStream using Samsung WASM playback and sockets extensions.
  It targets consumer TVs. It is a candidate if those extensions work on QMB-T,
  not evidence of QMB-T touch, deployment or Hydra compatibility. It would need
  a Hydra lifecycle adapter and touch integration. Review its GPL-3.0 obligations
  if code is incorporated.
- [tsoas/moonlight-webrtc-tizen](https://github.com/tsoas/moonlight-webrtc-tizen)
  is a beta TV client plus a Windows gateway. It demonstrates another WebRTC
  approach, but installing its gateway would duplicate our existing relay.
  Its consumer-TV results do not validate either signage model.

Do not replace interactive transport with HLS/DASH as a compatibility shortcut.
Successful media playback would not establish usable interactive latency.

## iiyama: reuse Android, address the actual gaps

The Quest repository's `minSdk 21` is below Android 8's API level 26, but that is
only the manifest floor. Native dependencies, userspace ABI, drivers and vendor
restrictions still decide whether it installs and streams. A 64-bit CPU does
not prove a 64-bit Android userspace. Inspect the APK's native libraries against
`ro.product.cpu.abilist` before selecting a build.

Concrete source findings at `9eaf8ee5`:

- `PreferenceConfiguration.java`: `DEFAULT_ENABLE_VR_MODE = true`.
  `HydraStreamHooks.buildGameIntent()` chooses `GameXR` when enabled. Merely
  sideloading the current Quest APK is not a flat-signage solution.
- `HydraStreamHooks.kt`: 150000 kbps on LAN, 20000 kbps for its mesh-host path,
  60 fps, resolution from the experience. Its session launch rewrites these
  preferences, so changing them once in Moonlight settings is insufficient.
- `HydraClusterClient.enroll()`: hardcoded `type: hydraheadquest`.
  `HydraEnrollmentActivity.defaultHeadName()`: `quest-head-` plus six ID chars.
  A signage head must not masquerade as a Quest or expose XR-only experiences.
- The manifest retains XR activities/metadata and the build includes OpenXR
  and depth libraries. Isolate a flat product variant and inspect the merged
  manifest and native ABI output; do not delete working Quest behavior globally.
- Manual enrollment already exists. A camera or Google Play Services should
  not become a prerequisite. WireGuard's VPN consent must be checked on-device;
  alternatively route a venue LAN through the existing neck/router.

Proposed implementation: an explicit flat profile/build variant reusing
`com.limelight.hydra`, `Game`, pairing and state management. Keep a separate app
identity/signing/update lane from the existing Quest fleet. Centralize device
identity, enrollment role/capabilities, default input and stream limits in that
profile. Define the corresponding cluster role/API behavior with tests before
sending a new `type`; `pkg/api/handlers_head.go` currently rejects any type other
than empty/iPad or Quest with HTTP 400. Check `handlers_head_experiences.go`,
`handlers_api.go` and store role handling as well as the enrollment switch.

Prefer bounded H.264/SDR trial settings, flat-only catalog capabilities and
absolute mouse simulation for mouse-bound experiences. Test true multitouch
separately with a touch-aware experience. The iPad's
`docs/runbooks/runbook.md` documents why native touch injection and mouse-bound
Unreal experiences are not interchangeable.

## Browser and fleet gaps shared by both models

`web/stream/input.ts` defaults to `mouseRelative`; `pointAndDrag` and native
`touch` modes already exist. For public touch displays, select and persist the
appropriate mode in a signage profile rather than altering every browser user's
default. Verify aspect-ratio bars, all edges, portrait mapping, cancellation,
and cleanup of pressed buttons when focus/network is lost.

Browser stream access is not full head support. A production signage client
still needs per-device enrollment/token revocation, stable identity, venue and
catalog scope, heartbeat, assignment/self-service transitions, session ownership,
stop/cleanup, boot launch, recovery and a supported update path. Adapt the
existing head API contract rather than inventing a second orchestration model.
Keep cluster admin/Sunshine credentials out of browser storage, URLs and packages.
Use a per-device, scoped credential or server-side session mediation.

For a browser outside the mesh, the relay owns body connectivity. Check HTTPS,
WSS and reachable ICE endpoints, including the venue's actual firewall/NAT.
Do not infer relay capacity or routing from a page loading successfully.
Orientation must agree across stream encoding, Sunshine display and app window;
the desktop runbook documents that three-layer contract.

## Delivered diagnostic and next steps

`web/signage-probe.html` and `web/signage-probe.js` are standalone static files.
They are included by the existing `copy-static` build step. They use no app
bindings or login and upload nothing. The probe checks prerequisite APIs, creates
a receive offer to inspect H.264/Opus/SCTP, and records local touch events. It
does not gather ICE candidates, connect to a peer or request camera/mic access.
The five-second deadline closes resources even if the browser never resolves
the offer. A clear report is evidence to proceed to testing, not a support badge.

Run `node --test tests/signage-probe.test.cjs` without installing dependencies.
See [the acceptance testbook](../testbooks/signage-heads.md) for serving the page
and collecting device evidence.

Remaining work, in order:

0. Recover `hydraheadsamsungtv` from issue 26 and reconcile it with the native
   proposal in issue 141. Reuse its applicable code and document the chosen
   transport. Inspect the Tizen 7.0 target versus these 6.5 panels before
   producing a replacement launcher.
1. Collect one exact unit's firmware/ABI/browser report for each model. Trial
   the existing browser relay and Android flat `Game` path with conservative
   settings. Record failures instead of changing production fleet defaults.
2. Implement the Android flat profile and cluster role/capability contract,
   with build/manifest tests, fake-server enrollment/lifecycle tests, and a
   signed test APK. Build infrastructure can do this without owning a display;
   install, decode and kiosk acceptance still require the panel.
3. Implement browser head identity/lifecycle and the signage input/settings
   profile in existing repositories. Test orchestration with fake services;
   package a Tizen launcher only after its runtime/install route is established.
4. Qualify boot/reconnect/touch/soak and deployment on all three model/firmware
   combinations. Publish versioned support evidence and then release normally.
5. If embedded runtime/deployment fails a required gate, qualify an external
   Linux head with HDMI plus USB touch. Record this explicitly as external-head
   support rather than claiming support for the built-in OS.

No release, production deployment, enrollment, body allocation or device test
was performed as part of this preparation.
