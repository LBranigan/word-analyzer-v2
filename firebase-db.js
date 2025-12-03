// Firebase Firestore Database Handler
import { db, collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc, query } from './firebase-config.js';
import { getCurrentUser } from './firebase-auth.js';
import { debugLog, debugError } from './utils.js';

// ============ FIRESTORE DATABASE FUNCTIONS ============

// Get user's students collection reference
function getUserStudentsCollection() {
    const user = getCurrentUser();
    if (!user) {
        throw new Error('User not authenticated');
    }
    return collection(db, 'users', user.uid, 'students');
}

// Get all students from Firestore
export async function getAllStudents() {
    try {
        const studentsCollection = getUserStudentsCollection();
        const querySnapshot = await getDocs(studentsCollection);

        const students = {};
        querySnapshot.forEach((doc) => {
            students[doc.id] = doc.data();
        });

        return students;
    } catch (error) {
        debugError('Error getting students:', error);
        throw error;
    }
}

// Save all students to Firestore (batch operation)
export async function saveAllStudents(students) {
    try {
        const user = getCurrentUser();
        if (!user) throw new Error('User not authenticated');

        const promises = Object.entries(students).map(([studentId, studentData]) => {
            const studentRef = doc(db, 'users', user.uid, 'students', studentId);
            return setDoc(studentRef, studentData, { merge: true });
        });

        await Promise.all(promises);
        debugLog('All students saved successfully');
    } catch (error) {
        debugError('Error saving students:', error);
        throw error;
    }
}

// Add new student
export async function addStudent(name, grade = '') {
    try {
        const user = getCurrentUser();
        if (!user) throw new Error('User not authenticated');

        const studentId = 'student-' + Date.now();
        const studentRef = doc(db, 'users', user.uid, 'students', studentId);

        const studentData = {
            id: studentId,
            name: name,
            grade: grade,
            dateAdded: Date.now(),
            assessments: []
        };

        await setDoc(studentRef, studentData);
        debugLog('Student added:', name);
        return studentId;
    } catch (error) {
        debugError('Error adding student:', error);
        throw error;
    }
}

// Get student by ID
export async function getStudent(studentId) {
    try {
        const user = getCurrentUser();
        if (!user) throw new Error('User not authenticated');

        const studentRef = doc(db, 'users', user.uid, 'students', studentId);
        const studentDoc = await getDoc(studentRef);

        if (studentDoc.exists()) {
            return studentDoc.data();
        }
        return null;
    } catch (error) {
        debugError('Error getting student:', error);
        throw error;
    }
}

// Update student
export async function updateStudent(studentId, updates) {
    try {
        const user = getCurrentUser();
        if (!user) throw new Error('User not authenticated');

        const studentRef = doc(db, 'users', user.uid, 'students', studentId);
        await updateDoc(studentRef, updates);
        debugLog('Student updated:', studentId);
        return true;
    } catch (error) {
        debugError('Error updating student:', error);
        return false;
    }
}

// Delete student
export async function deleteStudent(studentId) {
    try {
        const user = getCurrentUser();
        if (!user) throw new Error('User not authenticated');

        const studentRef = doc(db, 'users', user.uid, 'students', studentId);
        await deleteDoc(studentRef);
        debugLog('Student deleted:', studentId);
        return true;
    } catch (error) {
        debugError('Error deleting student:', error);
        return false;
    }
}

// Add assessment to student
export async function addAssessmentToStudent(studentId, assessmentData) {
    try {
        const student = await getStudent(studentId);
        if (!student) {
            debugError('Student not found:', studentId);
            return false;
        }

        if (!student.assessments) {
            student.assessments = [];
        }

        const assessment = {
            id: 'assessment-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            date: Date.now(),
            ...assessmentData
        };

        student.assessments.push(assessment);

        const user = getCurrentUser();
        const studentRef = doc(db, 'users', user.uid, 'students', studentId);
        await setDoc(studentRef, student);

        debugLog('Assessment added to student:', studentId);
        return true;
    } catch (error) {
        debugError('Error adding assessment:', error);
        return false;
    }
}

// Delete assessment from student
export async function deleteAssessment(studentId, assessmentId) {
    try {
        const student = await getStudent(studentId);
        if (!student) {
            return false;
        }

        student.assessments = student.assessments.filter(a => a.id !== assessmentId);

        const user = getCurrentUser();
        const studentRef = doc(db, 'users', user.uid, 'students', studentId);
        await setDoc(studentRef, student);

        debugLog('Assessment deleted:', assessmentId);
        return true;
    } catch (error) {
        debugError('Error deleting assessment:', error);
        return false;
    }
}

// Get student statistics
export function getStudentStats(student) {
    if (!student || !student.assessments || student.assessments.length === 0) {
        return {
            totalAssessments: 0,
            avgAccuracy: 0,
            avgWpm: 0,
            avgProsody: 0,
            latestAccuracy: 0,
            trend: 'neutral'
        };
    }

    const assessments = student.assessments;
    const total = assessments.length;

    const avgAccuracy = assessments.reduce((sum, a) => sum + (a.accuracy || 0), 0) / total;
    const avgWpm = assessments.reduce((sum, a) => sum + (a.wpm || 0), 0) / total;
    const avgProsody = assessments.reduce((sum, a) => sum + (a.prosodyScore || 0), 0) / total;

    const latestAccuracy = assessments[assessments.length - 1].accuracy;
    const trend = latestAccuracy > avgAccuracy + 2 ? 'improving' :
                  latestAccuracy < avgAccuracy - 2 ? 'declining' : 'stable';

    return {
        totalAssessments: total,
        avgAccuracy: avgAccuracy.toFixed(1),
        avgWpm: Math.round(avgWpm),
        avgProsody: avgProsody.toFixed(1),
        latestAccuracy: latestAccuracy.toFixed(1),
        trend: trend
    };
}

// ============ MIGRATION FUNCTION ============

export async function migrateLocalStorageToFirestore(userId) {
    try {
        debugLog('Checking for localStorage data to migrate...');

        const localData = localStorage.getItem('wordAnalyzerStudents');
        if (!localData) {
            debugLog('No localStorage data to migrate');
            return;
        }

        const firestoreStudents = await getAllStudents();
        if (Object.keys(firestoreStudents).length > 0) {
            debugLog('User already has Firestore data, skipping migration');
            return;
        }

        const students = JSON.parse(localData);

        debugLog('Migrating', Object.keys(students).length, 'students to Firestore...');
        await saveAllStudents(students);

        debugLog('Migration completed successfully!');

    } catch (error) {
        debugError('Error during migration:', error);
        alert('Warning: Failed to migrate your local data to the cloud. Your local data is still safe.');
    }
}

// ============ CREATE SAMPLE STUDENTS ============

export function createSampleStudents() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    return {
        'student-001': {
            id: 'student-001',
            name: 'Susan',
            grade: '3rd Grade',
            dateAdded: now - (30 * dayMs),
            assessments: [
                createSampleAssessment(now - (7 * dayMs), 95, 100, 95, 120, 4.2),
                createSampleAssessment(now - (5 * dayMs), 92, 98, 93.9, 115, 4.0),
                createSampleAssessment(now - (2 * dayMs), 97, 100, 97, 125, 4.4)
            ]
        },
        'student-002': {
            id: 'student-002',
            name: 'Jose',
            grade: '3rd Grade',
            dateAdded: now - (30 * dayMs),
            assessments: [
                createSampleAssessment(now - (8 * dayMs), 78, 95, 82.1, 95, 3.2),
                createSampleAssessment(now - (6 * dayMs), 82, 95, 86.3, 100, 3.4),
                createSampleAssessment(now - (3 * dayMs), 85, 98, 86.7, 105, 3.6),
                createSampleAssessment(now - (1 * dayMs), 88, 100, 88, 108, 3.7)
            ]
        },
        'student-003': {
            id: 'student-003',
            name: 'Timmy',
            grade: '2nd Grade',
            dateAdded: now - (25 * dayMs),
            assessments: [
                createSampleAssessment(now - (4 * dayMs), 65, 85, 76.5, 80, 2.8),
                createSampleAssessment(now - (1 * dayMs), 70, 90, 77.8, 85, 3.0)
            ]
        }
    };
}

function createSampleAssessment(date, correct, total, accuracy, wpm, prosody) {
    const errors = total - correct;
    return {
        id: 'assessment-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        date: date,
        correctCount: correct,
        totalWords: total,
        accuracy: accuracy,
        wpm: wpm,
        prosodyScore: prosody,
        errors: {
            skippedWords: Array(Math.floor(errors * 0.4)).fill(0),
            misreadWords: Array(Math.floor(errors * 0.3)).fill({}),
            substitutedWords: Array(Math.floor(errors * 0.3)).fill({})
        },
        duration: 60
    };
}

// Initialize sample students for new users
export async function initializeSampleStudents() {
    try {
        const students = await getAllStudents();
        if (Object.keys(students).length === 0) {
            debugLog('No students found, creating sample students...');
            const sampleStudents = createSampleStudents();
            await saveAllStudents(sampleStudents);
            debugLog('Sample students created');
        }
    } catch (error) {
        debugError('Error initializing sample students:', error);
    }
}
