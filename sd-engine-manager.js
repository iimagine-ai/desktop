// IIMAGINE SD Engine Manager — manages bundled stable-diffusion.cpp process
// Sister module to engine-manager.js (llama.cpp). Handles image generation
// locally using stable-diffusion.cpp with Metal acceleration on Apple Silicon.
// Binary is renamed to "iimagine-sd-engine" and lives alongside the LLM engine.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Store = require('electron-store');

const store = new Store();

// Paths
const SD_BINARY_NAME = process.platform === 'win32' ? 'iimagine-sd-engine.exe' : 'iimagine-sd-engine';
const SD_MODELS_DIR_NAME = 'sd-models';
const OUTPUT_DIR_NAME = 'sd-output';

// State
let isGenerating = false;
let currentProcess = null;

/**
 * Get the path to the SD engine binary.
 * Mirrors engine-manager.js logic for dev vs production.
 */
function getEnginePath() {
  const isDev = !require('electron')?.app?.isPackaged;

  if (isDev) {
    const devPath = path.join(__dirname, 'bin', SD_BINARY_NAME);
    return devPath;
  }

  const resourcesPath = process.resourcesPath || path.join(__dirname, '..', '..', 'Resources');
  const prodPath = path.join(resourcesPath, 'bin', SD_BINARY_NAME);
  return prodPath;
}

/**
 * Get the SD models directory (~/.iimagine/sd-models/)
 */
function getModelsDir() {
  const modelsPath = path.join(os.homedir(), '.iimagine', SD_MODELS_DIR_NAME);
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true });
  }
  return modelsPath;
}

/**
 * Get the output directory for generated images (~/.iimagine/sd-output/)
 */
function getOutputDir() {
  const outputPath = path.join(os.homedir(), '.iimagine', OUTPUT_DIR_NAME);
  if (!fs.existsSync(outputPath)) {
    fs.mkdirSync(outputPath, { recursive: true });
  }
  return outputPath;
}

/**
 * Get list of installed SD models (GGUF files in sd-models directory)
 */
function getInstalledModels() {
  const modelsDir = getModelsDir();
  try {
    const files = fs.readdirSync(modelsDir);
    return files
      .filter(f => f.endsWith('.gguf') || f.endsWith('.safetensors'))
      .map(f => {
        const filePath = path.join(modelsDir, f);
        const stats = fs.statSync(filePath);
        const name = f.replace(/\.(gguf|safetensors)$/, '');
        return {
          name,
          filename: f,
          path: filePath,
          size: stats.size,
          sizeGB: Math.round((stats.size / (1024 ** 3)) * 100) / 100,
          modified: stats.mtime,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Check if the SD engine binary exists and is executable
 */
function isEngineInstalled() {
  const enginePath = getEnginePath();
  try {
    if (process.platform === 'win32') {
      fs.accessSync(enginePath, fs.constants.F_OK);
    } else {
      fs.accessSync(enginePath, fs.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get SD engine status
 */
function getStatus() {
  const installed = isEngineInstalled();
  const models = getInstalledModels();
  return {
    installed,
    models,
    isGenerating,
    enginePath: getEnginePath(),
  };
}

/**
 * Generate an image using text-to-image mode.
 * @param {object} params
 * @param {string} params.modelPath - full path to the SD GGUF model file
 * @param {string} params.prompt - text prompt for generation
 * @param {string} [params.negativePrompt] - negative prompt
 * @param {number} [params.steps] - number of sampling steps (default: 4 for turbo)
 * @param {number} [params.cfgScale] - classifier-free guidance scale (default: 1.0 for turbo)
 * @param {number} [params.width] - output width (default: 1024)
 * @param {number} [params.height] - output height (default: 1024)
 * @param {number} [params.seed] - random seed (-1 for random)
 * @param {function} [params.onProgress] - progress callback
 * @returns {Promise<{success: boolean, imagePath?: string, error?: string}>}
 */
async function txt2img(params) {
  if (isGenerating) {
    return { success: false, error: 'Already generating an image. Please wait.' };
  }

  const enginePath = getEnginePath();
  if (!fs.existsSync(enginePath)) {
    return { success: false, error: 'SD engine binary not found. Please install the image engine.' };
  }

  const {
    modelPath,
    prompt,
    negativePrompt = '',
    steps = 4,
    cfgScale = 1.0,
    width = 1024,
    height = 1024,
    seed = -1,
    onProgress = null,
  } = params;

  if (!modelPath || !fs.existsSync(modelPath)) {
    return { success: false, error: `Model file not found: ${modelPath}` };
  }

  if (!prompt) {
    return { success: false, error: 'Prompt is required' };
  }

  const outputDir = getOutputDir();
  const outputFilename = `txt2img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
  const outputPath = path.join(outputDir, outputFilename);

  const args = [
    '-m', modelPath,
    '-p', prompt,
    '-o', outputPath,
    '--steps', String(steps),
    '--cfg-scale', String(cfgScale),
    '-W', String(width),
    '-H', String(height),
    '-s', String(seed),
  ];

  if (negativePrompt) {
    args.push('-n', negativePrompt);
  }

  // Use all available threads on Apple Silicon
  const cpuCount = os.cpus().length;
  args.push('-t', String(Math.max(1, cpuCount - 2)));

  return _runEngine(args, outputPath, onProgress);
}

/**
 * Generate an image using image-to-image mode.
 * @param {object} params
 * @param {string} params.modelPath - full path to the SD GGUF model file
 * @param {string} params.inputImagePath - path to the source image
 * @param {string} params.prompt - text prompt for transformation
 * @param {string} [params.negativePrompt] - negative prompt
 * @param {number} [params.strength] - denoise strength (0.0-1.0, default: 0.45)
 * @param {number} [params.steps] - number of sampling steps (default: 4 for turbo)
 * @param {number} [params.cfgScale] - classifier-free guidance scale (default: 1.0 for turbo)
 * @param {number} [params.seed] - random seed (-1 for random)
 * @param {function} [params.onProgress] - progress callback
 * @returns {Promise<{success: boolean, imagePath?: string, error?: string}>}
 */
async function img2img(params) {
  if (isGenerating) {
    return { success: false, error: 'Already generating an image. Please wait.' };
  }

  const enginePath = getEnginePath();
  if (!fs.existsSync(enginePath)) {
    return { success: false, error: 'SD engine binary not found. Please install the image engine.' };
  }

  const {
    modelPath,
    inputImagePath,
    prompt,
    negativePrompt = '',
    strength = 0.45,
    steps = 4,
    cfgScale = 1.0,
    seed = -1,
    onProgress = null,
  } = params;

  if (!modelPath || !fs.existsSync(modelPath)) {
    return { success: false, error: `Model file not found: ${modelPath}` };
  }

  if (!inputImagePath || !fs.existsSync(inputImagePath)) {
    return { success: false, error: `Input image not found: ${inputImagePath}` };
  }

  if (!prompt) {
    return { success: false, error: 'Prompt is required' };
  }

  const outputDir = getOutputDir();
  const outputFilename = `img2img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.png`;
  const outputPath = path.join(outputDir, outputFilename);

  const args = [
    '-m', modelPath,
    '-i', inputImagePath,
    '-p', prompt,
    '-o', outputPath,
    '--strength', String(strength),
    '--steps', String(steps),
    '--cfg-scale', String(cfgScale),
    '-s', String(seed),
  ];

  if (negativePrompt) {
    args.push('-n', negativePrompt);
  }

  const cpuCount = os.cpus().length;
  args.push('-t', String(Math.max(1, cpuCount - 2)));

  return _runEngine(args, outputPath, onProgress);
}

/**
 * Run the SD engine binary with given args and wait for completion.
 * @private
 */
function _runEngine(args, outputPath, onProgress) {
  return new Promise((resolve) => {
    isGenerating = true;
    const enginePath = getEnginePath();
    const engineDir = path.dirname(enginePath);

    // Set up environment for shared libraries (same pattern as engine-manager)
    const env = { ...process.env };
    if (process.platform === 'darwin') {
      env.DYLD_LIBRARY_PATH = engineDir + (env.DYLD_LIBRARY_PATH ? ':' + env.DYLD_LIBRARY_PATH : '');
    } else if (process.platform === 'win32') {
      env.PATH = engineDir + ';' + (env.PATH || '');
    } else if (process.platform === 'linux') {
      env.LD_LIBRARY_PATH = engineDir + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
    }

    console.log(`[SD Engine] Running: ${enginePath} ${args.slice(0, 4).join(' ')} ...`);

    let output = '';
    let stderrOutput = '';

    const proc = spawn(enginePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    currentProcess = proc;

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      _parseProgress(text, onProgress);
    });

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderrOutput += text;
      _parseProgress(text, onProgress);
    });

    proc.on('error', (err) => {
      isGenerating = false;
      currentProcess = null;
      resolve({ success: false, error: `Failed to start SD engine: ${err.message}` });
    });

    proc.on('close', (code) => {
      isGenerating = false;
      currentProcess = null;

      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`[SD Engine] Generation complete: ${outputPath}`);
        resolve({ success: true, imagePath: outputPath, filename: path.basename(outputPath) });
      } else {
        const errorMsg = stderrOutput.slice(-500) || output.slice(-500) || `Process exited with code ${code}`;
        console.error(`[SD Engine] Generation failed (code ${code}): ${errorMsg}`);
        resolve({ success: false, error: `Generation failed: ${errorMsg}` });
      }
    });
  });
}

/**
 * Parse progress output from stable-diffusion.cpp
 * The binary prints step progress like: "step 2/4 ..."
 * @private
 */
function _parseProgress(text, onProgress) {
  if (!onProgress) return;

  // stable-diffusion.cpp outputs step progress in various formats
  const stepMatch = text.match(/step\s+(\d+)\s*\/\s*(\d+)/i);
  if (stepMatch) {
    const current = parseInt(stepMatch[1]);
    const total = parseInt(stepMatch[2]);
    const percent = Math.round((current / total) * 100);
    try {
      onProgress({ step: current, totalSteps: total, percent });
    } catch {}
  }
}

/**
 * Cancel an in-progress generation
 */
function cancelGeneration() {
  if (currentProcess) {
    currentProcess.kill('SIGTERM');
    currentProcess = null;
    isGenerating = false;
    return { success: true };
  }
  return { success: false, error: 'No generation in progress' };
}

/**
 * Delete a model file from disk
 */
function deleteModel(filename) {
  const modelsDir = getModelsDir();
  const filePath = path.join(modelsDir, filename);

  if (!filePath.startsWith(modelsDir)) {
    return { success: false, error: 'Invalid path' };
  }

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'File not found' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Get the default model path (first installed SD model)
 */
function getDefaultModelPath() {
  const models = getInstalledModels();
  return models.length > 0 ? models[0].path : null;
}

/**
 * Save a temp image (from base64 or buffer) for use as img2img input.
 * Returns the path to the saved temp file.
 * @param {Buffer|string} imageData - Buffer or base64 string
 * @param {string} [ext='png'] - file extension
 */
function saveTempInput(imageData, ext = 'png') {
  const outputDir = getOutputDir();
  const tempPath = path.join(outputDir, `_input_${Date.now()}.${ext}`);

  if (typeof imageData === 'string') {
    // Assume base64
    const buffer = Buffer.from(imageData, 'base64');
    fs.writeFileSync(tempPath, buffer);
  } else {
    fs.writeFileSync(tempPath, imageData);
  }

  return tempPath;
}

/**
 * Clean up old temp input files (older than 1 hour)
 */
function cleanupTempFiles() {
  const outputDir = getOutputDir();
  try {
    const files = fs.readdirSync(outputDir);
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    for (const f of files) {
      if (f.startsWith('_input_')) {
        const filePath = path.join(outputDir, f);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > oneHour) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch {}
}

module.exports = {
  getEnginePath,
  getModelsDir,
  getOutputDir,
  getInstalledModels,
  isEngineInstalled,
  getStatus,
  txt2img,
  img2img,
  cancelGeneration,
  deleteModel,
  getDefaultModelPath,
  saveTempInput,
  cleanupTempFiles,
};
