//! Server-enforced policy for an isolated managed signage relay process.
use std::net::IpAddr;

use moonlight_common::stream::video::SupportedVideoFormats;
use serde::{Deserialize, Serialize};

use crate::api_bindings::{StreamClientMessage, StreamColorspace, TransportType};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ManagedSignagePolicy {
    pub body_ip: IpAddr,
    pub experience: String,
    pub orientation: Orientation,
    pub profile: Profile,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Orientation {
    #[serde(rename = "landscape")]
    Landscape,
    #[serde(rename = "portrait")]
    Portrait,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Profile {
    #[serde(rename = "tizen65-h264-sdr-720p30-v1")]
    Tizen65H264Sdr720p30V1,
}

impl ManagedSignagePolicy {
    pub fn allows_address(&self, address: &str) -> bool {
        !self.experience.is_empty() && address.parse::<IpAddr>().ok() == Some(self.body_ip)
    }

    pub fn allows_app<'a>(&self, app_id: u32, apps: impl Iterator<Item = (u32, &'a str)>) -> bool {
        if app_id == 0 || self.experience.is_empty() {
            return false;
        }
        let mut matches = apps.filter(|(_, title)| *title == self.experience);
        matches.next() == Some((app_id, self.experience.as_str())) && matches.next().is_none()
    }

    /// Browser preferences cannot widen this trial profile. A client that does
    /// not advertise ordinary H.264 cannot use the managed stream.
    pub fn constrain_message(&self, message: StreamClientMessage) -> Option<StreamClientMessage> {
        match message {
            StreamClientMessage::StartStream {
                video_supported_formats,
                ..
            } => {
                if video_supported_formats & SupportedVideoFormats::H264.bits() == 0 {
                    return None;
                }
                let (width, height) = match self.orientation {
                    Orientation::Landscape => (1280, 720),
                    Orientation::Portrait => (720, 1280),
                };
                Some(StreamClientMessage::StartStream {
                    bitrate: 5000,
                    packet_size: 1200,
                    fps: 30,
                    width,
                    height,
                    play_audio_local: false,
                    video_supported_formats: SupportedVideoFormats::H264.bits(),
                    video_colorspace: StreamColorspace::Rec709,
                    video_color_range_full: false,
                    hdr: false,
                })
            }
            StreamClientMessage::SetTransport(TransportType::WebRTC)
            | StreamClientMessage::WebRtc(_) => Some(message),
            // No second Init and no WebSocket media fallback for this profile.
            _ => None,
        }
    }
}

/// A managed connection initializes exactly one transport and one stream.
#[derive(Default)]
pub struct ManagedSignalingState {
    transport_set: bool,
    started: bool,
}
impl ManagedSignalingState {
    pub fn constrain(
        &mut self,
        policy: &ManagedSignagePolicy,
        message: StreamClientMessage,
    ) -> Option<StreamClientMessage> {
        let duplicate = match &message {
            StreamClientMessage::SetTransport(_) => {
                std::mem::replace(&mut self.transport_set, true)
            }
            StreamClientMessage::StartStream { .. } => {
                !self.transport_set || std::mem::replace(&mut self.started, true)
            }
            _ => false,
        };
        if duplicate {
            None
        } else {
            policy.constrain_message(message)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn policy() -> ManagedSignagePolicy {
        serde_json::from_value(serde_json::json!({"body_ip":"10.10.100.1","experience":"gallery","orientation":"landscape","profile":"tizen65-h264-sdr-720p30-v1"})).unwrap()
    }
    #[test]
    fn exact_body_and_unique_app_required() {
        let p = policy();
        assert!(p.allows_address("10.10.100.1"));
        assert!(!p.allows_address("10.10.100.2"));
        assert!(!p.allows_address("body.example"));
        assert!(p.allows_app(7, [(1, "Desktop"), (7, "gallery")].into_iter()));
        assert!(!p.allows_app(1, [(1, "Desktop"), (7, "gallery")].into_iter()));
        assert!(!p.allows_app(7, [(7, "Gallery")].into_iter()));
        assert!(!p.allows_app(7, [(7, "gallery"), (8, "gallery")].into_iter()));
        assert!(!p.allows_app(0, [(0, "gallery")].into_iter()));
    }
    fn unbounded_start(formats: u32) -> StreamClientMessage {
        StreamClientMessage::StartStream {
            bitrate: 100000,
            packet_size: 65535,
            fps: 240,
            width: 3840,
            height: 2160,
            play_audio_local: true,
            video_supported_formats: formats,
            video_colorspace: StreamColorspace::Rec2020,
            video_color_range_full: true,
            hdr: true,
        }
    }
    #[test]
    fn browser_cannot_expand_trial_media_settings() {
        for (orientation, expected) in [
            (Orientation::Landscape, (1280, 720)),
            (Orientation::Portrait, (720, 1280)),
        ] {
            let mut p = policy();
            p.orientation = orientation;
            let constrained = p.constrain_message(unbounded_start(u32::MAX)).unwrap();
            let StreamClientMessage::StartStream {
                bitrate,
                packet_size,
                fps,
                width,
                height,
                play_audio_local,
                video_supported_formats,
                video_colorspace,
                video_color_range_full,
                hdr,
            } = constrained
            else {
                panic!("not a start")
            };
            assert_eq!((width, height), expected);
            assert_eq!((bitrate, packet_size, fps), (5000, 1200, 30));
            assert_eq!(video_supported_formats, SupportedVideoFormats::H264.bits());
            assert!(matches!(video_colorspace, StreamColorspace::Rec709));
            assert!(!hdr && !play_audio_local && !video_color_range_full);
        }
    }
    #[test]
    fn incompatible_codec_transport_or_reinit_rejected() {
        let p = policy();
        assert!(p.constrain_message(unbounded_start(0)).is_none());
        assert!(
            p.constrain_message(unbounded_start(!SupportedVideoFormats::H264.bits()))
                .is_none()
        );
        assert!(
            p.constrain_message(StreamClientMessage::SetTransport(TransportType::WebSocket))
                .is_none()
        );
        assert!(
            p.constrain_message(StreamClientMessage::SetTransport(TransportType::WebRTC))
                .is_some()
        );
        assert!(
            p.constrain_message(StreamClientMessage::Init {
                host_id: 1,
                app_id: 7,
                video_frame_queue_size: usize::MAX,
                audio_sample_queue_size: usize::MAX
            })
            .is_none()
        );
    }
    #[test]
    fn one_transport_and_one_start_in_order() {
        let p = policy();
        let mut state = ManagedSignalingState::default();
        assert!(state.constrain(&p, unbounded_start(u32::MAX)).is_none());
        let mut state = ManagedSignalingState::default();
        assert!(
            state
                .constrain(&p, StreamClientMessage::SetTransport(TransportType::WebRTC))
                .is_some()
        );
        assert!(state.constrain(&p, unbounded_start(u32::MAX)).is_some());
        assert!(state.constrain(&p, unbounded_start(u32::MAX)).is_none());
        assert!(
            state
                .constrain(&p, StreamClientMessage::SetTransport(TransportType::WebRTC))
                .is_none()
        );
    }
    #[test]
    fn unknown_profile_and_partial_policy_fail_configuration() {
        for value in [
            serde_json::json!({"body_ip":"10.0.0.1"}),
            serde_json::json!({"body_ip":"10.0.0.1","experience":"gallery","orientation":"landscape","profile":"unbounded"}),
        ] {
            assert!(serde_json::from_value::<ManagedSignagePolicy>(value).is_err());
        }
    }
}
