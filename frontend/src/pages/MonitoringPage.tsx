// Index: MonitoringPage (1500 lines) — Key exports: startCamera:590 | stopCamera:608 | runFaceAnalysis:617
//        addAlert:536 | identifyEnrolledFaces:363 | captureEvidence:527 | captureFrameBase64:778
//        Hall grid UI:1285 | Malpractice event log UI:1412 | Risk scoring:170-230
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  analyzeMalpracticeFrame,
  deleteRekognitionFace,
  fetchFaceEnrolledStudents,
  fetchMonitoring,
  getRekognitionCollectionStatus,
  listRekognitionFaces,
  initializeRekognitionCollection,
  storeMalpracticeEvent,
} from '../apiExtra';

type Severity = 'low' | 'medium' | 'high';
type RiskTier = 'low' | 'medium' | 'high';

type MalpracticeEvent = {
  id: string;
  timestamp: string;
  cameraId: string;
  hallId: string;
  studentId: string;
  faceId?: string;
  eventType: 'multiple_faces' | 'candidate_interaction' | 'absence' | 'excessive_movement' | 'proxy_face_mismatch' | 'talking' | 'head_rotation' | 'unauthorized_material' | 'looking_around';
  suspicionScore: number;
  threshold: number;
  severity: Severity;
  detail: string;
  evidencePath?: string;
};

type RekognitionFace = {
  faceId: string;
  externalImageId: string;
  imageId: string;
  confidence: number | null;
  indexedAt: string | null;
  collectionId: string;
};

type FaceProfile = {
  studentId: string;
  name: string;
  photo: string;
  vector: number[];
};

const cameraId = 'hall_A_cam_02';
const hallId = 'main_hall';
const fallbackStudentId = 'unknown_student';
const malpracticeEventTypes: MalpracticeEvent['eventType'][] = [
  'multiple_faces',
  'candidate_interaction',
  'absence',
  'excessive_movement',
  'proxy_face_mismatch',
  'talking',
  'head_rotation',
  'unauthorized_material',
  'looking_around',
];

const externalCameraLabelPatterns = [
  /webcam/i,
  /usb/i,
  /logitech/i,
  /microsoft/i,
  /razer/i,
  /elgato/i,
];

const builtInCameraLabelPatterns = [
  /integrated/i,
  /internal/i,
  /built[- ]?in/i,
  /face\s*time/i,
  /facetime/i,
  /truevision/i,
  /iris/i,
];

const scoreVideoDevice = (device: MediaDeviceInfo) => {
  const label = device.label || '';
  if (builtInCameraLabelPatterns.some((pattern) => pattern.test(label))) return 0;
  let score = 1;
  if (externalCameraLabelPatterns.some((pattern) => pattern.test(label))) score += 10;
  if (/camera/i.test(label)) score += 2;
  if (device.deviceId && device.deviceId !== 'default') score += 1;
  return score;
};

const pickPreferredVideoDevice = (devices: MediaDeviceInfo[]) => {
  const videoInputs = devices.filter((device) => device.kind === 'videoinput');
  if (videoInputs.length === 0) return null;
  return videoInputs.slice().sort((left, right) => scoreVideoDevice(right) - scoreVideoDevice(left))[0];
};

const MonitoringPage: React.FC = () => {
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [faceApiSupported, setFaceApiSupported] = useState(true);
  const [faceCount, setFaceCount] = useState(0);
  const [absenceSeconds, setAbsenceSeconds] = useState(0);
  const [movementScore, setMovementScore] = useState(0);
  const [riskScore, setRiskScore] = useState(0);
  const [riskTier, setRiskTier] = useState<RiskTier>('low');
  const [alerts, setAlerts] = useState<MalpracticeEvent[]>([]);
  const [alertToneEnabled, setAlertToneEnabled] = useState(true);
  const [snapshotDataUrl, setSnapshotDataUrl] = useState<string | null>(null);
  const [useAwsRekognition, setUseAwsRekognition] = useState(true);
  const [awsConfigured, setAwsConfigured] = useState(true);
  const [awsStatus, setAwsStatus] = useState<'idle' | 'active' | 'error'>('idle');
  const [collectionStatus, setCollectionStatus] = useState<string>('checking');
  const [collectionFaceCount, setCollectionFaceCount] = useState<number>(0);
  const [identifiedStudentId, setIdentifiedStudentId] = useState<string>('Unknown');
  const [identifiedStudentIds, setIdentifiedStudentIds] = useState<string[]>([]);
  const [flaggedStudentId, setFlaggedStudentId] = useState<string | null>(null);
  const [initializingCollection, setInitializingCollection] = useState(false);
  const [enrolledFaces, setEnrolledFaces] = useState<RekognitionFace[]>([]);
  const [localFaceProfiles, setLocalFaceProfiles] = useState<FaceProfile[]>([]);
  const [loadingFaces, setLoadingFaces] = useState(false);
  const [hallViewMode, setHallViewMode] = useState<'single' | 'grid'>('grid');
  const activeSessionId = localStorage.getItem('activeSessionId');
  const activeSessionLabel = localStorage.getItem('activeSessionLabel') || '';

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef2 = useRef<HTMLCanvasElement | null>(null);
  const canvasRef3 = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const analysisBusyRef = useRef(false);
  const lastFaceSeenRef = useRef<number>(Date.now());
  const previousFaceCenterRef = useRef<{ x: number; y: number } | null>(null);
  const previousPoseRef = useRef<{ yaw: number; pitch: number; roll: number } | null>(null);
  const poseMovementWindowRef = useRef<number[]>([]);
  const movementWindowRef = useRef<number[]>([]);
  const eventCooldownRef = useRef<Record<string, number>>({});
  const headRotationWindowRef = useRef<number[]>([]);
  const mouthOpenWindowRef = useRef<boolean[]>([]);
  const largeMovementEventsRef = useRef<number[]>([]);
  const headTurnEventsRef = useRef<number[]>([]);
  const lastHorizontalDirectionRef = useRef<-1 | 0 | 1>(0);
  const previousFaceCenterMapRef = useRef<Record<string, { x: number; y: number }>>({});
  const movementWindowByFaceRef = useRef<Record<string, number[]>>({});
  const largeMovementEventsByFaceRef = useRef<Record<string, number[]>>({});
  const movementConsecutiveByFaceRef = useRef<Record<string, number>>({});
  const headTurnEventsByFaceRef = useRef<Record<string, number[]>>({});
  const lastHorizontalDirectionByFaceRef = useRef<Record<string, -1 | 0 | 1>>({});
  const mouthOpenWindowByFaceRef = useRef<Record<string, boolean[]>>({});
  const latestRecognizedStudentIdRef = useRef<string | null>(null);
  const localFaceProfilesRef = useRef<FaceProfile[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastAwsRunRef = useRef<number>(0);
  const riskScoreRef = useRef<number>(0);
  const lastRiskUpdateRef = useRef<number>(Date.now());
  const perFaceRiskScoreRef = useRef<Record<string, number>>({});
  const perFaceRiskUpdatedAtRef = useRef<Record<string, number>>({});
  const alertConfirmationRef = useRef<Record<string, { hits: number; lastSeen: number }>>({});

  const absenceThresholdSeconds = 30;
  const movementThresholdRatio = 0.30;       // displacement must be >30% of face width
  const movementMinAbsoluteThreshold = 60;    // minimum px for very small faces
  const movementConsecutiveRequired = 3;      // consecutive frames required (not bursts)

  const startPreferredCamera = async () => {
    // For exam hall: prefer wide external camera (environment), high resolution, uncropped
    const initialStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        facingMode: { ideal: 'environment' },
      },
      audio: false,
    });

    const preferredDevice = pickPreferredVideoDevice(await navigator.mediaDevices.enumerateDevices());
    const currentDeviceId = initialStream.getVideoTracks()[0]?.getSettings().deviceId;

    if (preferredDevice?.deviceId && preferredDevice.deviceId !== currentDeviceId) {
      initialStream.getTracks().forEach((track) => track.stop());
      return navigator.mediaDevices.getUserMedia({
        video: {
          deviceId: { exact: preferredDevice.deviceId },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
    }

    return initialStream;
  };
  const detectionIntervalMs = 500;
  const headRotationThresholdRatio = 0.20;   // horizontal shift >20% of face width = head turn
  const headTurnMinAbsoluteThreshold = 40;    // minimum px for very small faces
  const movementEventWindowMs = 6000;
  const headTurnEventsRequired = 4;
  const talkingDetectionThreshold = 0.6;
  const alertDecayPerSecond = 1.4;
  const confirmationWindowMs = 2400;

  const requiredHitsByEvent: Record<MalpracticeEvent['eventType'], number> = {
    multiple_faces: 2,
    candidate_interaction: 2,
    absence: 3,
    excessive_movement: 2,
    proxy_face_mismatch: 2,
    talking: 3,
    head_rotation: 2,
    unauthorized_material: 2,
    looking_around: 2,
  };

  const minimumSuspicionByEvent: Record<MalpracticeEvent['eventType'], number> = {
    multiple_faces: 0.9,
    candidate_interaction: 0.9,
    absence: 1,
    excessive_movement: 1,
    proxy_face_mismatch: 0.9,
    talking: 0.65,
    head_rotation: 0.9,
    unauthorized_material: 0.9,
    looking_around: 0.8,
  };

  const riskDeltaBySeverity: Record<Severity, number> = {
    low: 6,
    medium: 12,
    high: 20,
  };

  const getRiskTier = (score: number): RiskTier => {
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    return 'low';
  };

  const getRiskTierColor = (tier: RiskTier) => {
    if (tier === 'high') return '#EF4444';
    if (tier === 'medium') return '#F59E0B';
    return '#10B981';
  };

  const applyRiskDecayAndDelta = (delta = 0) => {
    const now = Date.now();
    const elapsedSeconds = Math.max(0, (now - lastRiskUpdateRef.current) / 1000);
    const decayed = Math.max(0, riskScoreRef.current - elapsedSeconds * alertDecayPerSecond);
    const next = Math.max(0, Math.min(100, decayed + delta));
    riskScoreRef.current = next;
    lastRiskUpdateRef.current = now;
    setRiskScore(Number(next.toFixed(1)));
    setRiskTier(getRiskTier(next));
  };

  const applyPerFaceRiskDecayAndDelta = (faceKey: string, delta = 0) => {
    const now = Date.now();
    const previousScore = perFaceRiskScoreRef.current[faceKey] || 0;
    const previousUpdatedAt = perFaceRiskUpdatedAtRef.current[faceKey] || now;
    const elapsedSeconds = Math.max(0, (now - previousUpdatedAt) / 1000);
    const decayed = Math.max(0, previousScore - elapsedSeconds * alertDecayPerSecond);
    const next = Math.max(0, Math.min(100, decayed + delta));
    perFaceRiskScoreRef.current[faceKey] = next;
    perFaceRiskUpdatedAtRef.current[faceKey] = now;
    return next;
  };

  useEffect(() => {
    const loadData = async () => {
      const monitoring = await fetchMonitoring();
      setData(monitoring);
    };

    loadData();
    const interval = setInterval(loadData, 3000); // Refresh every 3 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const FaceDetectorCtor = (window as any).FaceDetector;
    if (!FaceDetectorCtor) {
      setFaceApiSupported(false);
      setCameraError('Browser Face Detection API is not available. Use a Chromium-based browser for live detection.');
      return;
    }

    detectorRef.current = new FaceDetectorCtor({ maxDetectedFaces: 6, fastMode: true });
  }, []);

  useEffect(() => {
    if (!cameraActive) return;

    const tick = setInterval(() => {
      void runFaceAnalysis();
    }, detectionIntervalMs);

    return () => clearInterval(tick);
  }, [cameraActive]);

  useEffect(() => {
    if (!cameraActive) return;
    const decayTick = setInterval(() => {
      applyRiskDecayAndDelta(0);
    }, 1000);
    return () => clearInterval(decayTick);
  }, [cameraActive]);

  useEffect(() => {
    return () => {
      stopCamera();
      audioContextRef.current?.close().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    localFaceProfilesRef.current = localFaceProfiles;
  }, [localFaceProfiles]);

  useEffect(() => {
    void refreshCollectionStatus();
    void refreshEnrolledFaces();
    void refreshLocalFaceProfiles();
  }, []);

  const loadVectorFromImage = async (src: string) => {
    if (!src) return null;

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Unable to load face image.'));
      element.src = src;
    });

    const canvas = document.createElement('canvas');
    const size = 24;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const cropSize = Math.min(image.width, image.height);
    const offsetX = Math.max(0, Math.floor((image.width - cropSize) / 2));
    const offsetY = Math.max(0, Math.floor((image.height - cropSize) / 2));
    context.drawImage(image, offsetX, offsetY, cropSize, cropSize, 0, 0, size, size);

    const { data } = context.getImageData(0, 0, size, size);
    const rawValues: number[] = [];
    for (let index = 0; index < data.length; index += 4) {
      rawValues.push((data[index] + data[index + 1] + data[index + 2]) / 3);
    }

    const mean = rawValues.reduce((sum, value) => sum + value, 0) / Math.max(rawValues.length, 1);
    const centered = rawValues.map((value) => value - mean);
    const magnitude = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0));
    const normalized = magnitude > 0 ? centered.map((value) => value / magnitude) : centered;
    return normalized;
  };

  const captureVideoVector = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement('canvas');
    const size = 24;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const cropSize = Math.min(video.videoWidth, video.videoHeight);
    const offsetX = Math.max(0, Math.floor((video.videoWidth - cropSize) / 2));
    const offsetY = Math.max(0, Math.floor((video.videoHeight - cropSize) / 2));
    context.drawImage(video, offsetX, offsetY, cropSize, cropSize, 0, 0, size, size);

    const { data } = context.getImageData(0, 0, size, size);
    const rawValues: number[] = [];
    for (let index = 0; index < data.length; index += 4) {
      rawValues.push((data[index] + data[index + 1] + data[index + 2]) / 3);
    }

    const mean = rawValues.reduce((sum, value) => sum + value, 0) / Math.max(rawValues.length, 1);
    const centered = rawValues.map((value) => value - mean);
    const magnitude = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0));
    return magnitude > 0 ? centered.map((value) => value / magnitude) : centered;
  };

  const scoreFaceVector = (left: number[], right: number[]) => {
    const length = Math.min(left.length, right.length);
    if (length === 0) return -1;

    let score = 0;
    for (let index = 0; index < length; index += 1) {
      score += left[index] * right[index];
    }
    return score;
  };

  const captureFaceVector = (box: { x: number; y: number; width: number; height: number }) => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement('canvas');
    const size = 24;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;
    const looksNormalized = box.x <= 1 && box.y <= 1 && box.width <= 1 && box.height <= 1;
    const rawX = looksNormalized ? box.x * sourceWidth : box.x;
    const rawY = looksNormalized ? box.y * sourceHeight : box.y;
    const rawW = looksNormalized ? box.width * sourceWidth : box.width;
    const rawH = looksNormalized ? box.height * sourceHeight : box.height;

    const cropX = Math.max(0, Math.min(sourceWidth - 1, Math.floor(rawX)));
    const cropY = Math.max(0, Math.min(sourceHeight - 1, Math.floor(rawY)));
    const cropWidth = Math.max(1, Math.min(sourceWidth - cropX, Math.floor(rawW)));
    const cropHeight = Math.max(1, Math.min(sourceHeight - cropY, Math.floor(rawH)));

    context.drawImage(video, cropX, cropY, cropWidth, cropHeight, 0, 0, size, size);

    const { data } = context.getImageData(0, 0, size, size);
    const rawValues: number[] = [];
    for (let index = 0; index < data.length; index += 4) {
      rawValues.push((data[index] + data[index + 1] + data[index + 2]) / 3);
    }

    const mean = rawValues.reduce((sum, value) => sum + value, 0) / Math.max(rawValues.length, 1);
    const centered = rawValues.map((value) => value - mean);
    const magnitude = Math.sqrt(centered.reduce((sum, value) => sum + value * value, 0));
    return magnitude > 0 ? centered.map((value) => value / magnitude) : centered;
  };

  const identifyEnrolledFaces = async (faces: any[]) => {
    const profiles = localFaceProfilesRef.current;
    if (!faces.length) {
      setIdentifiedStudentIds([]);
      return [] as Array<{ face: any; matchedStudentId: string | null; key: string; score: number }>;
    }

    const observations: Array<{ face: any; matchedStudentId: string | null; key: string; score: number }> = [];
    const matches: string[] = [];

    for (let index = 0; index < faces.length; index += 1) {
      const face = faces[index];
      const box = face?.boundingBox;
      if (!box) continue;

      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const unknownKey = `unknown-${Math.round(center.x / 40)}-${Math.round(center.y / 40)}-${index}`;

      if (!profiles.length) {
        observations.push({
          face,
          matchedStudentId: null,
          key: unknownKey,
          score: -1,
        });
        continue;
      }

      const faceVector = captureFaceVector(box);
      if (!faceVector) {
        observations.push({
          face,
          matchedStudentId: null,
          key: unknownKey,
          score: -1,
        });
        continue;
      }

      let bestProfile: FaceProfile | null = null;
      let bestScore = -1;
      let runnerUpScore = -1;

      for (const profile of profiles) {
        const score = scoreFaceVector(faceVector, profile.vector);
        if (score > bestScore) {
          runnerUpScore = bestScore;
          bestScore = score;
          bestProfile = profile;
        } else if (score > runnerUpScore) {
          runnerUpScore = score;
        }
      }

      const matchedStudentId = bestProfile && bestScore >= 0.72 && bestScore - runnerUpScore >= 0.04
        ? bestProfile.studentId
        : null;

      if (matchedStudentId) {
        matches.push(matchedStudentId);
      }

      const key = matchedStudentId || unknownKey;
      observations.push({
        face,
        matchedStudentId,
        key,
        score: bestScore,
      });
    }

    const uniqueMatches = Array.from(new Set(matches));
    setIdentifiedStudentIds(uniqueMatches);
    if (uniqueMatches.length === 1) {
      setIdentifiedStudentId(uniqueMatches[0]);
    } else if (uniqueMatches.length > 1) {
      setIdentifiedStudentId('Multiple enrolled students');
    } else {
      setIdentifiedStudentId('Unknown');
    }

    return observations;
  };

  const refreshLocalFaceProfiles = async () => {
    try {
      const students = await fetchFaceEnrolledStudents();
      const studentsWithPhotos = students.filter((student: any) => typeof student?.photo === 'string' && student.photo.length > 0);
      
      const profiles = await Promise.all(
        studentsWithPhotos.map(async (student: any) => {
          try {
            const vector = await loadVectorFromImage(student.photo);
            if (!vector) {
              return null;
            }

            return {
              studentId: String(student.index || student.studentId || 'Unknown'),
              name: String(student.name || student.index || 'Unknown'),
              photo: student.photo,
              vector,
            };
          } catch (err) {
            return null;
          }
        })
      );

      const finalProfiles = profiles.filter((profile): profile is FaceProfile => Boolean(profile));
      setLocalFaceProfiles(finalProfiles);
    } catch (err) {
      setLocalFaceProfiles([]);
    }
  };

  const runLocalFaceRecognition = async () => {
    const frameVector = captureVideoVector();
    const profiles = localFaceProfilesRef.current;
    if (!frameVector || profiles.length === 0) return null;

    let bestProfile: FaceProfile | null = null;
    let bestScore = -1;
    let runnerUpScore = -1;

    for (const profile of profiles) {
      const score = scoreFaceVector(frameVector, profile.vector);
      if (score > bestScore) {
        runnerUpScore = bestScore;
        bestScore = score;
        bestProfile = profile;
      } else if (score > runnerUpScore) {
        runnerUpScore = score;
      }
    }

    if (bestProfile && bestScore >= 0.72 && bestScore - runnerUpScore >= 0.04) {
      setIdentifiedStudentId(bestProfile.studentId);
      latestRecognizedStudentIdRef.current = bestProfile.studentId;
      return bestProfile.studentId;
    }

    setIdentifiedStudentId('Unknown');
    return null;
  };

  const refreshCollectionStatus = async () => {
    try {
      const status = await getRekognitionCollectionStatus();
      if (!status.configured) {
        setAwsConfigured(false);
        setUseAwsRekognition(false);
        setCollectionStatus('local fallback');
        setAwsStatus('idle');
        setCollectionFaceCount(0);
        setCameraError(status?.message || 'AWS Rekognition is unavailable. Check backend AWS credentials and region configuration.');
        return;
      }

      setAwsConfigured(true);

      if (status?.error) {
        setAwsStatus('error');
        setCameraError(String(status.error));
      }

      if (status.exists) {
        setCollectionStatus('ready');
        setCollectionFaceCount(status.faceCount || 0);
      } else {
        setCollectionStatus('not initialized');
        setCollectionFaceCount(0);
      }
    } catch {
      setAwsConfigured(false);
      setUseAwsRekognition(false);
      setCollectionStatus('local fallback');
      setAwsStatus('idle');
    }
  };

  const handleInitializeCollection = async () => {
    setInitializingCollection(true);
    try {
      await initializeRekognitionCollection();
      await refreshCollectionStatus();
    } catch (error) {
      setCollectionStatus('init failed');
      setCameraError(error instanceof Error ? error.message : 'Collection initialization failed.');
    } finally {
      setInitializingCollection(false);
    }
  };

  const refreshEnrolledFaces = async () => {
    setLoadingFaces(true);
    try {
      const response = await listRekognitionFaces();
      setEnrolledFaces(Array.isArray(response.faces) ? response.faces : []);
      if (typeof response.faceCount === 'number') {
        setCollectionFaceCount(response.faceCount);
      }
      setCollectionStatus((current) => (current === 'checking' ? 'ready' : current));
    } catch (error) {
      const fallbackStudents = await fetchFaceEnrolledStudents();
      const localFaces: RekognitionFace[] = fallbackStudents.map((student: any) => ({
        faceId: `local-${student.index}`,
        externalImageId: student.index,
        imageId: '',
        confidence: null,
        indexedAt: null,
        collectionId: 'local-students',
      }));

      setEnrolledFaces(localFaces);
      setCollectionFaceCount(localFaces.length);
      setCollectionStatus((current) => (current === 'checking' ? 'local fallback' : current));

      if (localFaces.length > 0) {
        setCameraError('AWS face listing is unavailable. Showing locally enrolled student faces instead.');
      } else {
        setCameraError(error instanceof Error ? error.message : 'Failed to load enrolled faces.');
      }
    } finally {
      setLoadingFaces(false);
    }

    void refreshLocalFaceProfiles();
  };

  const handleDeleteFace = async (faceId: string) => {
    if (faceId.startsWith('local-')) {
      setCameraError('Local fallback entries cannot be deleted from Monitoring. Delete or update the student profile instead.');
      return;
    }

    try {
      await deleteRekognitionFace(faceId);
      await refreshCollectionStatus();
      await refreshEnrolledFaces();
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Failed to delete face.');
    }
  };

  const playAlertTone = () => {
    if (!alertToneEnabled) return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioCtx();
    }

    const ctx = audioContextRef.current;
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gainNode.gain.value = 0.06;

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.2);
  };

  const captureEvidence = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return undefined;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) return undefined;

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    setSnapshotDataUrl(dataUrl);
    return `inline://snapshot/${Date.now()}.jpg`;
  };

  const addAlert = (
    eventType: MalpracticeEvent['eventType'],
    detail: string,
    severity: Severity,
    suspicionScore: number,
    threshold: number,
    withEvidence = false,
    alertStudentId?: string,
    alertFaceId?: string
  ) => {
    const now = Date.now();
    const alertScopeKey = `${eventType}:${alertStudentId || 'unknown'}:${alertFaceId || 'global'}`;

    const minimumSuspicion = minimumSuspicionByEvent[eventType];
    if (Number.isFinite(minimumSuspicion) && suspicionScore < minimumSuspicion) return;

    const requiredHits = requiredHitsByEvent[eventType] || 1;
    const confirmation = alertConfirmationRef.current[alertScopeKey] || { hits: 0, lastSeen: 0 };
    if (now - confirmation.lastSeen > confirmationWindowMs) {
      confirmation.hits = 0;
    }
    confirmation.hits += 1;
    confirmation.lastSeen = now;
    alertConfirmationRef.current[alertScopeKey] = confirmation;

    if (confirmation.hits < requiredHits) return;
    confirmation.hits = 0;

    const cooldownMs = 10000;
    const lastRaised = eventCooldownRef.current[alertScopeKey] || 0;

    if (now - lastRaised < cooldownMs) return;
    eventCooldownRef.current[alertScopeKey] = now;

    const evidencePath = withEvidence ? captureEvidence() : undefined;
    const entry: MalpracticeEvent = {
      id: `${eventType}-${now}`,
      timestamp: new Date(now).toISOString(),
      cameraId,
      hallId,
      studentId: alertStudentId || (identifiedStudentId !== 'Unknown' ? identifiedStudentId : latestRecognizedStudentIdRef.current || fallbackStudentId),
      faceId: alertFaceId,
      eventType,
      suspicionScore,
      threshold,
      severity,
      detail,
      evidencePath,
    };

    if (alertStudentId) {
      setFlaggedStudentId(alertStudentId);
    }

    setAlerts((current) => [entry, ...current].slice(0, 50));
    applyRiskDecayAndDelta(riskDeltaBySeverity[severity]);
    if (alertFaceId) {
      applyPerFaceRiskDecayAndDelta(alertFaceId, riskDeltaBySeverity[severity]);
    }
    playAlertTone();
    if (malpracticeEventTypes.includes(eventType)) {
      void storeMalpracticeEvent({
        studentId: entry.studentId,
        eventType,
        severity,
        suspicionScore,
        detail,
        sessionId: activeSessionId || undefined,
      });
    }
  };

  const startCamera = async () => {
    setCameraError('');
    try {
      const stream = await startPreferredCamera();

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      lastFaceSeenRef.current = Date.now();
      previousFaceCenterRef.current = null;
      movementWindowRef.current = [];
      headRotationWindowRef.current = [];
      mouthOpenWindowRef.current = [];
      largeMovementEventsRef.current = [];
      headTurnEventsRef.current = [];
      lastHorizontalDirectionRef.current = 0;
      previousFaceCenterMapRef.current = {};
      movementWindowByFaceRef.current = {};
      largeMovementEventsByFaceRef.current = {};
      movementConsecutiveByFaceRef.current = {};
      headTurnEventsByFaceRef.current = {};
      lastHorizontalDirectionByFaceRef.current = {};
      mouthOpenWindowByFaceRef.current = {};
      perFaceRiskScoreRef.current = {};
      perFaceRiskUpdatedAtRef.current = {};
      latestRecognizedStudentIdRef.current = null;
      setIdentifiedStudentIds([]);
      setFlaggedStudentId(null);
      setFaceCount(0);
      setAbsenceSeconds(0);
      setMovementScore(0);
      setIdentifiedStudentId('Unknown');
      setCameraActive(true);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Unable to access camera.');
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    setCameraActive(false);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const runFaceAnalysis = async () => {
    if (analysisBusyRef.current) return;
    if (!cameraActive) return;

    const video = videoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    analysisBusyRef.current = true;
    try {
      const now = Date.now();
      if (detectorRef.current) {
        const faces: any[] = await detectorRef.current.detect(video);
        const count = faces.length;
        setFaceCount(count);
        const faceObservations = await identifyEnrolledFaces(faces);
        const enrolledMatches = faceObservations
          .map((entry) => entry.matchedStudentId)
          .filter((studentId): studentId is string => Boolean(studentId));

        if (count > 0) {
          lastFaceSeenRef.current = now;
          setAbsenceSeconds(0);
        } else {
          const elapsed = Math.floor((now - lastFaceSeenRef.current) / 1000);
          setAbsenceSeconds(elapsed);
          if (elapsed > absenceThresholdSeconds) {
            addAlert(
              'absence',
              `No face detected for ${elapsed} seconds (threshold ${absenceThresholdSeconds}s).`,
              'high',
              Number((elapsed / absenceThresholdSeconds).toFixed(2)),
              1,
              true
            );
          }
        }
        if (count > 1) {
          const hasUnknownFaces = faceObservations.some((entry) => !entry.matchedStudentId);
          const recognizedStudent = enrolledMatches[0] || (identifiedStudentId !== 'Unknown' ? identifiedStudentId : latestRecognizedStudentIdRef.current);

          if (hasUnknownFaces) {
            addAlert(
              'multiple_faces',
              `Detected ${count} faces with at least one unrecognized face in the frame.`,
              'high',
              Number((count / 2).toFixed(2)),
              1,
              true
            );

            if (recognizedStudent) {
              addAlert(
                'candidate_interaction',
                `Possible talking or collusion detected near enrolled student ${recognizedStudent}.`,
                'medium',
                Number((count / 2).toFixed(2)),
                1,
                true
              );
            }
          }
        }

        // Draw detected faces on canvas overlay
        if (canvasRef.current && video) {
          const rect = video.getBoundingClientRect();
          canvasRef.current.width = video.videoWidth || rect.width;
          canvasRef.current.height = video.videoHeight || rect.height;
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            faceObservations.forEach((entry) => {
              const box = entry.face?.boundingBox;
              if (box) {
                const faceRisk = applyPerFaceRiskDecayAndDelta(entry.key, 0);
                const faceTier = getRiskTier(faceRisk);
                const badgeColor = getRiskTierColor(faceTier);

                ctx.strokeStyle = badgeColor;
                ctx.lineWidth = 3;
                ctx.strokeRect(box.x, box.y, box.width, box.height);

                const badgeText = `${entry.matchedStudentId || 'Unknown'} | ${faceTier.toUpperCase()} ${Math.round(faceRisk)}`;
                ctx.font = 'bold 12px Arial';
                const textWidth = ctx.measureText(badgeText).width;
                const labelX = Math.max(2, box.x);
                const labelY = Math.max(16, box.y - 6);

                ctx.fillStyle = 'rgba(2, 6, 23, 0.78)';
                ctx.fillRect(labelX - 4, labelY - 12, textWidth + 10, 16);
                ctx.fillStyle = badgeColor;
                ctx.fillText(badgeText, labelX, labelY);
              }
            });
          }
        }

        let highestMovementScore = 0;
        for (const entry of faceObservations) {
          const box = entry.face?.boundingBox;
          if (!box) continue;

          const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          const faceKey = entry.key;
          const alertStudentId = entry.matchedStudentId || fallbackStudentId;
          const previousCenter = previousFaceCenterMapRef.current[faceKey] || null;

          if (previousCenter) {
            const dx = center.x - previousCenter.x;
            const dy = center.y - previousCenter.y;
            const displacement = Math.sqrt(dx * dx + dy * dy);

            // Dynamic threshold: relative to face width (minimises jitter from small detection noise)
            const faceWidth = box.width;
            const moveThreshold = Math.max(movementMinAbsoluteThreshold, faceWidth * movementThresholdRatio);

            // Smoothed displacement over a short window to dampen single-frame jitter
            const movementWindow = movementWindowByFaceRef.current[faceKey] || [];
            movementWindow.push(displacement);
            if (movementWindow.length > 6) movementWindow.shift();
            movementWindowByFaceRef.current[faceKey] = movementWindow;

            const smoothedDisplacement = movementWindow.reduce((sum, val) => sum + val, 0) / movementWindow.length;
            highestMovementScore = Math.max(highestMovementScore, smoothedDisplacement);

            // Consecutive-frame requirement: micro jitter rarely persists across consecutive frames
            const consecutiveCount = movementConsecutiveByFaceRef.current[faceKey] || 0;
            if (smoothedDisplacement >= moveThreshold) {
              const nextCount = consecutiveCount + 1;
              movementConsecutiveByFaceRef.current[faceKey] = nextCount;
              if (nextCount >= movementConsecutiveRequired) {
                addAlert(
                  'excessive_movement',
                  `Sustained movement detected for ${entry.matchedStudentId || faceKey}: ${nextCount} consecutive frames above ${moveThreshold.toFixed(0)}px (${(movementThresholdRatio * 100).toFixed(0)}% of face width).`,
                  'medium',
                  Number((nextCount / movementConsecutiveRequired).toFixed(2)),
                  1,
                  true,
                  alertStudentId,
                  faceKey
                );
                movementConsecutiveByFaceRef.current[faceKey] = 0;
              }
            } else {
              // Micro-movement or stationary — reset consecutive counter
              movementConsecutiveByFaceRef.current[faceKey] = 0;
            }

            // Head rotation: relative threshold based on face width (head turns shift face centre significantly)
            const headTurnThreshold = Math.max(headTurnMinAbsoluteThreshold, faceWidth * headRotationThresholdRatio);
            const absDx = Math.abs(dx);
            if (absDx >= headTurnThreshold) {
              const currentDirection: -1 | 1 = dx < 0 ? -1 : 1;
              const previousDirection = lastHorizontalDirectionByFaceRef.current[faceKey] || 0;
              if (previousDirection !== 0 && currentDirection !== previousDirection) {
                const turnEvents = headTurnEventsByFaceRef.current[faceKey] || [];
                turnEvents.push(now);
                headTurnEventsByFaceRef.current[faceKey] = turnEvents;
              }
              lastHorizontalDirectionByFaceRef.current[faceKey] = currentDirection;
            }

            const filteredTurnEvents = (headTurnEventsByFaceRef.current[faceKey] || []).filter((timestamp) => now - timestamp <= movementEventWindowMs);
            headTurnEventsByFaceRef.current[faceKey] = filteredTurnEvents;
            if (filteredTurnEvents.length >= headTurnEventsRequired) {
              addAlert(
                'head_rotation',
                `Repeated head turning detected for ${entry.matchedStudentId || faceKey}: ${filteredTurnEvents.length} left-right changes in ${(movementEventWindowMs / 1000).toFixed(0)}s.`,
                'medium',
                Number((filteredTurnEvents.length / headTurnEventsRequired).toFixed(2)),
                1,
                true,
                alertStudentId,
                faceKey
              );
              headTurnEventsByFaceRef.current[faceKey] = [];
            }
          }

          const landmarks = entry.face?.landmarks;
          if (Array.isArray(landmarks)) {
            let mouthDetected = false;
            if (landmarks.length > 48) {
              const mouthPoints = landmarks.slice(48, Math.min(68, landmarks.length));
              if (mouthPoints.length > 0) {
                const mouthHeights = mouthPoints.map((point: any) => point?.y || 0);
                const mouthSpread = Math.max(...mouthHeights) - Math.min(...mouthHeights);
                const expectedMouthHeight = box.height * 0.15;
                if (mouthSpread > expectedMouthHeight * 1.5) {
                  mouthDetected = true;
                }
              }
            }

            const mouthWindow = mouthOpenWindowByFaceRef.current[faceKey] || [];
            mouthWindow.push(mouthDetected);
            if (mouthWindow.length > 8) mouthWindow.shift();
            mouthOpenWindowByFaceRef.current[faceKey] = mouthWindow;

            const talkingRatio = mouthWindow.filter(Boolean).length / Math.max(mouthWindow.length, 1);
            if (talkingRatio > talkingDetectionThreshold) {
              addAlert(
                'talking',
                `Talking pattern detected for ${entry.matchedStudentId || faceKey}: mouth movement in ${(talkingRatio * 100).toFixed(0)}% of recent frames.`,
                'high',
                Number(talkingRatio.toFixed(2)),
                1,
                true,
                alertStudentId,
                faceKey
              );
              mouthOpenWindowByFaceRef.current[faceKey] = [];
            }
          }

          previousFaceCenterMapRef.current[faceKey] = center;
        }

        setMovementScore(Number(highestMovementScore.toFixed(1)));
      }

      if (!useAwsRekognition) {
        await runLocalFaceRecognition();
      }

      if (useAwsRekognition && now - lastAwsRunRef.current >= 2000) {
        const frameData = captureFrameBase64();
        if (frameData) {
          lastAwsRunRef.current = now;
          try {
            const aws = await analyzeMalpracticeFrame({
              imageBase64: frameData,
              cameraId,
              hallId,
              studentId: fallbackStudentId,
            });

            setAwsStatus('active');

            if (typeof aws.faceCount === 'number') {
              setFaceCount(aws.faceCount);
            }

            if (canvasRef.current && video && Array.isArray((aws as any).faceBoxes)) {
              const rect = video.getBoundingClientRect();
              canvasRef.current.width = video.videoWidth || rect.width;
              canvasRef.current.height = video.videoHeight || rect.height;
              const ctx = canvasRef.current.getContext('2d');
              if (ctx) {
                ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
                const boxes = (aws as any).faceBoxes as Array<{ left: number; top: number; width: number; height: number }>;
                boxes.forEach((box, index) => {
                  const x = (box.left || 0) * canvasRef.current!.width;
                  const y = (box.top || 0) * canvasRef.current!.height;
                  const w = (box.width || 0) * canvasRef.current!.width;
                  const h = (box.height || 0) * canvasRef.current!.height;

                  ctx.strokeStyle = '#10B981';
                  ctx.lineWidth = 3;
                  ctx.strokeRect(x, y, w, h);
                  ctx.fillStyle = '#10B981';
                  ctx.font = 'bold 12px Arial';
                  ctx.fillText(`Face ${index + 1}`, x, Math.max(12, y - 6));
                });
              }
            }

            if (aws.matchedStudentId) {
              setIdentifiedStudentId(aws.matchedStudentId);
              setIdentifiedStudentIds((current) => Array.from(new Set([...current, aws.matchedStudentId as string])));
              latestRecognizedStudentIdRef.current = aws.matchedStudentId;
            } else {
              setIdentifiedStudentId('Unknown');
            }

            if (aws.absence) {
              const elapsed = Math.floor((now - lastFaceSeenRef.current) / 1000);
              setAbsenceSeconds(elapsed);
            } else {
              lastFaceSeenRef.current = now;
              setAbsenceSeconds(0);
            }

            if (aws.pose && typeof aws.pose.yaw === 'number' && typeof aws.pose.pitch === 'number' && typeof aws.pose.roll === 'number') {
              const currentPose = { yaw: aws.pose.yaw, pitch: aws.pose.pitch, roll: aws.pose.roll };
              const previousPose = previousPoseRef.current;
              if (previousPose) {
                const poseDelta =
                  Math.abs(currentPose.yaw - previousPose.yaw) +
                  Math.abs(currentPose.pitch - previousPose.pitch) +
                  Math.abs(currentPose.roll - previousPose.roll);
                poseMovementWindowRef.current.push(poseDelta);
                if (poseMovementWindowRef.current.length > 10) {
                  poseMovementWindowRef.current.shift();
                }
                const poseScore = poseMovementWindowRef.current.reduce((sum, value) => sum + value, 0);
                const normalizedScore = Number((poseScore * 2.5).toFixed(1));
                setMovementScore(normalizedScore);
                const poseMovementThreshold = 25;
                if (normalizedScore > poseMovementThreshold) {
                  addAlert(
                    'excessive_movement',
                        `Flagged for sudden movement: head pose movement score ${normalizedScore} exceeded threshold ${poseMovementThreshold}.`,
                    'medium',
                    Number((normalizedScore / poseMovementThreshold).toFixed(2)),
                    1,
                    true,
                    aws.matchedStudentId || undefined,
                    aws.matchedFaceId || undefined
                  );
                }
              }
              previousPoseRef.current = currentPose;
            }

            if (aws.absence) {
              addAlert(
                'absence',
                'AWS Rekognition detected no visible face in the frame.',
                'high',
                1,
                1,
                true,
                aws.matchedStudentId || undefined,
                aws.matchedFaceId || undefined
              );
            }

            if (aws.multipleFaces) {
              if (!aws.matchedStudentId) {
                addAlert(
                  'multiple_faces',
                  `Flagged for candidate interaction: AWS Rekognition detected ${aws.faceCount} unrecognized faces in the same frame.`,
                  'high',
                  Number((aws.faceCount / 2).toFixed(2)),
                  1,
                  true
                );
              }

              if (aws.matchedStudentId) {
                addAlert(
                  'candidate_interaction',
                  `Flagged for candidate interaction: possible talking or collusion detected near enrolled student ${aws.matchedStudentId}.`,
                  'medium',
                  Number((aws.faceCount / 2).toFixed(2)),
                  1,
                  true
                );
              }
            }

            if (aws.proxyRisk) {
              addAlert(
                'proxy_face_mismatch',
                `Possible proxy attendance: detected ${aws.matchedStudentId || 'unknown'} (${aws.bestMatchConfidence ?? 0}% similarity).`,
                'high',
                1,
                0.85,
                true,
                aws.matchedStudentId || undefined,
                aws.matchedFaceId || undefined
              );
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'AWS Rekognition call failed.';
            const awsUnavailable = /AWS credentials are not configured|security token included in the request is invalid|UnrecognizedClientException|InvalidSignatureException|503|502|Failed to fetch|Network request failed/i.test(message);

            if (awsUnavailable) {
              setAwsConfigured(false);
              setUseAwsRekognition(false);
              setAwsStatus('idle');
              await runLocalFaceRecognition();
            } else {
              setAwsStatus('error');
              setCameraError(message);
            }
          }
        }
      }
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : 'Face analysis failed.');
    } finally {
      analysisBusyRef.current = false;
    }
  };

  const captureFrameBase64 = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null;

    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.55);
    const base64 = dataUrl.split(',')[1];
    return base64 || null;
  };

  const downloadAlertLog = () => {
    const header = 'Timestamp,Camera,Hall,Student ID,Event Type,Severity,Suspicion Score,Threshold,Detail';
    const rows = alerts.map((a) =>
      [
        a.timestamp,
        a.cameraId,
        a.hallId,
        a.studentId,
        a.eventType,
        a.severity,
        a.suspicionScore,
        a.threshold,
        `"${(a.detail || '').replace(/"/g, '""')}"`,
      ].join(',')
    );
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `malpractice_log_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const lastAlert = alerts[0];
  const severityColor = useMemo(() => {
    if (!lastAlert) return '#86EFAC';
    if (lastAlert.severity === 'high') return '#FCA5A5';
    if (lastAlert.severity === 'medium') return '#FDE68A';
    return '#86EFAC';
  }, [lastAlert]);

  if (!data) return <div style={{ padding: '2rem' }}>Loading monitoring data...</div>;

  return (
    <div className="page-enter" style={{
      minHeight: 'calc(100vh - 68px)',
      width: '100%',
      padding: '2rem'
    }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <h2 className="animate-fade-in-up" style={{ color: 'var(--accent)', marginBottom: '0.5rem' }}>Live Exam Monitoring</h2>

        {/* Active Session Indicator */}
        {activeSessionId ? (
          <div style={{
            background: 'linear-gradient(135deg, rgba(15,118,110,0.15), rgba(45,212,191,0.08))',
            border: '1px solid rgba(94,234,212,0.25)',
            borderRadius: '12px',
            padding: '0.6rem 1.25rem',
            marginBottom: '1.5rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            color: '#5EEAD4',
            fontWeight: 600,
            fontSize: '0.9rem',
          }}>
            <span className="status-dot status-dot--live" />
            Monitoring: {activeSessionLabel}
          </div>
        ) : (
          <div style={{
            background: 'rgba(242,114,41,0.08)',
            border: '1px solid rgba(242,114,41,0.2)',
            borderRadius: '12px',
            padding: '0.75rem 1rem',
            marginBottom: '1.5rem',
            color: '#F59E0B',
            fontSize: '0.85rem',
            fontWeight: 500,
          }}>
            ⚠️ No active exam session. Go to <strong>Exams</strong> to select a session before monitoring.
          </div>
        )}
        
        <div className="stagger-children" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
          <div className="card-accent-hover" style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, color: 'var(--muted)' }}>Active Sessions</h3>
            <p style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#5EEAD4', margin: '0.5rem 0' }}>{data.activeSessions}</p>
          </div>
          <div className="card-accent-hover" style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, color: 'var(--muted)' }}>Devices Online</h3>
            <p style={{ fontSize: '2.5rem', fontWeight: 'bold', color: '#93C5FD', margin: '0.5rem 0' }}>{data.devicesOnline}</p>
          </div>
        </div>

        <div className="card-accent-hover animate-fade-in-up delay-5" style={{ background: 'var(--card)', padding: '1.5rem', borderRadius: '16px', border: '1px solid var(--border)' }}>
          <h3 style={{ marginTop: 0, marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', color: 'var(--accent)' }}>Recent Activity Logs</h3>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {data.recentLogs.map((log: any, index: number) => (
              <li key={index} className="list-item-enter" style={{ animationDelay: `${0.06 + index * 0.04}s`, padding: '0.75rem 0', borderBottom: index !== data.recentLogs.length - 1 ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between' }}>
                <span>{log.event}</span>
                <span style={{ color: '#888', fontSize: '0.9rem' }}>{log.time}</span>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ marginTop: '2rem', background: 'rgba(15, 23, 42, 0.92)', color: '#fff', padding: '1.5rem', borderRadius: '16px', boxShadow: '0 10px 24px rgba(15,23,42,0.18)' }}>
          <div className="animate-fade-in-up delay-1" style={{ fontSize: '0.85rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#93C5FD', fontWeight: 700, marginBottom: '0.5rem' }}>
            AI Malpractice Detection
          </div>
          <h3 className="animate-fade-in-up delay-2" style={{ marginTop: 0, marginBottom: '1rem' }}>Real-time face monitoring and malpractice alerts</h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '1rem' }}>
            <div>
              {flaggedStudentId && (
                <div className="animate-slide-in-left" style={{ marginBottom: '0.9rem', background: 'rgba(127,29,29,0.28)', border: '1px solid rgba(248,113,113,0.45)', borderRadius: '10px', padding: '0.8rem 0.9rem', color: '#FCA5A5' }}>
                  <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#FCA5A5', fontWeight: 700 }}>Flagged Student ID</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800 }}>{flaggedStudentId}</div>
                  <div style={{ marginTop: '0.25rem', color: '#FECACA', fontSize: '0.86rem' }}>
                    This ID is being tracked for movement or candidate-interaction alerts.
                  </div>
                </div>
              )}

              <div className={cameraActive ? 'animate-border-glow' : ''} style={{ position: 'relative', borderRadius: '16px', overflow: 'hidden', border: `2px solid ${lastAlert ? severityColor : 'rgba(148,163,184,0.35)'}`, background: '#020617', minHeight: '400px' }}>
                {hallViewMode === 'grid' ? (
                  /* Multi-camera grid for exam hall */
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr 1fr', gap: '2px', minHeight: '400px', background: '#1E293B' }}>
                    {/* Camera 1 - Primary (front view with face detection) */}
                    <div style={{ position: 'relative', overflow: 'hidden', gridColumn: '1', gridRow: '1 / 3', background: '#020617' }}>
                      <div style={{ position: 'absolute', top: 4, left: 4, zIndex: 10, background: 'rgba(14,165,233,0.85)', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em' }}>FRONT VIEW - AI Detection Active</div>
                      <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', display: 'block', objectFit: 'contain', minHeight: '400px' }} />
                      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                      {!cameraActive && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', background: 'rgba(2, 6, 23, 0.72)' }}>
                          Camera offline
                        </div>
                      )}
                    </div>
                    {/* Camera 2 - Side view (left) */}
                    <div style={{ position: 'relative', overflow: 'hidden', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ position: 'absolute', top: 4, left: 4, zIndex: 10, background: 'rgba(100,116,139,0.8)', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em' }}>LEFT WING</div>
                      <canvas ref={canvasRef2} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                      <div style={{ textAlign: 'center', color: '#64748B' }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><circle cx="12" cy="17" r="1"/></svg>
                        <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>External camera port</div>
                        <div style={{ fontSize: '0.65rem', color: '#475569' }}>Connect USB camera 2</div>
                      </div>
                    </div>
                    {/* Camera 3 - Right view */}
                    <div style={{ position: 'relative', overflow: 'hidden', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ position: 'absolute', top: 4, left: 4, zIndex: 10, background: 'rgba(100,116,139,0.8)', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em' }}>RIGHT WING</div>
                      <canvas ref={canvasRef3} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                      <div style={{ textAlign: 'center', color: '#64748B' }}>
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#475569" strokeWidth="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><circle cx="12" cy="17" r="1"/></svg>
                        <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>External camera port</div>
                        <div style={{ fontSize: '0.65rem', color: '#475569' }}>Connect USB camera 3</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Single camera view (original) */
                  <>
                    <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', display: 'block', minHeight: '400px', objectFit: 'contain' }} />
                    <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} />
                    {!cameraActive && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', background: 'rgba(2, 6, 23, 0.72)' }}>
                        Camera is offline
                      </div>
                    )}
                  </>
                )}
              </div>

              <div style={{ display: 'flex', gap: '0.7rem', marginTop: '0.85rem', flexWrap: 'wrap' }}>
                <button onClick={cameraActive ? stopCamera : startCamera} style={{ background: cameraActive ? '#1E3A8A' : '#1D4ED8', border: 'none', color: '#fff', borderRadius: '12px', padding: '0.55rem 0.95rem', fontWeight: 700, cursor: 'pointer' }}>
                  {cameraActive ? 'Stop Camera' : 'Start Camera'}
                </button>
                <button onClick={() => setHallViewMode(hallViewMode === 'grid' ? 'single' : 'grid')} style={{ background: '#1D4ED8', border: '1px solid #1E3A8A', color: 'var(--text)', borderRadius: '12px', padding: '0.55rem 0.95rem', fontWeight: 700, cursor: 'pointer' }}>
                  View: {hallViewMode === 'grid' ? 'Multi-Cam' : 'Single'}
                </button>
                <button onClick={() => setAlertToneEnabled((v) => !v)} style={{ background: '#1D4ED8', border: '1px solid #1E3A8A', color: 'var(--text)', borderRadius: '12px', padding: '0.55rem 0.95rem', fontWeight: 700, cursor: 'pointer' }}>
                  Alert Tone: {alertToneEnabled ? 'On' : 'Off'}
                </button>
                <button
                  onClick={() => setUseAwsRekognition((v) => !v)}
                  disabled={!awsConfigured}
                  style={{
                    background: useAwsRekognition ? '#1D4ED8' : '#1E3A8A',
                    border: '1px solid #1E3A8A',
                    color: 'var(--text)',
                    borderRadius: '12px',
                    padding: '0.55rem 0.95rem',
                    fontWeight: 700,
                    cursor: awsConfigured ? 'pointer' : 'not-allowed',
                    opacity: awsConfigured ? 1 : 0.6,
                  }}
                >
                  AWS Rekognition: {awsConfigured ? (useAwsRekognition ? 'On' : 'Off') : 'Unavailable'}
                </button>
                <button onClick={handleInitializeCollection} disabled={initializingCollection} style={{ background: '#1D4ED8', border: 'none', color: '#fff', borderRadius: '12px', padding: '0.55rem 0.95rem', fontWeight: 700, cursor: initializingCollection ? 'not-allowed' : 'pointer', opacity: initializingCollection ? 0.7 : 1 }}>
                  {initializingCollection ? 'Initializing Collection...' : 'Init Rekognition Collection'}
                </button>
                <button onClick={downloadAlertLog} disabled={alerts.length === 0} style={{ background: '#1D4ED8', border: 'none', color: '#fff', borderRadius: '12px', padding: '0.55rem 0.95rem', fontWeight: 700, cursor: alerts.length > 0 ? 'pointer' : 'not-allowed', opacity: alerts.length > 0 ? 1 : 0.6 }}>
                  Export CSV Log
                </button>
              </div>

              {cameraError && (
                <div style={{ marginTop: '0.75rem', color: '#FCA5A5', background: 'rgba(127,29,29,0.25)', border: '1px solid rgba(248,113,113,0.35)', borderRadius: '12px', padding: '0.6rem 0.75rem' }}>
                  {cameraError}
                </div>
              )}
              {!faceApiSupported && (
                <div style={{ marginTop: '0.75rem', color: '#FDE68A' }}>
                  Live face detection requires browser support for the Face Detection API.
                </div>
              )}
              {!awsConfigured && (
                <div style={{ marginTop: '0.75rem', color: '#FDE68A' }}>
                  AWS recognition is disabled because backend AWS configuration is unavailable or invalid.
                </div>
              )}
              <div style={{ marginTop: '0.75rem', color: '#BFDBFE', fontSize: '0.88rem' }}>
                Face enrollment now uses registered students from Student Management (profile photo + student ID).
              </div>
            </div>

            <div className="stagger-children" style={{ display: 'grid', gap: '0.75rem' }}>
              <div style={{ background: 'var(--border)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '10px', padding: '0.8rem' }}>
                <div style={{ color: '#93C5FD', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Absence Duration</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{absenceSeconds}s</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>Threshold: {absenceThresholdSeconds}s</div>
              </div>
              <div style={{ background: 'var(--border)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '10px', padding: '0.8rem' }}>
                <div style={{ color: '#93C5FD', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Movement Score</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{movementScore}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>Threshold: &gt;{(movementThresholdRatio * 100).toFixed(0)}% face width | {movementConsecutiveRequired} consecutive frames</div>
              </div>
              <div style={{ background: 'var(--border)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '10px', padding: '0.8rem' }}>
                <div style={{ color: '#93C5FD', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Alerts Raised</div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800 }}>{alerts.length}</div>
              </div>
              <div style={{ background: 'var(--border)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '10px', padding: '0.8rem' }}>
                <div style={{ color: '#93C5FD', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Risk Tier</div>
                <div className={riskTier !== 'low' ? 'animate-pulse' : ''} style={{ fontSize: '1.2rem', fontWeight: 800, textTransform: 'capitalize', color: riskTier === 'high' ? '#EF4444' : riskTier === 'medium' ? '#F59E0B' : '#10B981' }}>{riskTier}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>Risk score: {riskScore}/100</div>
              </div>
              <div style={{ background: 'var(--border)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '10px', padding: '0.8rem' }}>
                <div style={{ color: '#93C5FD', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>AWS Status</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, textTransform: 'capitalize' }}>{awsStatus}</div>
              </div>
              <div style={{ background: 'var(--border)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '10px', padding: '0.8rem' }}>
                <div style={{ color: '#93C5FD', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Collection</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, textTransform: 'capitalize' }}>{collectionStatus}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>Database Enrolled: {localFaceProfiles.length} | AWS Indexed: {collectionFaceCount}</div>
              </div>
              <div style={{ background: 'var(--border)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '10px', padding: '0.8rem' }}>
                <div style={{ color: '#93C5FD', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Recognized Student</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{identifiedStudentId !== 'Unknown' ? identifiedStudentId : latestRecognizedStudentIdRef.current || 'Unknown'}</div>
                <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                  {identifiedStudentIds.length > 0 ? `Enrolled students in frame: ${identifiedStudentIds.join(', ')}` : 'Shown when the live camera matches an enrolled student.'}
                </div>
              </div>
            </div>
          </div>

          <div className="animate-fade-in-up delay-3" style={{ marginTop: '1rem', background: 'rgba(2, 6, 23, 0.65)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '10px', padding: '0.9rem', color: '#E2E8F0' }}>
            <h4 style={{ marginTop: 0, marginBottom: '0.8rem', color: 'var(--accent)' }}>Malpractice Event Log</h4>
            {alerts.length === 0 && <div style={{ color: '#94A3B8' }}>No malpractice alerts yet. Start camera to begin monitoring.</div>}
            {alerts.slice(0, 6).map((alert, i) => (
              <div key={alert.id} className="animate-slide-in-right" style={{ animationDelay: `${0.05 + i * 0.08}s`, padding: '0.55rem 0', borderBottom: '1px solid rgba(148,163,184,0.18)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 700, color: '#E2E8F0' }}>{alert.eventType.replace(/_/g, ' ')}</div>
                  <div style={{ color: '#94A3B8', fontSize: '0.85rem' }}>{new Date(alert.timestamp).toLocaleString()}</div>
                </div>
                <div style={{ color: '#94A3B8', fontSize: '0.9rem' }}>{alert.detail}</div>
                {(alert.eventType === 'excessive_movement' || alert.eventType === 'candidate_interaction' || alert.eventType === 'proxy_face_mismatch') && (
                  <div style={{ color: '#FCA5A5', fontSize: '0.9rem', fontWeight: 700, marginTop: '0.2rem' }}>
                    Flagged Student: {alert.studentId || 'unknown'}
                  </div>
                )}
                <div style={{ color: '#94A3B8', fontSize: '0.78rem' }}>
                  student={alert.studentId || 'unknown'} faceId={alert.faceId || 'unknown'} severity={alert.severity} score={alert.suspicionScore} threshold={alert.threshold} camera={alert.cameraId}
                </div>
              </div>
            ))}
          </div>

          {snapshotDataUrl && (
            <div className="animate-fade-in-up" style={{ marginTop: '1rem' }}>
              <div style={{ marginBottom: '0.4rem', color: 'var(--muted)', fontSize: '0.88rem' }}>Latest evidence snapshot</div>
              <img src={snapshotDataUrl} alt="Latest malpractice evidence" style={{ width: '240px', borderRadius: '10px', border: '1px solid var(--border)' }} />
            </div>
          )}

          <div className="animate-fade-in-up delay-6" style={{ marginTop: '1.2rem', background: 'rgba(2, 6, 23, 0.65)', border: '1px solid rgba(148,163,184,0.25)', borderRadius: '10px', padding: '0.9rem', color: '#E2E8F0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <h4 style={{ margin: 0, color: 'var(--accent)' }}>Enrolled Faces</h4>
              <button onClick={refreshEnrolledFaces} className="btn-lift" style={{ background: 'rgba(148,163,184,0.18)', border: '1px solid rgba(148,163,184,0.3)', color: '#E2E8F0', borderRadius: '12px', padding: '0.45rem 0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                Refresh
              </button>
            </div>

            {loadingFaces ? (
              <div style={{ color: '#94A3B8', marginTop: '0.8rem' }}>Loading enrolled faces...</div>
            ) : enrolledFaces.length === 0 ? (
              <div style={{ color: '#94A3B8', marginTop: '0.8rem' }}>No faces are enrolled yet.</div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: '0.8rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#E2E8F0' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(148,163,184,0.25)' }}>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Student ID</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Face ID</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Confidence</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Indexed At</th>
                      <th style={{ padding: '0.65rem 0.5rem' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enrolledFaces.map((face) => (
                      <tr key={face.faceId} style={{ borderBottom: '1px solid rgba(148,163,184,0.16)' }}>
                        <td style={{ padding: '0.65rem 0.5rem' }}>{face.externalImageId}</td>
                        <td style={{ padding: '0.65rem 0.5rem', wordBreak: 'break-all' }}>{face.faceId}</td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>
                          {face.faceId.startsWith('local-')
                            ? 'Local enrollment'
                            : face.confidence !== null
                              ? `${face.confidence.toFixed(2)}%`
                              : 'N/A'}
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>
                          {face.faceId.startsWith('local-')
                            ? 'Stored in student profile'
                            : face.indexedAt
                              ? new Date(face.indexedAt).toLocaleString()
                              : 'N/A'}
                        </td>
                        <td style={{ padding: '0.65rem 0.5rem' }}>
                          {face.faceId.startsWith('local-') ? (
                            <button
                              onClick={() => navigate('/students')}
                              className="btn-lift"
                              style={{ background: '#0EA5E9', border: 'none', color: '#fff', borderRadius: '12px', padding: '0.45rem 0.8rem', fontWeight: 700, cursor: 'pointer' }}
                            >
                              Manage
                            </button>
                          ) : (
                            <button onClick={() => handleDeleteFace(face.faceId)} className="btn-lift" style={{ background: '#EF4444', border: 'none', color: '#fff', borderRadius: '12px', padding: '0.45rem 0.8rem', fontWeight: 700, cursor: 'pointer' }}>
                              Delete
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
export default MonitoringPage;
