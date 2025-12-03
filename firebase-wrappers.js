// Firebase Async-to-Sync Wrappers for Word Analyzer V2
// This file provides wrapper functions that make async Firebase calls work with the synchronous UI code

import * as FirebaseDB from './firebase-db.js';
import { escapeHtml, ACCURACY_THRESHOLDS, getCardAccuracyClass } from './utils.js';

// Make async database functions globally available with promise handlers
window.renderStudentsGridAsync = async function() {
    const students = await FirebaseDB.getAllStudents();
    const studentArray = Object.values(students);

    const studentsGrid = document.getElementById('students-grid');
    if (!studentsGrid) return;

    if (studentArray.length === 0) {
        studentsGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                </div>
                <h3>No Students Yet</h3>
                <p>Add your first student to start tracking their reading progress.</p>
            </div>
        `;
        return;
    }

    studentsGrid.innerHTML = studentArray.map(student => {
        const stats = FirebaseDB.getStudentStats(student);
        const safeName = escapeHtml(student.name);
        const safeGrade = escapeHtml(student.grade || 'No grade set');
        const safeId = escapeHtml(student.id);
        const initial = safeName.charAt(0).toUpperCase();

        return `
            <div class="student-card" data-student-id="${safeId}">
                <div class="student-card-header">
                    <div class="student-avatar">${initial}</div>
                    <div class="student-info">
                        <h3>${safeName}</h3>
                        <p class="student-grade">${safeGrade}</p>
                    </div>
                </div>
                <div class="student-stats">
                    <div class="stat-item">
                        <div class="stat-item-label">Assessments</div>
                        <div class="stat-item-value">${stats.totalAssessments}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-item-label">Avg Accuracy</div>
                        <div class="stat-item-value">${stats.avgAccuracy}%</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-item-label">Avg WPM</div>
                        <div class="stat-item-value">${stats.avgWpm}</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-item-label">Prosody</div>
                        <div class="stat-item-value">${stats.avgProsody}</div>
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Add click handlers
    document.querySelectorAll('.student-card').forEach(card => {
        card.addEventListener('click', () => {
            const studentId = card.getAttribute('data-student-id');
            if (window.showStudentProfileAsync) {
                window.showStudentProfileAsync(studentId);
            }
        });
    });
};

window.updateStudentDropdownAsync = async function() {
    const studentSelect = document.getElementById('student-select');
    if (!studentSelect) return;

    const students = await FirebaseDB.getAllStudents();
    const studentArray = Object.values(students).sort((a, b) => a.name.localeCompare(b.name));

    studentSelect.innerHTML = '<option value="">Choose student...</option>' +
        studentArray.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.grade || 'No grade')})</option>`).join('');
};

window.updateAssessmentStudentDropdownAsync = async function() {
    const assessmentStudentSelect = document.getElementById('assessment-student-select');
    if (!assessmentStudentSelect) return;

    const students = await FirebaseDB.getAllStudents();
    const studentArray = Object.values(students).sort((a, b) => a.name.localeCompare(b.name));

    assessmentStudentSelect.innerHTML = '<option value="">Choose a student...</option>' +
        studentArray.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)} (${escapeHtml(s.grade || 'No grade')})</option>`).join('');
};

// Export Firebase functions for global use
window.FirebaseDB = FirebaseDB;
