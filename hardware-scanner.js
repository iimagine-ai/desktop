// Hardware Scanner — cross-platform detection of RAM, GPU, and disk space
// Used by the model recommendation wizard to filter compatible models

const os = require('os');
const { execSync } = require('child_process');
const path = require('path');

/**
 * Detect system hardware specs for model compatibility checking.
 * Returns: { ramGB, gpu: { name, vramGB, type }, diskFreeGB, platform, arch }
 */
async function scanHardware() {
  const platform = process.platform; // 'darwin', 'win32', 'linux'
  const arch = process.arch; // 'arm64', 'x64'

  const ramGB = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
  const gpu = detectGPU(platform);
  const diskFreeGB = detectDiskSpace(platform);

  const result = {
    ramGB,
    gpu,
    diskFreeGB,
    platform,
    arch,
    // Available memory for local AI models:
    // - Apple Silicon: unified memory (all RAM available to GPU)
    // - Windows/Linux with discrete GPU: VRAM is the bottleneck
    // - Windows/Linux without GPU: system RAM (CPU-only inference)
    aiMemoryGB: (platform === 'darwin' && arch === 'arm64')
      ? ramGB  // Unified memory
      : (gpu.vramGB > 0 ? gpu.vramGB : ramGB),  // VRAM if available, else system RAM
  };

  console.log(`[HardwareScanner] platform=${platform} arch=${arch} ramGB=${ramGB} gpu=${gpu.name} vramGB=${gpu.vramGB} aiMemoryGB=${result.aiMemoryGB}`);
  return result;
}

/**
 * Detect GPU info based on platform.
 * Returns: { name, vramGB, type } where type is 'apple_silicon', 'nvidia', 'amd', 'intel', 'unknown'
 */
function detectGPU(platform) {
  try {
    if (platform === 'darwin') {
      return detectGPUMacOS();
    } else if (platform === 'win32') {
      return detectGPUWindows();
    } else {
      return { name: 'Unknown', vramGB: 0, type: 'unknown' };
    }
  } catch (err) {
    console.warn('[HardwareScanner] GPU detection failed:', err.message);
    return { name: 'Unknown', vramGB: 0, type: 'unknown' };
  }
}

/**
 * macOS GPU detection via system_profiler.
 * Apple Silicon shares RAM with GPU (unified memory), so vramGB = total RAM.
 */
function detectGPUMacOS() {
  const output = execSync('system_profiler SPDisplaysDataType -json', {
    encoding: 'utf8',
    timeout: 5000,
  });

  const data = JSON.parse(output);
  const displays = data.SPDisplaysDataType;

  if (!displays || !displays.length) {
    return { name: 'Unknown', vramGB: 0, type: 'unknown' };
  }

  const gpu = displays[0];
  const name = gpu.sppci_model || 'Unknown GPU';

  // Detect Apple Silicon (unified memory — GPU uses system RAM)
  const isAppleSilicon = name.toLowerCase().includes('apple') ||
    gpu.sppci_vendor === 'sppci_vendor_apple' ||
    process.arch === 'arm64';

  if (isAppleSilicon) {
    // Unified memory: GPU can use all system RAM
    const totalRAM = Math.round((os.totalmem() / (1024 ** 3)) * 10) / 10;
    return { name, vramGB: totalRAM, type: 'apple_silicon' };
  }

  // Discrete GPU (older Intel Macs with AMD/NVIDIA)
  const vramStr = gpu.sppci_vram || gpu['sppci_vram_shared'] || '0';
  const vramMB = parseInt(vramStr.replace(/[^0-9]/g, '')) || 0;
  const vramGB = Math.round((vramMB / 1024) * 10) / 10;

  const type = name.toLowerCase().includes('nvidia') ? 'nvidia' :
    name.toLowerCase().includes('amd') ? 'amd' :
    name.toLowerCase().includes('intel') ? 'intel' : 'unknown';

  return { name, vramGB, type };
}

/**
 * Windows GPU detection — tries nvidia-smi first (most reliable for NVIDIA),
 * then PowerShell Get-CimInstance (no 4GB cap like wmic), then wmic as last resort.
 */
function detectGPUWindows() {
  // Try nvidia-smi first (most accurate for NVIDIA GPUs)
  try {
    const nvidiaOutput = execSync(
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
      { encoding: 'utf8', timeout: 5000 }
    );
    const line = nvidiaOutput.trim().split('\n')[0];
    if (line) {
      const [name, memMB] = line.split(',').map(s => s.trim());
      const vramGB = Math.round((parseInt(memMB) / 1024) * 10) / 10;
      if (vramGB > 0) {
        return { name: name || 'NVIDIA GPU', vramGB, type: 'nvidia' };
      }
    }
  } catch (e) {
    // nvidia-smi not available, try PowerShell
  }

  // Try PowerShell Get-CimInstance (works for all GPUs, no 4GB cap)
  try {
    const psOutput = execSync(
      'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json"',
      { encoding: 'utf8', timeout: 8000 }
    );
    const data = JSON.parse(psOutput);
    const gpus = Array.isArray(data) ? data : [data];

    let bestGPU = null;
    for (const gpu of gpus) {
      if (!gpu || !gpu.Name) continue;
      const name = gpu.Name;
      const adapterRAM = gpu.AdapterRAM || 0;
      const isIntegrated = name.toLowerCase().includes('intel') &&
        (name.toLowerCase().includes('uhd') || name.toLowerCase().includes('iris'));

      if (!bestGPU || (!isIntegrated && adapterRAM > (bestGPU.adapterRAM || 0))) {
        bestGPU = { name, adapterRAM, vramGB: Math.round((adapterRAM / (1024 ** 3)) * 10) / 10 };
      }
    }

    if (bestGPU && bestGPU.vramGB > 0) {
      const type = bestGPU.name.toLowerCase().includes('nvidia') ? 'nvidia' :
        bestGPU.name.toLowerCase().includes('amd') ? 'amd' :
        bestGPU.name.toLowerCase().includes('intel') ? 'intel' : 'unknown';
      return { name: bestGPU.name, vramGB: bestGPU.vramGB, type };
    }
  } catch (e) {
    // PowerShell failed, fall back to wmic
  }

  // Last resort: wmic (has 4GB cap on AdapterRAM for some GPUs)
  try {
    const output = execSync(
      'wmic path win32_VideoController get Name,AdapterRAM /format:csv',
      { encoding: 'utf8', timeout: 5000 }
    );

    const lines = output.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'));
    let bestGPU = null;
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length < 3) continue;
      const adapterRAM = parseInt(parts[1]) || 0;
      const name = parts[2]?.trim() || 'Unknown';
      const isIntegrated = name.toLowerCase().includes('intel') && name.toLowerCase().includes('uhd');
      if (!bestGPU || (!isIntegrated && adapterRAM > (bestGPU.adapterRAM || 0))) {
        bestGPU = { name, adapterRAM, vramGB: Math.round((adapterRAM / (1024 ** 3)) * 10) / 10 };
      }
    }

    if (bestGPU) {
      const type = bestGPU.name.toLowerCase().includes('nvidia') ? 'nvidia' :
        bestGPU.name.toLowerCase().includes('amd') ? 'amd' :
        bestGPU.name.toLowerCase().includes('intel') ? 'intel' : 'unknown';
      return { name: bestGPU.name, vramGB: bestGPU.vramGB, type };
    }
  } catch (e) {
    // All methods failed
  }

  return { name: 'Unknown', vramGB: 0, type: 'unknown' };
}

/**
 * Detect available disk space on the drive where Ollama stores models.
 * Default locations: macOS ~/.ollama, Windows %USERPROFILE%\.ollama
 */
function detectDiskSpace(platform) {
  try {
    if (platform === 'darwin' || platform === 'linux') {
      const homedir = os.homedir();
      const output = execSync(`df -g "${homedir}"`, { encoding: 'utf8', timeout: 3000 });
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        // df -g output: Filesystem Size Used Avail Capacity ...
        const availGB = parseInt(parts[3]) || 0;
        return availGB;
      }
    } else if (platform === 'win32') {
      const drive = os.homedir().charAt(0);
      const output = execSync(`wmic logicaldisk where "DeviceID='${drive}:'" get FreeSpace /format:csv`, {
        encoding: 'utf8',
        timeout: 3000,
      });
      const lines = output.trim().split('\n').filter(l => l.trim() && !l.startsWith('Node'));
      if (lines.length > 0) {
        const parts = lines[0].split(',');
        const freeBytes = parseInt(parts[1]) || 0;
        return Math.round((freeBytes / (1024 ** 3)) * 10) / 10;
      }
    }
  } catch (err) {
    console.warn('[HardwareScanner] Disk space detection failed:', err.message);
  }
  return 0;
}

module.exports = { scanHardware };
