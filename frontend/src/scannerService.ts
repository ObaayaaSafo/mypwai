/**
 * scannerService.ts — Frontend service for the ZK9500 fingerprint scanner.
 *
 * Calls the real backend /api/fingerprint/* endpoints instead of browser
 * WebHID mocks.  The backend wraps the ZK SDK via koffi/FFI.
 *
 * Index: ScannerServiceImpl:probeConnection():29 | getDeviceInfo():41 | connect():54 | capture():66
 */

const FINGERPRINT_BASE = '/api/fingerprint';

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
      const res = await fetch(`${FINGERPRINT_BASE}/status`, {
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
    const res = await fetch(`${FINGERPRINT_BASE}/status`);
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
    const res = await fetch(`${FINGERPRINT_BASE}/init`, { method: 'POST' });
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

    const res = await fetch(`${FINGERPRINT_BASE}/capture`, { method: 'POST' });
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
