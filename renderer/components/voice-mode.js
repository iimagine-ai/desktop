/**
 * voice-mode.js — Voice chat UI component
 *
 * Handles: mic capture via MediaRecorder, VAD (silence detection),
 * sending audio to main process for transcription, playing TTS responses.
 */

const VoiceMode = {
  isRecording: false,
  isProcessing: false,
  mediaRecorder: null,
  audioChunks: [],
  audioContext: null,
  analyser: null,
  silenceTimer: null,
  stream: null,

  // Config
  SILENCE_THRESHOLD: 0.005, // RMS below this = silence (lowered to avoid false triggers)
  SILENCE_DURATION: 2000, // ms of silence before auto-stop
  MIN_RECORDING_MS: 2000, // minimum recording time before silence detection activates
  MAX_RECORDING_MS: 60000, // max 60s per turn

  /**
   * Initialize voice mode — check if available
   */
  async checkAvailable() {
    const setup = await window.api.voice.checkSetup();
    return setup.ready;
  },

  /**
   * Start recording from microphone
   * @param {Function} onTranscription - Called with transcribed text
   * @param {Function} onStateChange - Called with state updates ('recording', 'processing', 'idle')
   */
  async startRecording(onTranscription, onStateChange) {
    if (this.isRecording) return;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Set up audio analysis for VAD
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      source.connect(this.analyser);

      // MediaRecorder for capturing audio
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.audioChunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        this.isRecording = false;
        if (onStateChange) onStateChange("processing");
        this.isProcessing = true;

        try {
          // Convert to WAV and send for transcription
          const audioBlob = new Blob(this.audioChunks, { type: "audio/webm" });
          const wavBuffer = await this._convertToWav(audioBlob);
          const result = await window.api.voice.processTurn(wavBuffer);

          if (result.success && result.transcription) {
            if (onTranscription) onTranscription(result.transcription);
          } else if (result.error && result.error !== "No speech detected") {
            console.warn("[VoiceMode] Transcription issue:", result.error);
          }
        } catch (err) {
          console.error("[VoiceMode] Processing error:", err);
        } finally {
          this.isProcessing = false;
          if (onStateChange) onStateChange("idle");
        }
      };

      // Start recording
      this.mediaRecorder.start(100); // 100ms chunks
      this.isRecording = true;
      if (onStateChange) onStateChange("recording");

      // Start silence detection
      this._startSilenceDetection();

      // Auto-stop after max duration
      this._maxTimer = setTimeout(() => this.stopRecording(), this.MAX_RECORDING_MS);

    } catch (err) {
      console.error("[VoiceMode] Mic access error:", err);
      if (onStateChange) onStateChange("error");
      throw new Error("Microphone access denied. Please allow microphone access.");
    }
  },

  /**
   * Stop recording and trigger transcription
   */
  stopRecording() {
    if (!this.isRecording) return;

    clearTimeout(this.silenceTimer);
    clearTimeout(this._maxTimer);
    this._stopSilenceDetection();

    if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
      this.mediaRecorder.stop();
    }

    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  },

  /**
   * Play audio file (TTS response) — supports interruption via stopAudio()
   */
  async playAudio(audioPath) {
    return new Promise((resolve, reject) => {
      this._currentAudio = new Audio(`file://${audioPath}`);
      this._currentAudio.onended = () => { this._currentAudio = null; resolve(); };
      this._currentAudio.onerror = (e) => { this._currentAudio = null; reject(e); };
      this._currentAudio.play().catch((e) => { this._currentAudio = null; reject(e); });
    });
  },

  /**
   * Stop any currently playing audio (barge-in)
   */
  stopAudio() {
    if (this._currentAudio) {
      this._currentAudio.pause();
      this._currentAudio.currentTime = 0;
      this._currentAudio = null;
    }
  },

  // ─── Private: Silence Detection (VAD) ────────────────────────

  _startSilenceDetection() {
    if (!this.analyser) return;

    const dataArray = new Float32Array(this.analyser.fftSize);
    let silenceStart = null;
    let speechDetected = false;
    const recordingStartTime = Date.now();

    const check = () => {
      if (!this.isRecording) return;

      this.analyser.getFloatTimeDomainData(dataArray);
      const rms = Math.sqrt(dataArray.reduce((sum, v) => sum + v * v, 0) / dataArray.length);

      // Don't check for silence until minimum recording time has passed
      if (Date.now() - recordingStartTime < this.MIN_RECORDING_MS) {
        if (rms > this.SILENCE_THRESHOLD * 2) speechDetected = true;
        this._vadFrame = requestAnimationFrame(check);
        return;
      }

      // Only trigger silence stop if speech was actually detected at some point
      if (rms > this.SILENCE_THRESHOLD * 2) {
        speechDetected = true;
        silenceStart = null;
      } else if (speechDetected) {
        if (!silenceStart) silenceStart = Date.now();
        else if (Date.now() - silenceStart > this.SILENCE_DURATION) {
          // Silence after speech — stop recording
          this.stopRecording();
          return;
        }
      }

      this._vadFrame = requestAnimationFrame(check);
    };

    this._vadFrame = requestAnimationFrame(check);
  },

  _stopSilenceDetection() {
    if (this._vadFrame) {
      cancelAnimationFrame(this._vadFrame);
      this._vadFrame = null;
    }
  },

  // ─── Private: Audio Conversion ────────────────────────────────

  async _convertToWav(webmBlob) {
    // Decode the webm audio to raw PCM using OfflineAudioContext
    const arrayBuffer = await webmBlob.arrayBuffer();
    const audioCtx = new OfflineAudioContext(1, 16000 * 30, 16000);
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // Get PCM data
    const pcmData = audioBuffer.getChannelData(0);
    const length = pcmData.length;

    // Create WAV file
    const wavBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(wavBuffer);

    // WAV header
    this._writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + length * 2, true);
    this._writeString(view, 8, "WAVE");
    this._writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // chunk size
    view.setUint16(20, 1, true); // PCM format
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, 16000, true); // sample rate
    view.setUint32(28, 32000, true); // byte rate
    view.setUint16(32, 2, true); // block align
    view.setUint16(34, 16, true); // bits per sample
    this._writeString(view, 36, "data");
    view.setUint32(40, length * 2, true);

    // PCM data (float32 → int16)
    let offset = 44;
    for (let i = 0; i < length; i++) {
      const s = Math.max(-1, Math.min(1, pcmData[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    // Return as Uint8Array for IPC transfer
    return Array.from(new Uint8Array(wavBuffer));
  },

  _writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  },
};
