/**
 * voice-chat.js — Real-time voice chat service for IIMAGINE Desktop
 *
 * Pipeline: Mic (WebAudio in renderer) → WAV file → whisper.cpp (STT) → LLM → Kokoro TTS → Speaker
 *
 * The renderer captures audio via MediaRecorder, sends PCM/WAV to main process.
 * This service transcribes via whisper.cpp, then triggers the normal chat flow,
 * and synthesizes the response via the existing TTS service.
 */

const { execFile } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// ─── Config ────────────────────────────────────────────────────────

const WHISPER_DIR = path.join(__dirname, "bin", "whisper");
const WHISPER_BINARY = path.join(WHISPER_DIR, "whisper-cli");
const WHISPER_MODELS_DIR = path.join(os.homedir(), ".iimagine", "models", "whisper");
const DEFAULT_MODEL = "ggml-base.en.bin";
const TEMP_DIR = path.join(os.homedir(), ".iimagine", "voice-temp");

// ─── Voice Chat Service ────────────────────────────────────────────

class VoiceChatService {
  constructor(ttsService) {
    this.ttsService = ttsService;
    this.isListening = false;
    this.mainWindow = null;

    // Ensure temp directory exists
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
  }

  setMainWindow(win) {
    this.mainWindow = win;
  }

  /**
   * Check if whisper is available (binary + model exist)
   */
  checkSetup() {
    const hasBinary = fs.existsSync(WHISPER_BINARY);
    const modelPath = path.join(WHISPER_MODELS_DIR, DEFAULT_MODEL);
    const hasModel = fs.existsSync(modelPath);

    return {
      ready: hasBinary && hasModel,
      hasBinary,
      hasModel,
      modelPath: hasModel ? modelPath : null,
      binaryPath: hasBinary ? WHISPER_BINARY : null,
    };
  }

  /**
   * Transcribe audio buffer (WAV format) to text using whisper.cpp
   * @param {Buffer} audioBuffer - WAV audio data
   * @returns {Promise<{text: string, duration: number}>}
   */
  async transcribe(audioBuffer) {
    const setup = this.checkSetup();
    if (!setup.ready) {
      throw new Error("Voice chat not set up. Whisper binary or model missing.");
    }

    // Write audio to temp file
    const tempFile = path.join(TEMP_DIR, `voice-${Date.now()}.wav`);
    fs.writeFileSync(tempFile, audioBuffer);

    try {
      const startTime = Date.now();
      const text = await this._runWhisper(tempFile);
      const duration = Date.now() - startTime;

      console.log(`[VoiceChat] Transcribed in ${duration}ms: "${text.slice(0, 80)}..."`);
      return { text: text.trim(), duration };
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(tempFile); } catch {}
    }
  }

  /**
   * Full voice chat turn: transcribe → send to LLM → synthesize response
   * Returns transcription immediately, TTS plays asynchronously
   */
  async processTurn(audioBuffer) {
    // 1. Transcribe
    const { text, duration } = await this.transcribe(audioBuffer);

    if (!text || text.length < 2) {
      return { success: false, error: "No speech detected", transcription: "" };
    }

    // Filter out whisper artifacts (blank audio, music tags, etc.)
    const cleaned = text.replace(/\[.*?\]/g, "").replace(/\(.*?\)/g, "").trim();
    if (!cleaned || cleaned.length < 2) {
      return { success: false, error: "No speech detected", transcription: "" };
    }

    // Notify renderer of transcription
    if (this.mainWindow) {
      this.mainWindow.webContents.send("voice:transcription", { text: cleaned, duration });
    }

    return { success: true, transcription: cleaned, sttDuration: duration };
  }

  /**
   * Synthesize text to speech and return audio path
   */
  async synthesizeResponse(text) {
    if (!this.ttsService) {
      return { success: false, error: "TTS service not available" };
    }

    try {
      const result = await this.ttsService.synthesize(text);
      if (result && result.audioPath) {
        return { success: true, audioPath: result.audioPath };
      }
      return { success: false, error: "TTS returned no audio" };
    } catch (err) {
      console.error("[VoiceChat] TTS error:", err.message);
      return { success: false, error: err.message };
    }
  }

  // ─── Private Methods ──────────────────────────────────────────

  _runWhisper(audioFile) {
    return new Promise((resolve, reject) => {
      const modelPath = path.join(WHISPER_MODELS_DIR, DEFAULT_MODEL);

      const args = [
        "-m", modelPath,
        "-f", audioFile,
        "--no-prints",
        "--no-timestamps",
        "-t", "4",
        "--language", "en",
      ];

      const env = {
        ...process.env,
        DYLD_LIBRARY_PATH: WHISPER_DIR,
        PATH: `${WHISPER_DIR}:${process.env.PATH}`,
      };

      execFile(WHISPER_BINARY, args, {
        encoding: "utf8",
        timeout: 30000,
        env,
        cwd: WHISPER_DIR,
      }, (error, stdout, stderr) => {
        if (error) {
          console.error("[VoiceChat] Whisper error:", error.message);
          if (stderr) console.error("[VoiceChat] Whisper stderr:", stderr);
          reject(new Error(`Transcription failed: ${error.message}`));
          return;
        }

        // whisper-cli outputs text with timestamps stripped (--no-timestamps)
        const text = stdout.trim();
        resolve(text);
      });
    });
  }

  // ─── IPC Registration ─────────────────────────────────────────

  registerIPC(ipcMain) {
    ipcMain.handle("voice:check-setup", async () => this.checkSetup());

    ipcMain.handle("voice:transcribe", async (_event, audioBuffer) => {
      try {
        return await this.transcribe(Buffer.from(audioBuffer));
      } catch (err) {
        return { error: err.message };
      }
    });

    ipcMain.handle("voice:process-turn", async (_event, audioBuffer) => {
      try {
        return await this.processTurn(Buffer.from(audioBuffer));
      } catch (err) {
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle("voice:synthesize", async (_event, text) => {
      try {
        return await this.synthesizeResponse(text);
      } catch (err) {
        return { success: false, error: err.message };
      }
    });
  }
}

module.exports = VoiceChatService;
