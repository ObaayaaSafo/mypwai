/**
 * scannerService.ts — Frontend service for the ZK9500 fingerprint scanner.
 *
 * Calls the real backend /api/fingerprint/* endpoints instead of browser
 * WebHID mocks.  The backend wraps the ZK SDK via koffi/FFI.
 *
 * Index: ScannerServiceImpl:probeConnection():39 | getDeviceInfo():57 | connect():72 | capture():86
 */

const FINGERPRINT_BASES = [
  'https://wifi-viscosity-overhear.ngrok-free.dev/api/fingerprint',
  '/api/fingerprint',
  `${window.location.protocol}//${window.location.hostname}:4007/api/fingerprint`,
  'http://127.0.0.1:4007/api/fingerprint',
  'http://localhost:4007/api/fingerprint',
  `${window.location.protocol}//${window.location.hostname}:4000/api/fingerprint`,
  'http://127.0.0.1:4000/api/fingerprint',
  'http://localhost:4000/api/fingerprint',
];

const HEADERS = {
  'Content-Type': 'application/json',
  'ngrok-skip-browser-warning': 'true',
};

const tryFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  let lastError: Error | null = null;
  for (const base of FINGERPRINT_BASES) {
    try {
      const res = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...HEADERS, ...(init?.headers as Record<string, string> || {}) },
      });
      return res;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Network request failed');
    }
  }
  throw lastError || new Error('Unable to reach fingerprint backend');
};

export interface ScannerDeviceInfo {
  name: string;
  model: string;
  status: string;
  templateCount: number;
}

export interface FingerprintCapture {
  template: string;
  quality: number;
}

class ScannerServiceImpl {
  private deviceOpen = false;

  /** Quick check — hits /status to see if the scanner is initialised. */
  async probeConnection(): Promise<boolean> {
    try {
      const res = await tryFetch('/status', {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.ready === true;
    } catch {
      return false;
    }
  }

  /** Return device metadata (mostly from /status). */
  async getDeviceInfo(): Promise<ScannerDeviceInfo> {
    const res = await tryFetch('/status');
    const data = await res.json();
    return {
      name: 'ZK9500 Fingerprint Scanner',
      model: 'ZK9500',
      status: data.ready ? 'ready' : data.message ?? 'unavailable',
      templateCount: data.templateCount ?? 0,
    };
  }

  /** Initialise the SDK, open the device, load templates. */
  async connect(): Promise<void> {
    const res = await tryFetch('/init', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error ?? 'Failed to initialise fingerprint scanner');
    }
    this.deviceOpen = true;
  }

  /**
   * Capture a fingerprint via the real backend (polls up to 15 s).
   * The user must be told to place their finger *before* calling this.
   */
  async capture(): Promise<FingerprintCapture> {
    if (!this.deviceOpen) {
      // Auto-connect so callers don't have to remember
      await this.connect();
    }

    const res = await tryFetch('/capture', { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.templateBase64) {
      throw new Error(data.error ?? 'Failed to capture fingerprint');
    }

    return {
      template: data.templateBase64,
      quality: 85, // SDK does not expose a per-capture quality score
    };
  }
}

/** Singleton — used by FingerprintEnrollmentPage and AttendancePage. */
export const ScannerService = new ScannerServiceImpl();
