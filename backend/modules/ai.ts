import express from 'express';
import {
  CreateCollectionCommand,
  DetectFacesCommand,
  DescribeCollectionCommand,
  DeleteFacesCommand,
  IndexFacesCommand,
  ListFacesCommand,
  RekognitionClient,
  ResourceNotFoundException,
  SearchFacesByImageCommand,
} from '@aws-sdk/client-rekognition';

type Student = {
  index: string;
  name: string;
  programme: string;
  level: string;
  fingerprintEnrolled?: boolean;
};

type AttendanceRecord = {
  studentId: string;
  courseCode: string;
  date: string;
  time: string;
  status: 'Present' | 'Absent';
};

type Session = {
  id: number;
  course: string;
  courseCode: string;
  date: string;
  time: string;
  hall: string;
};

type ScanEvent = {
  id?: number;
  studentId?: string;
  courseCode?: string;
  date: string;
  time: string;
  result: 'success' | 'failed' | 'duplicate' | 'enrollment';
  reason?: string;
};

type Snapshot = {
  students?: Student[];
  attendance?: AttendanceRecord[];
  sessions?: Session[];
  scanEvents?: ScanEvent[];
};

type HallSummary = {
  hall: string;
  courseCode: string;
  course: string;
  date: string;
  scheduledTime: string;
  present: number;
  absent: number;
  attendanceRate: number;
};

type InsightReport = {
  overview: string;
  absentToday: string[];
  repeatedScanFailures: { studentId: string; count: number; reason: string }[];
  hallSummaries: HallSummary[];
  anomalies: string[];
  riskFlags: string[];
  recommendations: string[];
};

const router = express.Router();

const awsRegion = process.env.AWS_REGION || 'us-east-1';
const getAwsCollectionId = () => process.env.AWS_REKOGNITION_COLLECTION_ID || '';

const rekognitionClient = new RekognitionClient({ region: awsRegion });

const awsConfigured = () => Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);

const describeCollectionSafe = async () => {
  const awsCollectionId = getAwsCollectionId();
  if (!awsCollectionId) return { exists: false as const, faceCount: 0, message: 'AWS_REKOGNITION_COLLECTION_ID is not set' };

  try {
    const details = await rekognitionClient.send(
      new DescribeCollectionCommand({ CollectionId: awsCollectionId })
    );
    return {
      exists: true as const,
      faceCount: details.FaceCount || 0,
      arn: details.CollectionARN,
      modelVersion: details.FaceModelVersion,
      createdAt: details.CreationTimestamp?.toISOString() || null,
    };
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      return { exists: false as const, faceCount: 0, message: 'Collection does not exist yet' };
    }
    throw error;
  }
};

const toArray = <T,>(value: T[] | undefined): T[] => Array.isArray(value) ? value : [];

const uniqueCount = (values: string[]) => new Set(values.filter(Boolean)).size;

const parseTime = (value: string) => {
  if (!value) return null;
  const match = value.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const suffix = match[3]?.toUpperCase();
  if (suffix === 'PM' && hours < 12) hours += 12;
  if (suffix === 'AM' && hours === 12) hours = 0;
  return hours * 60 + minutes;
};

const getLatestDate = (snapshot: Snapshot) => {
  const dates = [
    ...toArray(snapshot.attendance).map((record) => record.date),
    ...toArray(snapshot.sessions).map((session) => session.date),
    ...toArray(snapshot.scanEvents).map((event) => event.date),
  ].filter(Boolean);
  if (dates.length === 0) {
    return new Date().toISOString().split('T')[0] || '1970-01-01';
  }
  return dates.sort().at(-1)!;
};

const buildHallSummaries = (
  students: Student[],
  attendance: AttendanceRecord[],
  sessions: Session[],
  targetDate: string
) => {
  return sessions
    .filter((session) => session.date === targetDate)
    .map((session) => {
      const sessionAttendance = attendance.filter((record) =>
        record.date === targetDate &&
        record.courseCode === session.courseCode &&
        record.status === 'Present'
      );
      const present = uniqueCount(sessionAttendance.map((record) => record.studentId));
      const absent = Math.max(students.length - present, 0);
      const attendanceRate = students.length > 0 ? Math.round((present / students.length) * 100) : 0;
      return {
        hall: session.hall,
        courseCode: session.courseCode,
        course: session.course,
        date: session.date,
        scheduledTime: session.time,
        present,
        absent,
        attendanceRate,
      };
    })
    .sort((a, b) => a.hall.localeCompare(b.hall));
};

const buildRepeatedFailures = (events: ScanEvent[]) => {
  const grouped = new Map<string, { studentId: string; count: number; reason: string }>();
  for (const event of events) {
    if (event.result !== 'failed' && event.result !== 'duplicate') continue;
    const studentId = event.studentId || 'Unknown';
    const key = `${studentId}:${event.reason || event.result}`;
    const entry = grouped.get(key) || { studentId, count: 0, reason: event.reason || event.result };
    entry.count += 1;
    grouped.set(key, entry);
  }
  return Array.from(grouped.values())
    .filter((entry) => entry.count >= 2)
    .sort((a, b) => b.count - a.count);
};

const buildAnomalies = (
  students: Student[],
  attendance: AttendanceRecord[],
  sessions: Session[],
  scanEvents: ScanEvent[],
  targetDate: string
) => {
  const anomalies: string[] = [];
  const duplicates = new Map<string, number>();

  for (const record of attendance) {
    if (record.status !== 'Present') continue;
    const key = `${record.studentId}:${record.courseCode}:${record.date}`;
    duplicates.set(key, (duplicates.get(key) || 0) + 1);
  }

  for (const [key, count] of duplicates.entries()) {
    if (count > 1) {
      const [studentId, courseCode, date] = key.split(':');
      anomalies.push(`Duplicate check-in detected for ${studentId} in ${courseCode} on ${date} (${count} scans).`);
    }
  }

  const repeatedFailures = buildRepeatedFailures(scanEvents.filter((event) => event.date === targetDate));
  for (const failure of repeatedFailures) {
    anomalies.push(`Repeated scan failures for ${failure.studentId}: ${failure.count} failed attempts (${failure.reason}).`);
  }

  const hallSummaries = buildHallSummaries(students, attendance, sessions, targetDate);
  for (const hall of hallSummaries) {
    if (hall.attendanceRate < 60) {
      anomalies.push(`${hall.hall} is below expected attendance with ${hall.attendanceRate}% for ${hall.courseCode}.`);
    }
  }

  for (const session of sessions.filter((entry) => entry.date === targetDate)) {
    const relevantTimes = attendance
      .filter((record) => record.date === targetDate && record.courseCode === session.courseCode && record.status === 'Present')
      .map((record) => parseTime(record.time))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);

    if (relevantTimes.length < 2) continue;

    let maxGap = 0;
    for (let i = 1; i < relevantTimes.length; i += 1) {
      const currentTime = relevantTimes[i];
      const previousTime = relevantTimes[i - 1];
      if (currentTime === undefined || previousTime === undefined) continue;
      maxGap = Math.max(maxGap, currentTime - previousTime);
    }

    const sessionStart = parseTime(session.time);
    const firstArrival = relevantTimes[0];
    const lateFirstArrival = sessionStart !== null && firstArrival !== undefined && firstArrival - sessionStart > 30;
    if (maxGap > 45 || lateFirstArrival) {
      anomalies.push(
        `${session.hall} shows irregular scan timing for ${session.courseCode}${lateFirstArrival ? ' with a delayed first check-in' : ''}.`
      );
    }
  }

  return anomalies;
};

const buildReport = (snapshot: Snapshot, question?: string): InsightReport => {
  const students = toArray(snapshot.students);
  const attendance = toArray(snapshot.attendance);
  const sessions = toArray(snapshot.sessions);
  const scanEvents = toArray(snapshot.scanEvents);
  const targetDate = getLatestDate(snapshot);
  const hallSummaries = buildHallSummaries(students, attendance, sessions, targetDate);

  const studentsPresentToday = new Set(
    attendance
      .filter((record) => record.date === targetDate && record.status === 'Present')
      .map((record) => record.studentId)
  );

  const absentToday = students
    .filter((student) => !studentsPresentToday.has(student.index))
    .map((student) => `${student.name} (${student.index})`);

  const repeatedScanFailures = buildRepeatedFailures(scanEvents.filter((event) => event.date === targetDate));
  const anomalies = buildAnomalies(students, attendance, sessions, scanEvents, targetDate);

  const lowAttendanceHalls = hallSummaries.filter((hall) => hall.attendanceRate < 75);
  const unenrolledStudents = students.filter((student) => !student.fingerprintEnrolled).length;

  const riskFlags = [
    ...lowAttendanceHalls.map((hall) => `${hall.hall} is at ${hall.attendanceRate}% attendance for ${hall.courseCode}.`),
    ...repeatedScanFailures.map((failure) => `${failure.studentId} has ${failure.count} failed scan attempts.`),
  ];

  if (unenrolledStudents > 0) {
    riskFlags.push(`${unenrolledStudents} students still have pending fingerprint enrollment.`);
  }

  const recommendations = [
    lowAttendanceHalls.length > 0
      ? 'Deploy an officer to the lowest-attendance hall and reconcile missing students against the seating list.'
      : 'Attendance coverage is stable; continue real-time monitoring and spot-check duplicate scans.',
    repeatedScanFailures.length > 0
      ? 'Review scanner placement and verify student IDs for users with repeated failed scans.'
      : 'Keep scanning lanes open and log failed scans so anomaly detection stays useful.',
    unenrolledStudents > 0
      ? 'Schedule a quick biometric enrollment catch-up for students still marked as pending.'
      : 'Biometric enrollment coverage is healthy; maintain backups before each exam window.',
  ];

  const totalPresent = uniqueCount(
    attendance
      .filter((record) => record.date === targetDate && record.status === 'Present')
      .map((record) => record.studentId)
  );
  const totalStudents = students.length;
  const totalAttendanceRate = totalStudents > 0 ? Math.round((totalPresent / totalStudents) * 100) : 0;

  const overview = question
    ? `For ${targetDate}, the system shows ${totalPresent} of ${totalStudents} students marked present (${totalAttendanceRate}%). ${hallSummaries.length} exam hall summaries were analyzed, with ${anomalies.length} anomaly signals identified.`
    : `Attendance on ${targetDate} stands at ${totalAttendanceRate}% with ${hallSummaries.length} active hall summaries and ${anomalies.length} anomaly signals requiring attention.`;

  return {
    overview,
    absentToday,
    repeatedScanFailures,
    hallSummaries,
    anomalies,
    riskFlags,
    recommendations,
  };
};

const answerQuestion = (question: string, report: InsightReport) => {
  const normalized = question.toLowerCase();

  if (normalized.includes('absent')) {
    return report.absentToday.length > 0
      ? `Absent students today: ${report.absentToday.slice(0, 12).join(', ')}.`
      : 'No absent students were detected for the latest exam day in the current dataset.';
  }

  if (normalized.includes('hall') || normalized.includes('exam hall') || normalized.includes('summarize attendance')) {
    return report.hallSummaries.length > 0
      ? `Hall summary: ${report.hallSummaries.map((hall) => `${hall.hall} (${hall.courseCode}) is ${hall.attendanceRate}% with ${hall.present} present and ${hall.absent} absent`).join('; ')}.`
      : 'There are no exam hall summaries available yet. Create sessions and attendance records to populate this view.';
  }

  if (normalized.includes('scan failure') || normalized.includes('failed scan')) {
    return report.repeatedScanFailures.length > 0
      ? `Repeated scan failures: ${report.repeatedScanFailures.map((entry) => `${entry.studentId} had ${entry.count} failed attempts`).join('; ')}.`
      : 'No repeated scan failures were found in the latest monitoring data.';
  }

  if (normalized.includes('anomal')) {
    return report.anomalies.length > 0
      ? `Anomaly highlights: ${report.anomalies.slice(0, 5).join(' ')}`
      : 'No significant anomalies were detected in the current attendance and scan data.';
  }

  if (normalized.includes('recommend') || normalized.includes('what should')) {
    return `Recommended next steps: ${report.recommendations.join(' ')}`;
  }

  if (normalized.includes('setup') || normalized.includes('enrollment') || normalized.includes('monitoring') || normalized.includes('reporting')) {
    return 'Use Exam Setup to create a session with course code, date, time, and hall. Use Enrollment to confirm fingerprints before exam day. Use Attendance and Monitoring during the session, then open Reporting to export the attendance report and review AI risk flags.';
  }

  return `${report.overview} Key risks: ${report.riskFlags.slice(0, 3).join(' ') || 'No critical risks detected.'}`;
};

router.post('/chat', (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question : '';
  const snapshot = (req.body?.snapshot || {}) as Snapshot;
  const report = buildReport(snapshot, question);

  res.json({
    answer: answerQuestion(question, report),
    report,
  });
});

router.post('/report', (req, res) => {
  const snapshot = (req.body?.snapshot || {}) as Snapshot;
  res.json(buildReport(snapshot));
});

router.post('/anomalies', (req, res) => {
  const snapshot = (req.body?.snapshot || {}) as Snapshot;
  const report = buildReport(snapshot);
  res.json({
    anomalies: report.anomalies,
    repeatedScanFailures: report.repeatedScanFailures,
    hallSummaries: report.hallSummaries,
    riskFlags: report.riskFlags,
    recommendations: report.recommendations,
  });
});

router.post('/malpractice/frame', async (req, res) => {
  const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : '';
  const cameraId = typeof req.body?.cameraId === 'string' ? req.body.cameraId : 'unknown_camera';
  const hallId = typeof req.body?.hallId === 'string' ? req.body.hallId : 'unknown_hall';
  const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId : 'unknown_student';
  const normalizedStudentId = studentId.trim();
  const hasExpectedStudent =
    normalizedStudentId.length > 0 &&
    normalizedStudentId !== 'unknown_student' &&
    normalizedStudentId !== 'candidate_live_feed';

  if (!imageBase64) {
    return res.status(400).json({ error: 'imageBase64 is required' });
  }

  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    return res.status(503).json({
      error: 'AWS credentials are not configured on backend',
      cameraId,
      hallId,
      studentId,
    });
  }

  try {
    const bytes = Buffer.from(imageBase64, 'base64');

    const detectResult = await rekognitionClient.send(
      new DetectFacesCommand({
        Image: { Bytes: bytes },
        Attributes: ['ALL'],
      })
    );

    const faceDetails = detectResult.FaceDetails || [];
    const faceCount = faceDetails.length;
    const absence = faceCount === 0;
    const multipleFaces = faceCount > 1;

    let proxyRisk = false;
    let bestMatchConfidence: number | null = null;
    let matchedStudentId: string | null = null;
    let matchedFaceId: string | null = null;

    const awsCollectionId = getAwsCollectionId();
    if (awsCollectionId) {
      try {
        const searchResult = await rekognitionClient.send(
          new SearchFacesByImageCommand({
            CollectionId: awsCollectionId,
            Image: { Bytes: bytes },
            MaxFaces: 1,
            FaceMatchThreshold: 85,
          })
        );
        const bestMatch = searchResult.FaceMatches?.[0];
        bestMatchConfidence = bestMatch?.Similarity ? Number(bestMatch.Similarity.toFixed(2)) : null;
        matchedStudentId = bestMatch?.Face?.ExternalImageId || null;
        matchedFaceId = bestMatch?.Face?.FaceId || null;
        proxyRisk = !bestMatch;
        if (matchedStudentId && hasExpectedStudent && matchedStudentId !== normalizedStudentId) {
          proxyRisk = true;
        }
      } catch {
        proxyRisk = false;
      }
    }

    const primary = faceDetails[0];
    const faceBoxes = faceDetails
      .map((detail) => detail.BoundingBox)
      .filter((box): box is NonNullable<typeof box> => Boolean(box))
      .map((box) => ({
        left: box.Left ?? 0,
        top: box.Top ?? 0,
        width: box.Width ?? 0,
        height: box.Height ?? 0,
      }));
    const yaw = primary?.Pose?.Yaw ?? null;
    const pitch = primary?.Pose?.Pitch ?? null;
    const roll = primary?.Pose?.Roll ?? null;
    const sharpness = primary?.Quality?.Sharpness ?? null;
    const brightness = primary?.Quality?.Brightness ?? null;

    return res.json({
      timestamp: new Date().toISOString(),
      cameraId,
      hallId,
      studentId,
      source: 'aws_rekognition',
      faceCount,
      absence,
      multipleFaces,
      proxyRisk,
      bestMatchConfidence,
      matchedStudentId,
      matchedFaceId,
      faceBoxes,
      pose: { yaw, pitch, roll },
      quality: { sharpness, brightness },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Rekognition request failed';
    return res.status(502).json({ error: message, cameraId, hallId, studentId });
  }
});

router.get('/malpractice/collection/status', async (_req, res) => {
  const awsCollectionId = getAwsCollectionId();
  if (!awsConfigured()) {
    return res.status(503).json({
      configured: false,
      collectionId: awsCollectionId || null,
      message: 'AWS credentials are not configured on backend',
    });
  }

  try {
    const info = await describeCollectionSafe();
    return res.json({
      configured: true,
      region: awsRegion,
      collectionId: awsCollectionId || null,
      ...info,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to check collection status';
    return res.json({
      configured: true,
      region: awsRegion,
      collectionId: awsCollectionId || null,
      exists: false,
      faceCount: 0,
      error: message,
    });
  }
});

router.post('/malpractice/collection/init', async (_req, res) => {
  const awsCollectionId = getAwsCollectionId();
  if (!awsConfigured()) {
    return res.status(503).json({
      initialized: false,
      collectionId: awsCollectionId || null,
      message: 'AWS credentials are not configured on backend',
    });
  }

  if (!awsCollectionId) {
    return res.status(400).json({
      initialized: false,
      message: 'AWS_REKOGNITION_COLLECTION_ID is required',
    });
  }

  try {
    const current = await describeCollectionSafe();
    if (current.exists) {
      return res.json({
        initialized: true,
        alreadyExists: true,
        region: awsRegion,
        collectionId: awsCollectionId,
        ...current,
      });
    }

    await rekognitionClient.send(new CreateCollectionCommand({ CollectionId: awsCollectionId }));
    const created = await describeCollectionSafe();

    return res.json({
      initialized: true,
      alreadyExists: false,
      region: awsRegion,
      collectionId: awsCollectionId,
      ...created,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to initialize collection';
    return res.status(502).json({ initialized: false, region: awsRegion, collectionId: awsCollectionId || null, error: message });
  }
});

router.post('/malpractice/collection/enroll', async (req, res) => {
  const awsCollectionId = getAwsCollectionId();
  const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : '';
  const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId.trim() : '';

  if (!awsConfigured()) {
    return res.status(503).json({
      enrolled: false,
      message: 'AWS credentials are not configured on backend',
    });
  }

  if (!awsCollectionId) {
    return res.status(400).json({
      enrolled: false,
      message: 'AWS_REKOGNITION_COLLECTION_ID is required',
    });
  }

  if (!imageBase64) {
    return res.status(400).json({
      enrolled: false,
      message: 'imageBase64 is required',
    });
  }

  if (!studentId) {
    return res.status(400).json({
      enrolled: false,
      message: 'studentId is required',
    });
  }

  try {
    const bytes = Buffer.from(imageBase64, 'base64');
    const externalImageId = studentId.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 255);

    try {
      const existingFaces = await rekognitionClient.send(
        new ListFacesCommand({ CollectionId: awsCollectionId, MaxResults: 1000 })
      );
      const duplicateFaceIds = (existingFaces.Faces || [])
        .filter((face) => face.ExternalImageId === externalImageId && face.FaceId)
        .map((face) => face.FaceId as string);

      if (duplicateFaceIds.length > 0) {
        await rekognitionClient.send(
          new DeleteFacesCommand({
            CollectionId: awsCollectionId,
            FaceIds: duplicateFaceIds,
          })
        );
      }
    } catch {
      // Continue with enrollment even if duplicate cleanup fails.
    }

    const result = await rekognitionClient.send(
      new IndexFacesCommand({
        CollectionId: awsCollectionId,
        Image: { Bytes: bytes },
        ExternalImageId: externalImageId,
        MaxFaces: 1,
        QualityFilter: 'AUTO',
        DetectionAttributes: [],
      })
    );

    const indexedFace = result.FaceRecords?.[0]?.Face;
    if (!indexedFace?.FaceId) {
      return res.status(400).json({
        enrolled: false,
        message: 'No clear face detected for enrollment. Please capture a clearer frame.',
      });
    }

    return res.json({
      enrolled: true,
      collectionId: awsCollectionId,
      studentId,
      externalImageId,
      faceId: indexedFace.FaceId,
      confidence: indexedFace.Confidence ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to enroll face';
    return res.status(502).json({
      enrolled: false,
      message,
    });
  }
});

router.post('/malpractice/collection/check-duplicate', async (req, res) => {
  const awsCollectionId = getAwsCollectionId();
  const imageBase64 = typeof req.body?.imageBase64 === 'string' ? req.body.imageBase64 : '';
  const studentId = typeof req.body?.studentId === 'string' ? req.body.studentId.trim() : '';

  if (!awsConfigured()) {
    return res.status(503).json({
      checked: false,
      message: 'AWS credentials are not configured on backend',
    });
  }

  if (!awsCollectionId) {
    return res.status(400).json({
      checked: false,
      message: 'AWS_REKOGNITION_COLLECTION_ID is required',
    });
  }

  if (!imageBase64) {
    return res.status(400).json({
      checked: false,
      isDuplicate: false,
      message: 'imageBase64 is required',
    });
  }

  try {
    const bytes = Buffer.from(imageBase64, 'base64');

    const searchResult = await rekognitionClient.send(
      new SearchFacesByImageCommand({
        CollectionId: awsCollectionId,
        Image: { Bytes: bytes },
        MaxFaces: 1,
        FaceMatchThreshold: 85,
      })
    );

    const bestMatch = searchResult.FaceMatches?.[0];
    const matchConfidence = bestMatch?.Similarity ? Number(bestMatch.Similarity.toFixed(2)) : null;
    const matchedStudentId = bestMatch?.Face?.ExternalImageId || null;
    const matchedFaceId = bestMatch?.Face?.FaceId || null;

    const isDuplicate = Boolean(matchedStudentId && matchedStudentId !== studentId);

    return res.json({
      checked: true,
      isDuplicate,
      matchedStudentId,
      matchedFaceId,
      matchConfidence,
      message: isDuplicate
        ? `This face matches an existing enrollment for student: ${matchedStudentId}`
        : 'No duplicate face found',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Duplicate check failed';
    return res.status(502).json({ checked: false, isDuplicate: false, message });
  }
});

router.get('/malpractice/collection/faces', async (_req, res) => {
  const awsCollectionId = getAwsCollectionId();

  if (!awsConfigured()) {
    return res.status(503).json({
      faces: [],
      message: 'AWS credentials are not configured on backend',
    });
  }

  if (!awsCollectionId) {
    return res.status(400).json({
      faces: [],
      message: 'AWS_REKOGNITION_COLLECTION_ID is required',
    });
  }

  try {
    const response = await rekognitionClient.send(
      new ListFacesCommand({ CollectionId: awsCollectionId, MaxResults: 1000 })
    );

    const faces = (response.Faces || []).map((face) => ({
      faceId: face.FaceId || '',
      externalImageId: face.ExternalImageId || '',
      imageId: face.ImageId || '',
      confidence: face.Confidence ?? null,
      indexedAt: null,
      collectionId: awsCollectionId,
    }));

    return res.json({
      collectionId: awsCollectionId,
      faces,
      faceCount: faces.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list collection faces';
    return res.status(502).json({ faces: [], message });
  }
});

router.delete('/malpractice/collection/faces/:faceId', async (req, res) => {
  const awsCollectionId = getAwsCollectionId();
  const faceId = typeof req.params?.faceId === 'string' ? req.params.faceId.trim() : '';

  if (!awsConfigured()) {
    return res.status(503).json({
      deleted: false,
      message: 'AWS credentials are not configured on backend',
    });
  }

  if (!awsCollectionId) {
    return res.status(400).json({
      deleted: false,
      message: 'AWS_REKOGNITION_COLLECTION_ID is required',
    });
  }

  if (!faceId) {
    return res.status(400).json({
      deleted: false,
      message: 'faceId is required',
    });
  }

  try {
    await rekognitionClient.send(
      new DeleteFacesCommand({
        CollectionId: awsCollectionId,
        FaceIds: [faceId],
      })
    );

    return res.json({
      deleted: true,
      collectionId: awsCollectionId,
      faceId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete face';
    return res.status(502).json({ deleted: false, message });
  }
});

// DELETE /api/ai/malpractice/collection/faces/by-student/:studentId
// Deletes all face records from the Rekognition collection that match the given student ID (ExternalImageId)
router.delete('/malpractice/collection/faces/by-student/:studentId', async (req, res) => {
  const awsCollectionId = getAwsCollectionId();
  const studentId = typeof req.params?.studentId === 'string' ? req.params.studentId.trim() : '';

  if (!awsConfigured()) {
    return res.status(503).json({ deleted: 0, message: 'AWS not configured' });
  }
  if (!awsCollectionId || !studentId) {
    return res.status(400).json({ deleted: 0, message: 'collectionId and studentId required' });
  }

  try {
    // List all faces and find those matching this student
    const listResponse = await rekognitionClient.send(
      new ListFacesCommand({ CollectionId: awsCollectionId, MaxResults: 1000 })
    );
    const matchingFaceIds = (listResponse.Faces || [])
      .filter((f: any) => f.ExternalImageId === studentId)
      .map((f: any) => f.FaceId)
      .filter(Boolean) as string[];

    if (matchingFaceIds.length === 0) {
      return res.json({ deleted: 0, studentId, message: 'No faces found for this student' });
    }

    // Delete in batches of 5 (AWS limit per DeleteFaces call)
    let deleted = 0;
    for (let i = 0; i < matchingFaceIds.length; i += 5) {
      const batch = matchingFaceIds.slice(i, i + 5);
      await rekognitionClient.send(
        new DeleteFacesCommand({ CollectionId: awsCollectionId, FaceIds: batch })
      );
      deleted += batch.length;
    }

    return res.json({ deleted, studentId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete faces by student';
    return res.status(502).json({ deleted: 0, message });
  }
});

export default router;
