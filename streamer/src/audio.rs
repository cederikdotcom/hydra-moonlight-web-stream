use std::sync::Weak;

use log::{debug, error, warn};
use moonlight_common::stream::audio::{
    AudioConfig, AudioDecoder, AudioSample, OpusMultistreamConfig,
};
use tokio::sync::mpsc;

use crate::StreamConnection;

pub(crate) struct StreamAudioDecoder {
    pub(crate) stream: Weak<StreamConnection>,
    /// Channel sender for non-blocking audio sample delivery to the async consumer task.
    audio_sample_sender: Option<mpsc::Sender<Vec<u8>>>,
}

impl StreamAudioDecoder {
    pub(crate) fn new(stream: Weak<StreamConnection>) -> Self {
        Self {
            stream,
            audio_sample_sender: None,
        }
    }
}

impl AudioDecoder for StreamAudioDecoder {
    fn setup(&mut self, audio_config: AudioConfig, stream_config: OpusMultistreamConfig) -> i32 {
        let Some(stream) = self.stream.upgrade() else {
            warn!("Failed to setup audio because stream is deallocated");
            return -1;
        };

        {
            let mut stream_info = stream.stream_setup.blocking_lock();
            stream_info.audio = Some(stream_config.clone());
        }

        // Setup still uses block_on (one-time call, acceptable)
        let result = stream.runtime.clone().block_on(async move {
            let mut sender = stream.transport_sender.lock().await;
            if let Some(sender) = sender.as_mut() {
                let r = sender.setup_audio(audio_config, stream_config).await;
                // Renegotiate ONCE after both video and audio tracks are added.
                // Video setup runs before audio in Moonlight's init sequence,
                // so both tracks exist now. One offer includes both tracks in a
                // single SDP, preventing the signaling race from two concurrent
                // offer/answer exchanges that caused ErrSignalingStateProposedTransitionInvalid.
                if !sender.renegotiate().await {
                    warn!("Failed to renegotiate after track setup");
                }
                r
            } else {
                error!("Failed to setup audio because of missing transport!");
                -1
            }
        });

        // Spawn the consumer task that reads audio samples from the channel
        // and sends them via the transport asynchronously.
        let (sender, mut receiver) = mpsc::channel::<Vec<u8>>(8);
        self.audio_sample_sender = Some(sender);

        let consumer_stream = self.stream.clone();
        let Some(stream) = self.stream.upgrade() else {
            return result;
        };
        stream.runtime.spawn(async move {
            while let Some(sample_data) = receiver.recv().await {
                let Some(stream) = consumer_stream.upgrade() else {
                    break;
                };

                let mut transport = stream.transport_sender.lock().await;
                if let Some(transport) = transport.as_mut() {
                    if let Err(err) = transport.send_audio_sample(&sample_data).await {
                        warn!("Failed to send audio sample: {err}");
                    }
                }
            }
        });

        result
    }

    fn start(&mut self) {}
    fn stop(&mut self) {}

    fn decode_and_play_sample(&mut self, sample: AudioSample) {
        let Some(_stream) = self.stream.upgrade() else {
            warn!("Failed to send audio sample because stream is deallocated");
            return;
        };

        // Non-blocking send — if channel is full, drop the sample.
        // At ~200 samples/sec, dropping one sample is inaudible.
        if let Some(sender) = &self.audio_sample_sender {
            if sender.try_send(sample.buffer.to_vec()).is_err() {
                debug!("Dropping audio sample — channel full (backpressure)");
            }
        } else {
            debug!("Dropping audio packet because channel not initialized");
        }
    }

    fn config(&self) -> AudioConfig {
        AudioConfig::STEREO
    }
}
