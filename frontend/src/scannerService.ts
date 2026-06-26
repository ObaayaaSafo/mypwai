// Index: ScannerService.init():47 | shutdown():54 | probeConnection():60 | connect():69 | getDeviceInfo():74
//        capture():87 | verify():98 | enroll():106 | getEnrolledStudents():111 | deleteTemplate():116 | reloadTemplates():122
export type ScannerDeviceInfo = {
  deviceId: string;
  model: string;
  firmware: string;
  status: 'ready' | 'busy' | 'offline';
  lastCalibration: string;
  connectionType: 'hid' | 'usb' | 'serial';
};

export type FingerprintCapture = {
  template: string;
  quality: number;
  fingerLabel: string;
  captureTime: string;
};

// ── Backend API helpers ──

const API_BASE = `${window.location.protocol}//${window.location.hostname}:4007/api/fingerprint`;

const apiCall = async (path: string, options?: RequestInit) => {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
};

// ── Service ──

let initialized = false;
let connected = false;

export const ScannerService = {
  isBrowserSupported: () => true, // Browser just needs fetch — backend handles the hardware

  /** Initialize backend fingerprint subsystem */
  init: async (): Promise<void> => {
    if (initialized) return;
    const result = await apiCall('/init', { method: 'POST' });
    initialized = true;
    connected = result.deviceCount > 0;
  },

  /** Shutdown backend fingerprint subsystem */
  shutdown: async (): Promise<void> => {
    await apiCall('/shutdown', { method: 'POST' });
    initialized = false;
    connected = false;
  },

  probeConnection: async (): Promise<boolean> => {
    try {
      const status = await apiCall('/status');
      connected = status.ready && status.deviceOpen;
      return connected;
    } catch {
      connected = false;
      return false;
    }
  },

  connect: async (): Promise<boolean> => {
    await ScannerService.init();
    return ScannerService.probeConnection();
  },

  getDeviceInfo: async (): Promise<ScannerDeviceInfo> => {
    const status = await apiCall('/status');
    return {
      deviceId: 'zk-finger-scanner',
      model: 'ZKTeco Fingerprint Scanner',
      firmware: 'ZKFinger SDK 5.3',
      status: status.ready && status.deviceOpen ? 'ready' : 'offline',
      lastCalibration: 'Hardware-managed',
      connectionType: 'usb',
    };
  },

  /** Capture fingerprint and receive template as base64 */
  capture: async (): Promise<FingerprintCapture> => {
    const result = await apiCall('/capture', { method: 'POST' });
    return {
      template: result.templateBase64 || '',
      quality: 85,
      fingerLabel: 'Right thumb',
      captureTime: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  },

  /** Verify a fingerprint against enrolled templates */
  verify: async (): Promise<{
    matched: boolean;
    student?: { index: string; name: string; programme: string; level: string };
    score?: number;
    message?: string;
  }> => {
    return apiCall('/verify', { method: 'POST' });
  },

  /** Enroll a student's fingerprint */
  enroll: async (studentId: string): Promise<{ success: boolean; message: string }> => {
    return apiCall('/enroll', { method: 'POST', body: JSON.stringify({ studentId }) });
  },

  getEnrolledStudents: async (): Promise<Array<{ index_no: string; name: string }>> => {
    return apiCall('/enrolled');
  },

  deleteTemplate: async (studentId: string): Promise<void> => {
    await apiCall(`/template/${encodeURIComponent(studentId)}`, { method: 'DELETE' });
  },

  reloadTemplates: async (): Promise<number> => {
    const result = await apiCall('/reload', { method: 'POST' });
    return result.templateCount;
  },
};
