use std::{
    sync::{Arc, Weak},
    time::{Duration, Instant},
};

use common::api_bindings::{StatsHostProcessingLatency, StreamerStatsUpdate};
use log::{debug, error, warn};
use moonlight_common::stream::{
    c::bindings::EstimatedRttInfo,
    video::{
        DecodeResult, SupportedVideoFormats, VideoCapabilities, VideoDecodeUnit,
        VideoDecoder, VideoSetup,
    },
};
use tokio::sync::mpsc;

use crate::{StreamConnection, transport::OutboundPacket};

/// Owned copy of a video frame for channel-based delivery.
/// VideoDecodeUnit has borrowed buffers from C — we copy them here so the
/// consumer task can process asynchronously without blocking the C callback thread.
pub(crate) struct OwnedVideoFrame {
    pub frame_data: Vec<u8>,
    pub timestamp: Duration,
    pub is_idr: bool,
}

pub(crate) struct StreamVideoDecoder {
    pub(crate) stream: Weak<StreamConnection>,
    pub(crate) supported_formats: SupportedVideoFormats,
    pub(crate) stats: VideoStats,
    /// Channel sender for non-blocking frame delivery to the async consumer task.
    video_frame_sender: Option<mpsc::Sender<OwnedVideoFrame>>,
}

impl StreamVideoDecoder {
    pub(crate) fn new(stream: Weak<StreamConnection>, supported_formats: SupportedVideoFormats) -> Self {
        Self {
            stream,
            supported_formats,
            stats: VideoStats::default(),
            video_frame_sender: None,
        }
    }
}

impl VideoDecoder for StreamVideoDecoder {
    fn setup(&mut self, setup: VideoSetup) -> i32 {
        let Some(stream) = self.stream.upgrade() else {
            warn!("Failed to setup video because stream is deallocated");
            return -1;
        };

        {
            let mut stream_info = stream.stream_setup.blocking_lock();
            stream_info.video = Some(setup);
        }

        // Setup still uses block_on (one-time call, acceptable)
        let result = stream.runtime.clone().block_on(async {
            let mut sender = stream.transport_sender.lock().await;

            if let Some(sender) = sender.as_mut() {
                sender.setup_video(setup).await
            } else {
                error!("Failed to setup video because of missing transport!");
                -1
            }
        });

        // Spawn the consumer task that reads frames from the channel and sends
        // them via the transport. This decouples the C callback thread from
        // the async WebRTC send path, preventing tokio worker thread starvation.
        let (sender, mut receiver) = mpsc::channel::<OwnedVideoFrame>(2);
        self.video_frame_sender = Some(sender);

        let consumer_stream = self.stream.clone();
        stream.runtime.spawn(async move {
            while let Some(frame) = receiver.recv().await {
                let Some(stream) = consumer_stream.upgrade() else {
                    break;
                };

                let mut transport = stream.transport_sender.lock().await;
                if let Some(transport) = transport.as_mut() {
                    if let Err(err) = transport
                        .send_owned_video_frame(frame.frame_data, frame.timestamp, frame.is_idr)
                        .await
                    {
                        warn!("Failed to send video frame: {err}");
                    }
                }
            }
        });

        result
    }

    fn start(&mut self) {}
    fn stop(&mut self) {}

    fn submit_decode_unit(&mut self, unit: VideoDecodeUnit<'_>) -> DecodeResult {
        let Some(stream) = self.stream.upgrade() else {
            warn!("Failed to send video decode unit because stream is deallocated");
            return DecodeResult::Ok;
        };

        let start = Instant::now();

        // Copy frame data from borrowed C buffers into owned Vec
        let mut frame_data = Vec::new();
        for buffer in unit.buffers {
            frame_data.extend_from_slice(buffer.data);
        }

        let owned_frame = OwnedVideoFrame {
            frame_data,
            timestamp: unit.timestamp,
            is_idr: matches!(unit.frame_type, moonlight_common::stream::video::FrameType::Idr),
        };

        // Non-blocking send — if channel is full, drop the frame.
        // This is correct for real-time video; the downstream TrackLocalSender
        // already drops frames when its queue is full.
        if let Some(sender) = &self.video_frame_sender {
            if sender.try_send(owned_frame).is_err() {
                debug!("Dropping video frame — channel full (backpressure)");
            }
        } else {
            debug!("Dropping video packet because channel not initialized");
        }

        let frame_processing_time = Instant::now() - start;
        self.stats.analyze(&stream, &unit, frame_processing_time);

        DecodeResult::Ok
    }

    fn supported_formats(&self) -> SupportedVideoFormats {
        self.supported_formats
    }

    fn capabilities(&self) -> VideoCapabilities {
        VideoCapabilities::default()
    }
}

#[derive(Debug, Default)]
pub(crate) struct VideoStats {
    last_send: Option<Instant>,
    min_host_processing_latency: Duration,
    max_host_processing_latency: Duration,
    total_host_processing_latency: Duration,
    host_processing_frame_count: usize,
    min_streamer_processing_time: Duration,
    max_streamer_processing_time: Duration,
    total_streamer_processing_time: Duration,
    streamer_processing_time_frame_count: usize,
}

impl VideoStats {
    fn analyze(
        &mut self,
        stream: &Arc<StreamConnection>,
        unit: &VideoDecodeUnit,
        frame_processing_time: Duration,
    ) {
        if let Some(host_processing_latency) = unit.frame_processing_latency {
            self.min_host_processing_latency = self
                .min_host_processing_latency
                .min(host_processing_latency);
            self.max_host_processing_latency = self
                .max_host_processing_latency
                .max(host_processing_latency);
            self.total_host_processing_latency += host_processing_latency;
            self.host_processing_frame_count += 1;
        }

        self.min_streamer_processing_time =
            self.min_streamer_processing_time.min(frame_processing_time);
        self.max_streamer_processing_time =
            self.max_streamer_processing_time.max(frame_processing_time);
        self.total_streamer_processing_time += frame_processing_time;
        self.streamer_processing_time_frame_count += 1;

        // Send in 1 sec intervall
        if self
            .last_send
            .map(|last_send| last_send + Duration::from_secs(1) < Instant::now())
            .unwrap_or(true)
        {
            // Collect data
            let has_host_processing_latency = self.host_processing_frame_count > 0;
            let min_host_processing_latency = self.min_host_processing_latency;
            let max_host_processing_latency = self.max_host_processing_latency;
            let avg_host_processing_latency = self
                .total_host_processing_latency
                .checked_div(self.host_processing_frame_count as u32)
                .unwrap_or(Duration::ZERO);

            let min_streamer_processing_time = self.min_streamer_processing_time;
            let max_streamer_processing_time = self.max_streamer_processing_time;
            let avg_streamer_processing_time = self
                .total_streamer_processing_time
                .checked_div(self.streamer_processing_time_frame_count as u32)
                .unwrap_or(Duration::ZERO);

            // Send data
            let runtime = stream.runtime.clone();

            let stream = stream.clone();
            runtime.spawn(async move {
                stream
                    .try_send_packet(
                        OutboundPacket::Stats(StreamerStatsUpdate::Video {
                            host_processing_latency: has_host_processing_latency.then_some(
                                StatsHostProcessingLatency {
                                    min_host_processing_latency_ms: min_host_processing_latency
                                        .as_secs_f64()
                                        * 1000.0,
                                    max_host_processing_latency_ms: max_host_processing_latency
                                        .as_secs_f64()
                                        * 1000.0,
                                    avg_host_processing_latency_ms: avg_host_processing_latency
                                        .as_secs_f64()
                                        * 1000.0,
                                },
                            ),
                            min_streamer_processing_time_ms: min_streamer_processing_time
                                .as_secs_f64()
                                * 1000.0,
                            max_streamer_processing_time_ms: max_streamer_processing_time
                                .as_secs_f64()
                                * 1000.0,
                            avg_streamer_processing_time_ms: avg_streamer_processing_time
                                .as_secs_f64()
                                * 1000.0,
                        }),
                        "host / streamer processing latency",
                        false,
                    )
                    .await;

                // Send RTT info
                let ml_stream_lock = stream.stream.read().await;
                if let Some(ml_stream) = ml_stream_lock.as_ref() {
                    let rtt = ml_stream.estimated_rtt_info();
                    drop(ml_stream_lock);

                    match rtt {
                        Ok(EstimatedRttInfo { rtt, rtt_variance }) => {
                            stream
                                .try_send_packet(
                                    OutboundPacket::Stats(StreamerStatsUpdate::Rtt {
                                        rtt_ms: rtt.as_secs_f64() * 1000.0,
                                        rtt_variance_ms: rtt_variance.as_secs_f64() * 1000.0,
                                    }),
                                    "estimated rtt info",
                                    false,
                                )
                                .await;
                        }
                        Err(err) => {
                            warn!("failed to get estimated rtt info: {err:?}");
                        }
                    };
                }
            });

            // Clear data
            self.min_host_processing_latency = Duration::MAX;
            self.max_host_processing_latency = Duration::ZERO;
            self.total_host_processing_latency = Duration::ZERO;
            self.host_processing_frame_count = 0;
            self.min_streamer_processing_time = Duration::MAX;
            self.max_streamer_processing_time = Duration::ZERO;
            self.total_streamer_processing_time = Duration::ZERO;
            self.streamer_processing_time_frame_count = 0;

            self.last_send = Some(Instant::now());
        }
    }
}
