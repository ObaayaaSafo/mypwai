import React, { useEffect, useState } from 'react';
import { fetchStudents, addStudent, deleteStudent } from '../api'; // addStudent also handles updates
import { enrollFaceToRekognitionCollection, getRekognitionCollectionStatus, initializeRekognitionCollection, checkDuplicateFaceEnrollment, fetchCourseEnrollments, fetchEnrolledCourses, assignStudentsToCourse, removeStudentsFromCourse } from '../apiExtra';

const StudentManagementPage: React.FC = () => {
  const [students, setStudents] = useState<any[]>([]);
  const [form, setForm] = useState({ index: '', name: '', programme: '', level: '', photo: '' });
  const [loading, setLoading] = useState(false);
  const [syncingAllFaces, setSyncingAllFaces] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingIndex, setEditingIndex] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedIndices, setSelectedIndices] = useState<Set<string>>(new Set());
  const [viewStudent, setViewStudent] = useState<any | null>(null);

  // ── Course Enrollment State ──
  const [courseEnrollmentTab, setCourseEnrollmentTab] = useState(false);
  const [enrollmentCourseCode, setEnrollmentCourseCode] = useState('');
  const [enrolledStudents, setEnrolledStudents] = useState<any[]>([]);
  const [availableCourses, setAvailableCourses] = useState<string[]>([]);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [enrollmentMessage, setEnrollmentMessage] = useState('');
  const [enrollmentError, setEnrollmentError] = useState('');
  const [selectedForEnrollment, setSelectedForEnrollment] = useState<Set<string>>(new Set());
  const [bulkEnrollInput, setBulkEnrollInput] = useState('');

  const itemsPerPage = 5;

  useEffect(() => {
    loadStudents();
  }, []);

  const loadStudents = async () => {
    fetchStudents().then(setStudents).catch(() => setError('Failed to load students'));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxDimension = 900;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));

        const context = canvas.getContext('2d');
        if (!context) {
          setForm({ ...form, photo: reader.result as string });
          return;
        }

        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const compressedPhoto = canvas.toDataURL('image/jpeg', 0.88);
        setForm({ ...form, photo: compressedPhoto });
      };

      image.onerror = () => {
        setForm({ ...form, photo: reader.result as string });
      };

      image.src = reader.result as string;
    };

    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice('');
    if (!form.index || !form.name || !form.programme || !form.level) {
      setError('All fields (Index, Name, Programme, Level) are required');
      return;
    }

    // Require profile photo for all new students (and for editing if no photo exists)
    if (!form.photo) {
      setError('A profile photo is required. Please upload a clear photo of the student for face recognition.');
      return;
    }

    if (!editingIndex && students.some(s => s.index === form.index)) {
      setError('A student with this Index Number already exists.');
      return;
    }

    if (editingIndex && form.index !== editingIndex && students.some(s => s.index === form.index)) {
      setError('Another student with this Index Number already exists.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const studentId = form.index.trim();
      const hasPhoto = typeof form.photo === 'string' && form.photo.length > 0;

      // Save basic student profile first.
      // Note: faceEnrolled will be set below after AWS Rekognition verifies a face is detectable in the photo
      await addStudent(form);
      // If the index was changed during edit, remove the old record to complete the rename.
      if (editingIndex && form.index !== editingIndex) {
        try {
          await deleteStudent(editingIndex);
        } catch (delErr) {
          // Non-fatal: log to error state but continue to reload students
          console.error('Failed to remove old student index after rename', delErr);
        }
      }

      // Face enrollment: AWS Rekognition must detect a face in the photo to mark as enrolled
      if (hasPhoto) {
        try {
          const imageBase64 = extractBase64Payload(form.photo);
          if (imageBase64) {
            // First ensure the Rekognition collection exists
            await ensureCollectionReady();

            // Check if this face already belongs to a different student
            const duplicateCheck = await checkDuplicateFaceEnrollment(imageBase64, studentId);
            if (duplicateCheck.isDuplicate) {
              setError(`This face photo matches an existing enrollment for student: ${duplicateCheck.matchedStudentId}. A student's face may only be enrolled once.`);
              // Revert: delete the student we just added if it's a new one
              if (!editingIndex) {
                await deleteStudent(studentId).catch(() => {});
              }
              await loadStudents();
              setLoading(false);
              return;
            }

            // No duplicate found, proceed with enrollment.
            // AWS Rekognition will detect the face in the photo and index it.
            // Only if a face is successfully detected AND indexed will enrolled be true.
            const enrollmentResult = await enrollFaceToRekognitionCollection({ imageBase64, studentId });
            const enrollmentSucceeded = enrollmentResult?.enrolled === true;
            
            // Update the student record with the face enrollment status
            await addStudent({ ...form, faceEnrolled: enrollmentSucceeded });
            
            if (enrollmentSucceeded) {
              setNotice(`Student saved. Face enrolled successfully for ${studentId}.`);
            } else {
              const enrollError = enrollmentResult?.message || 'AWS Rekognition could not detect a clear face in the photo.';
              setError(enrollError);
              setNotice(`Student saved but face enrollment failed. ${enrollError}`);
            }
          }
        } catch (faceError) {
          const message = faceError instanceof Error ? faceError.message : 'Face sync failed, but the student was still saved.';
          setNotice(`Student saved for ${studentId}, but face sync could not complete. AWS Rekognition may not be configured. You can try again from the Sync All Face Photos button.`);
          setError(message);
        }
      }

      if (!notice) {
        setNotice(`Student saved for ${studentId}.`);
      }

      await loadStudents();
      handleCancelEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : (editingIndex ? 'Failed to update student.' : 'Failed to add student.'));
    }
    setLoading(false);
  };

  const handleEdit = (student: any) => {
    setEditingIndex(student.index);
    setForm(student);
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setForm({ index: '', name: '', programme: '', level: '', photo: '' });
  };

  const handleDelete = async (index: string) => {
    setNotice('');
    if (window.confirm(`Are you sure you want to delete student ${index}?`)) {
      try {
        await deleteStudent(index);
        await loadStudents();
      } catch {
        setError('Failed to delete student.');
      }
    }
  };

  const handleBulkDelete = async () => {
    setNotice('');
    if (window.confirm(`Are you sure you want to delete ${selectedIndices.size} students?`)) {
      setLoading(true);
      try {
        for (const index of Array.from(selectedIndices)) {
          await deleteStudent(index);
        }
        await loadStudents();
        setSelectedIndices(new Set());
      } catch {
        setError('Failed to delete some students.');
      }
      setLoading(false);
    }
  };

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    const allIndices = filteredStudents.map(s => s.index);
    if (e.target.checked) {
      setSelectedIndices(new Set(allIndices));
      if (courseEnrollmentTab && enrollmentCourseCode) {
        setSelectedForEnrollment(new Set(allIndices));
      }
    } else {
      setSelectedIndices(new Set());
      if (courseEnrollmentTab && enrollmentCourseCode) {
        setSelectedForEnrollment(new Set());
      }
    }
  };

  const handleSelect = (index: string) => {
    const newSelected = new Set(selectedIndices);
    if (newSelected.has(index)) {
      newSelected.delete(index);
    } else {
      newSelected.add(index);
    }
    setSelectedIndices(newSelected);

    // Also track for course enrollment if the tab is open
    if (courseEnrollmentTab && enrollmentCourseCode) {
      const enrollSelected = new Set(selectedForEnrollment);
      if (enrollSelected.has(index)) {
        enrollSelected.delete(index);
      } else {
        enrollSelected.add(index);
      }
      setSelectedForEnrollment(enrollSelected);
    }
  };

  const filteredStudents = students.filter(student => 
    student.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.index.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Pagination logic
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentStudents = filteredStudents.slice(indexOfFirstItem, indexOfLastItem);

  const handleExport = async () => {
    const XLSX = await import('xlsx');
    const rows = students.map(s => ({
      'Index': s.index,
      'Name': s.name,
      'Programme': s.programme,
      'Level': s.level,
      'Fingerprint': s.fingerprintEnrolled ? 'Yes' : 'Pending',
      'Face Enrolled': s.faceEnrolled ? 'Yes' : 'No',
      'Has Photo': s.photo ? 'Yes' : 'No',
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Students');
    const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'students_export.xlsx';
    link.click();
  };

  const extractBase64Payload = (dataUrl: string) => {
    if (!dataUrl) {
      return null;
    }

    const parts = dataUrl.split(',');
    if (parts.length >= 2 && parts[1]) {
      return parts[1];
    }

    const normalized = dataUrl.trim();
    return normalized.length > 0 ? normalized : null;
  };

  const ensureCollectionReady = async () => {
    const status = await getRekognitionCollectionStatus();
    if (!status?.configured) {
      throw new Error(status?.message || 'AWS Rekognition is not configured on the backend.');
    }
    if (status?.exists) {
      return;
    }
    await initializeRekognitionCollection();
  };

  const handleSyncAllFaces = async () => {
    setError('');
    setNotice('');
    setSyncingAllFaces(true);

    const studentsWithPhotos = students.filter((student) => typeof student?.photo === 'string' && student.photo.length > 0);
    if (studentsWithPhotos.length === 0) {
      setSyncingAllFaces(false);
      setNotice('No students with profile photos found for face synchronization.');
      return;
    }

    let synced = 0;
    let skippedAsDuplicate = 0;
    let failed = 0;
    const failedIds: string[] = [];
    const duplicateIds: string[] = [];

    try {
      await ensureCollectionReady();
    } catch (err) {
      setSyncingAllFaces(false);
      setError(err instanceof Error ? err.message : 'Failed to initialize Rekognition collection.');
      setNotice('Bulk face sync was skipped because AWS Rekognition is not available on the backend.');
      return;
    }

    for (const student of studentsWithPhotos) {
      const studentId = typeof student?.index === 'string' ? student.index.trim() : '';
      const imageBase64 = extractBase64Payload(student.photo);

      if (!studentId || !imageBase64) {
        failed += 1;
        if (studentId) {
          failedIds.push(studentId);
        }
        continue;
      }

      try {
        // Check if this face already belongs to a different student
        const duplicateCheck = await checkDuplicateFaceEnrollment(imageBase64, studentId);
        if (duplicateCheck.isDuplicate) {
          skippedAsDuplicate += 1;
          duplicateIds.push(studentId);
          continue;
        }

        const enrollmentResult = await enrollFaceToRekognitionCollection({ imageBase64, studentId });
        // Only mark as faceEnrolled if enrollment actually succeeded (face detected and indexed)
        const enrollmentSucceeded = enrollmentResult?.enrolled === true;
        await addStudent({ ...student, faceEnrolled: enrollmentSucceeded });
        if (enrollmentSucceeded) {
          synced += 1;
        } else {
          failed += 1;
          failedIds.push(studentId);
        }
      } catch {
        failed += 1;
        failedIds.push(studentId);
      }
    }

    await loadStudents();
    const parts: string[] = [];
    if (synced > 0) parts.push(`${synced} synced`);
    if (skippedAsDuplicate > 0) parts.push(`${skippedAsDuplicate} skipped (duplicate face)`);
    if (failed > 0) parts.push(`${failed} failed`);
    setNotice(`Bulk face sync completed: ${parts.join(', ')}.`);

    if (failed > 0) {
      setError(`Face sync failed for: ${failedIds.slice(0, 10).join(', ')}${failedIds.length > 10 ? ' ...' : ''}`);
    }
    if (skippedAsDuplicate > 0) {
      console.warn(`Duplicate faces skipped for: ${duplicateIds.join(', ')}`);
    }
    setSyncingAllFaces(false);
  };

  // ── Course Enrollment Functions ──

  const loadEnrolledStudents = async (courseCode: string) => {
    if (!courseCode) { setEnrolledStudents([]); return; }
    setEnrollmentLoading(true);
    setEnrollmentError('');
    try {
      const data = await fetchCourseEnrollments(courseCode);
      setEnrolledStudents(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setEnrollmentError(err.message || 'Failed to load enrolled students');
      setEnrolledStudents([]);
    }
    setEnrollmentLoading(false);
  };

  const loadAvailableCourses = async () => {
    try {
      const courses = await fetchEnrolledCourses();
      setAvailableCourses(courses);
    } catch { /* ignore */ }
  };

  const handleEnrollStudents = async () => {
    if (!enrollmentCourseCode || selectedForEnrollment.size === 0) {
      setEnrollmentError('Select a course code and at least one student.');
      return;
    }
    setEnrollmentLoading(true);
    setEnrollmentError('');
    setEnrollmentMessage('');
    try {
      const result = await assignStudentsToCourse(enrollmentCourseCode, Array.from(selectedForEnrollment));
      setEnrollmentMessage(`Added ${result.added} student(s) to ${enrollmentCourseCode}.${result.skipped > 0 ? ` Skipped ${result.skipped} (already enrolled or not found).` : ''}`);
      setSelectedForEnrollment(new Set());
      await loadEnrolledStudents(enrollmentCourseCode);
      await loadAvailableCourses();
    } catch (err: any) {
      setEnrollmentError(err.message || 'Failed to enroll students');
    }
    setEnrollmentLoading(false);
  };

  const handleRemoveEnrolled = async (studentIds: string[]) => {
    if (!enrollmentCourseCode) return;
    setEnrollmentLoading(true);
    setEnrollmentError('');
    setEnrollmentMessage('');
    try {
      const result = await removeStudentsFromCourse(enrollmentCourseCode, studentIds);
      setEnrollmentMessage(`Removed ${result.removed} student(s) from ${enrollmentCourseCode}.`);
      await loadEnrolledStudents(enrollmentCourseCode);
      await loadAvailableCourses();
    } catch (err: any) {
      setEnrollmentError(err.message || 'Failed to remove students');
    }
    setEnrollmentLoading(false);
  };

  const handleBulkEnroll = async () => {
    if (!enrollmentCourseCode || !bulkEnrollInput.trim()) {
      setEnrollmentError('Enter a course code and student IDs.');
      return;
    }
    const ids = bulkEnrollInput
      .split(/[,\n\s]+/)
      .map(id => id.trim())
      .filter(id => id.length > 0);
    if (ids.length === 0) {
      setEnrollmentError('No valid student IDs found.');
      return;
    }
    setEnrollmentLoading(true);
    setEnrollmentError('');
    setEnrollmentMessage('');
    try {
      const result = await assignStudentsToCourse(enrollmentCourseCode, ids);
      setEnrollmentMessage(`Added ${result.added} student(s).${result.skipped > 0 ? ` Skipped ${result.skipped}.` : ''}`);
      setBulkEnrollInput('');
      await loadEnrolledStudents(enrollmentCourseCode);
      await loadAvailableCourses();
    } catch (err: any) {
      setEnrollmentError(err.message || 'Failed to enroll');
    }
    setEnrollmentLoading(false);
  };

  // ── Render ──

  return (
    <div className="page-enter" style={{ minHeight: 'calc(100vh - 68px)', width: '100%' }}>
      <div className="page-container">
        <div className="page-header">
          <div>
            <h1 className="page-title animate-fade-in-up">Student Management</h1>
            <p className="page-sub animate-fade-in-up delay-1">Add, edit, and view student information. Face sync now uses each student profile photo automatically.</p>
          </div>
        </div>

        <div className="card table-card animate-fade-in-up delay-2">
          <h3 style={{ marginTop: 0, color: 'var(--accent)', fontSize: '1.5rem', marginBottom: '1.5rem' }}>
            {editingIndex ? `Editing Student: ${editingIndex}` : 'Add New Student'}
          </h3>
          <form style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', alignItems: 'flex-end' }} onSubmit={handleSubmit}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="index" style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Index Number</label>
              <input id="index" name="index" type="text" placeholder="e.g., 1089..." value={form.index} onChange={handleChange} className="input" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="photo" style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Profile Photo</label>
              <input id="photo" name="photo" type="file" accept="image/*" onChange={handleImageChange} style={{ padding: '0.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.10)', background: 'transparent', color: 'var(--text)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="name" style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Full Name</label>
              <input id="name" name="name" type="text" placeholder="e.g., John Doe" value={form.name} onChange={handleChange} className="input" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="programme" style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Programme</label>
              <input id="programme" name="programme" type="text" placeholder="e.g., B.Sc. Computer Science" value={form.programme} onChange={handleChange} className="input" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <label htmlFor="level" style={{ marginBottom: '0.5rem', color: 'var(--text-secondary)' }}>Level</label>
              <input id="level" name="level" type="text" placeholder="e.g., 400" value={form.level} onChange={handleChange} className="input" />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="submit" disabled={loading} className="btn btn-primary" style={{ flex: 1 }}>
                {loading ? (editingIndex ? 'Updating...' : 'Adding...') : (editingIndex ? 'Update Student' : '+ Add Student')}
              </button>
              {editingIndex && (
                <button type="button" onClick={handleCancelEdit} className="btn btn-ghost">Cancel</button>
              )}
            </div>
          </form>
          {error && <div style={{ color: '#FCA5A5', marginTop: '1rem', background: '#7F1D1D', padding: '0.75rem', borderRadius: '12px' }}>{error}</div>}
          {notice && <div style={{ color: '#5EEAD4', marginTop: '1rem', background: '#134E4A', padding: '0.75rem', borderRadius: '12px' }}>{notice}</div>}
        </div>

        {/* ── Course Enrollment ── */}
        <div className="card table-card animate-fade-in-up delay-3" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, color: 'var(--accent)', fontSize: '1.3rem' }}>Course Enrollment</h3>
            <button onClick={() => { setCourseEnrollmentTab(!courseEnrollmentTab); if (!courseEnrollmentTab) loadAvailableCourses(); }} className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>
              {courseEnrollmentTab ? 'Hide' : 'Manage'}
            </button>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Assign students to courses. Only enrolled students appear in attendance reports for that course.
          </p>

          {courseEnrollmentTab && (
            <>
              {/* Course Code Selector */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Course Code</label>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <input
                      type="text"
                      value={enrollmentCourseCode}
                      onChange={e => { setEnrollmentCourseCode(e.target.value.toUpperCase()); setEnrolledStudents([]); }}
                      placeholder="e.g. CSC101"
                      className="input"
                      style={{ flex: 1 }}
                      list="course-list"
                    />
                    <datalist id="course-list">
                      {availableCourses.map(c => <option key={c} value={c} />)}
                    </datalist>
                    <button onClick={() => loadEnrolledStudents(enrollmentCourseCode)} disabled={!enrollmentCourseCode || enrollmentLoading} className="btn btn-secondary" style={{ whiteSpace: 'nowrap' }}>
                      {enrollmentLoading ? 'Loading...' : 'View Enrolled'}
                    </button>
                  </div>
                </div>
              </div>

              {enrollmentMessage && <div style={{ color: '#5EEAD4', background: '#134E4A', padding: '0.6rem 1rem', borderRadius: '10px', marginBottom: '1rem', fontSize: '0.85rem' }}>{enrollmentMessage}</div>}
              {enrollmentError && <div style={{ color: '#FCA5A5', background: '#7F1D1D', padding: '0.6rem 1rem', borderRadius: '10px', marginBottom: '1rem', fontSize: '0.85rem' }}>{enrollmentError}</div>}

              {/* Bulk Enroll */}
              <div style={{ marginBottom: '1.25rem', padding: '1rem', background: 'rgba(255,255,255,0.03)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Bulk Enroll — Paste student IDs (comma or newline separated)</label>
                <textarea
                  value={bulkEnrollInput}
                  onChange={e => setBulkEnrollInput(e.target.value)}
                  placeholder="e.g. 10891234, 10895678, 10899876..."
                  className="input"
                  rows={3}
                  style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '0.85rem' }}
                />
                <button onClick={handleBulkEnroll} disabled={enrollmentLoading || !enrollmentCourseCode} className="btn btn-primary" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
                  {enrollmentLoading ? 'Enrolling...' : 'Bulk Enroll'}
                </button>
              </div>

              {/* Enrolled Students List */}
              {enrollmentCourseCode && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0, color: 'var(--text)', fontSize: '1rem' }}>
                      Enrolled in {enrollmentCourseCode}: <span style={{ color: 'var(--accent)' }}>{enrolledStudents.length}</span> student(s)
                    </h4>
                    {enrolledStudents.length > 0 && (
                      <button onClick={() => handleRemoveEnrolled(enrolledStudents.map((s: any) => s.index_no))} className="btn-outline-action btn-outline-action--danger" style={{ fontSize: '0.8rem' }}>
                        Remove All
                      </button>
                    )}
                  </div>

                  {enrolledStudents.length > 0 ? (
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left', fontSize: '0.85rem' }}>Index</th>
                            <th style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left', fontSize: '0.85rem' }}>Name</th>
                            <th style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left', fontSize: '0.85rem' }}>Programme</th>
                            <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right', fontSize: '0.85rem' }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {enrolledStudents.map((s: any) => (
                            <tr key={s.index_no} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text)', fontSize: '0.85rem' }}>{s.index_no}</td>
                              <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text)', fontSize: '0.85rem' }}>{s.name}</td>
                              <td style={{ padding: '0.5rem 0.75rem', color: 'var(--muted)', fontSize: '0.85rem' }}>{s.programme || '-'}</td>
                              <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>
                                <button onClick={() => handleRemoveEnrolled([s.index_no])} className="btn-outline-action btn-outline-action--danger" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }}>Remove</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', color: 'var(--muted)', padding: '1.5rem', fontSize: '0.85rem' }}>
                      No students enrolled in {enrollmentCourseCode}. Select students below and click "Enroll Selected".
                    </div>
                  )}
                </>
              )}

              {/* Enroll from Student List */}
              {enrollmentCourseCode && (
                <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(255,182,6,0.04)', borderRadius: '12px', border: '1px solid rgba(255,182,6,0.1)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <label style={{ fontWeight: 600, color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      Select students below to enroll in {enrollmentCourseCode}
                    </label>
                    {selectedForEnrollment.size > 0 && (
                      <button onClick={handleEnrollStudents} disabled={enrollmentLoading} className="btn btn-gold" style={{ fontSize: '0.85rem' }}>
                        Enroll Selected ({selectedForEnrollment.size})
                      </button>
                    )}
                  </div>
                  <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
                    Check the boxes next to students in the table below to select them for enrollment.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="card table-card animate-fade-in-up delay-3" style={{ marginTop: '2rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--accent)', fontSize: '1.5rem', marginBottom: '1.5rem' }}>Registered Students</h3>
          
          <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input 
              type="text" 
              placeholder="Search by name or index number..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="input"
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleSyncAllFaces} disabled={syncingAllFaces}>{syncingAllFaces ? 'Syncing Faces...' : 'Sync All Face Photos'}</button>
            {selectedIndices.size > 0 && (
              <button className="btn btn-ghost" onClick={handleBulkDelete}>Delete Selected ({selectedIndices.size})</button>
            )}
            <button className="btn btn-ghost" onClick={handleExport}>Export Excel</button>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '0.75rem 1rem', width: '40px' }}>
                  <input type="checkbox" onChange={handleSelectAll} checked={filteredStudents.length > 0 && selectedIndices.size === filteredStudents.length} />
                </th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left', width: '60px' }}>Photo</th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left' }}>Index</th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left' }}>Name</th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left' }}>Programme</th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left' }}>Level</th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left' }}>Fingerprint</th>
                <th style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left' }}>Face Recognition</th>
              <th style={{ padding: '0.75rem 1rem', color: 'var(--muted)', fontWeight: 600, textAlign: 'left' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {currentStudents.map((s, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <input type="checkbox" checked={selectedIndices.has(s.index)} onChange={() => handleSelect(s.index)} />
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    {s.photo ? (
                      <img src={s.photo} alt="Profile" style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #FFB606', boxShadow: '0 2px 8px rgba(0,0,0,0.3)' }} />
                    ) : (
                      <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: '0.75rem' }}>N/A</div>
                    )}
                  </td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{s.index}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{s.name}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{s.programme}</td>
                  <td style={{ padding: '0.75rem 1rem', color: 'var(--text-secondary)' }}>{s.level}</td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '9999px',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      backgroundColor: s.fingerprintEnrolled ? '#134E4A' : 'rgba(255,255,255,0.05)',
                      color: s.fingerprintEnrolled ? '#5EEAD4' : 'var(--muted)'
                    }}>
                      {s.fingerprintEnrolled ? 'Yes' : 'Pending'}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem' }}>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '9999px',
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      backgroundColor: s.faceEnrolled ? '#134E4A' : '#78350F',
                      color: s.faceEnrolled ? '#5EEAD4' : '#FCD34D'
                    }}>
                      {s.faceEnrolled ? 'Enrolled' : 'Pending'}
                    </span>
                  </td>
                  <td style={{ padding: '0.75rem 1rem', display: 'flex', gap: '0.5rem' }}>
                    <button 
                      onClick={() => setViewStudent(s)}
                      className="btn-outline-action btn-outline-action--info"
                    >
                      View
                    </button>
                    <button 
                      onClick={() => handleEdit(s)}
                      className="btn-outline-action btn-outline-action--info"
                    >
                      Edit
                    </button>
                    <button 
                      onClick={() => handleDelete(s.index)}
                      className="btn-outline-action btn-outline-action--danger"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Controls */}
          {filteredStudents.length > itemsPerPage && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button 
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                style={{ padding: '0.5rem 1rem', border: '1px solid var(--border)', borderRadius: '6px', background: currentPage === 1 ? 'rgba(255,255,255,0.03)' : 'transparent', cursor: currentPage === 1 ? 'not-allowed' : 'pointer', color: 'var(--muted)' }}
              >Previous</button>
              <span style={{ padding: '0.5rem 1rem', fontWeight: 600, color: 'var(--accent)' }}>Page {currentPage}</span>
              <button 
                onClick={() => setCurrentPage(prev => (indexOfLastItem < filteredStudents.length ? prev + 1 : prev))}
                disabled={indexOfLastItem >= filteredStudents.length}
                style={{ padding: '0.5rem 1rem', border: '1px solid var(--border)', borderRadius: '6px', background: indexOfLastItem >= filteredStudents.length ? 'rgba(255,255,255,0.03)' : 'transparent', cursor: indexOfLastItem >= filteredStudents.length ? 'not-allowed' : 'pointer', color: 'var(--muted)' }}
              >Next</button>
            </div>
          )}
        </div>

        {/* View Details Modal */}
        {viewStudent && (
          <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
          }} onClick={() => setViewStudent(null)}>
            <div className="modal-content card-accent-hover" style={{
              backgroundColor: 'var(--card)', padding: '2rem', borderRadius: '16px', maxWidth: '500px', width: '90%',
              border: '1px solid var(--border)',
              position: 'relative'
            }} onClick={e => e.stopPropagation()}>
              <button onClick={() => setViewStudent(null)} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--muted)' }}>&times;</button>
              
              <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                {viewStudent.photo ? (
                  <img src={viewStudent.photo} alt={viewStudent.name} style={{ width: '120px', height: '120px', borderRadius: '50%', objectFit: 'cover', border: '4px solid #FFB606' }} />
                ) : (
                  <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: 'rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', fontSize: '3rem', color: 'var(--muted)' }}>?</div>
                )}
                <h2 style={{ margin: '1rem 0 0.5rem', color: 'var(--accent)' }}>{viewStudent.name}</h2>
                <p style={{ margin: 0, color: 'var(--muted)', fontWeight: 500 }}>{viewStudent.index}</p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(255,255,255,0.04)', padding: '1.5rem', borderRadius: '12px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>Programme</label>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{viewStudent.programme}</div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>Level</label>
                  <div style={{ fontWeight: 600, color: 'var(--text)' }}>{viewStudent.level}</div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>Fingerprint</label>
                  <div style={{ fontWeight: 600, color: viewStudent.fingerprintEnrolled ? '#5EEAD4' : '#FCD34D' }}>
                    {viewStudent.fingerprintEnrolled ? 'Yes' : 'Pending'}
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.875rem', color: 'var(--muted)', marginBottom: '0.25rem' }}>Face Recognition</label>
                  <div style={{ fontWeight: 600, color: viewStudent.faceEnrolled ? '#5EEAD4' : '#FCD34D' }}>
                    {viewStudent.faceEnrolled ? 'Enrolled' : 'Not Enrolled'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentManagementPage;