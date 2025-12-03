/**
 * Word Analyzer V2 - Main Application
 * A reading assessment tool with overhauled UI
 */

import { showAppReady, updateLoadingStatus, getCurrentUser } from './firebase-auth.js';
import { loadApiKeyFromFirebase, saveApiKeyToFirebase, validateApiKey, trackApiUsage } from './firebase-api-key-manager.js';
import * as FirebaseDB from './firebase-db.js';
import { escapeHtml, debugLog, debugError, getAccuracyClassification } from './utils.js';

// ============ GLOBAL STATE ============
let apiKey = null;
let currentStep = 'setup';
let selectedWords = [];
let detectedWords = [];
let audioBlob = null;
let capturedImage = null;
let mediaStream = null;
let mediaRecorder = null;
let recordingStartTime = null;
let recordingDuration = 60; // seconds
let currentStudentId = null;

// ============ DOM ELEMENTS ============
const setupSection = document.getElementById('setup-section');
const audioSection = document.getElementById('audio-section');
const cameraSection = document.getElementById('camera-section');
const imageSection = document.getElementById('image-section');
const resultsSection = document.getElementById('results-section');
const classOverviewSection = document.getElementById('class-overview-section');
const studentProfileSection = document.getElementById('student-profile-section');

// Progress elements
const spineFill = document.getElementById('spine-fill');
const progressSteps = document.querySelectorAll('.progress-step');

// ============ INITIALIZATION ============
window.addEventListener('userAuthenticated', async (event) => {
    debugLog('User authenticated, initializing app...');

    // Load API key
    apiKey = await loadApiKeyFromFirebase();

    // Update dropdowns
    await window.updateAssessmentStudentDropdownAsync();
    await window.updateStudentDropdownAsync();

    // Determine starting section
    if (apiKey) {
        showSection('audio');
        updateProgress('audio');
    } else {
        showSection('setup');
        updateProgress('setup');
    }

    showAppReady();
});

// ============ SECTION NAVIGATION ============
function showSection(sectionName) {
    // Hide all sections
    const allSections = document.querySelectorAll('.page-section');
    allSections.forEach(s => s.classList.remove('active'));

    // Show target section
    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
        targetSection.classList.add('active');
        currentStep = sectionName;
    }

    // Update progress if it's a workflow step
    if (['setup', 'audio', 'camera', 'image', 'results'].includes(sectionName)) {
        updateProgress(sectionName);
    }
}

function updateProgress(step) {
    const stepOrder = ['setup', 'audio', 'capture', 'highlight', 'results'];
    const stepMapping = {
        'setup': 'setup',
        'audio': 'audio',
        'camera': 'capture',
        'image': 'highlight',
        'results': 'results'
    };

    const currentIndex = stepOrder.indexOf(stepMapping[step] || step);

    // Update spine fill
    const fillPercent = ((currentIndex + 1) / stepOrder.length) * 100;
    if (spineFill) {
        spineFill.style.height = `${fillPercent}%`;
    }

    // Update step markers
    progressSteps.forEach((stepEl, index) => {
        const stepName = stepEl.getAttribute('data-step');
        const stepIndex = stepOrder.indexOf(stepName);

        stepEl.classList.remove('completed', 'current');

        if (stepIndex < currentIndex) {
            stepEl.classList.add('completed');
        } else if (stepIndex === currentIndex) {
            stepEl.classList.add('current');
        }
    });
}

// ============ API KEY SETUP ============
const apiKeyInput = document.getElementById('api-key');
const saveApiKeyBtn = document.getElementById('save-api-key-btn');
const toggleKeyVisibility = document.getElementById('toggle-key-visibility');

if (saveApiKeyBtn) {
    saveApiKeyBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (!key) {
            alert('Please enter an API key');
            return;
        }

        saveApiKeyBtn.disabled = true;
        saveApiKeyBtn.innerHTML = '<span>Validating...</span>';

        const result = await validateApiKey(key);

        if (result.valid) {
            await saveApiKeyToFirebase(key);
            apiKey = key;
            showSection('audio');
            updateProgress('audio');
        } else {
            alert(`Invalid API key: ${result.error}`);
        }

        saveApiKeyBtn.disabled = false;
        saveApiKeyBtn.innerHTML = `
            <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
            Validate & Save
        `;
    });
}

if (toggleKeyVisibility) {
    toggleKeyVisibility.addEventListener('click', () => {
        apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
    });
}

// Handle API settings from menu
window.addEventListener('openApiSettings', () => {
    showSection('setup');
});

// ============ AUDIO RECORDING ============
const recordBtn = document.getElementById('record-audio-btn');
const audioModal = document.getElementById('audio-modal');
const startRecordingBtn = document.getElementById('start-recording-btn');
const cancelRecordingBtn = document.getElementById('cancel-recording-btn');
const stopRecordingBtn = document.getElementById('stop-recording-btn');
const recordingVisual = document.getElementById('recording-visual');
const recordingActive = document.getElementById('recording-active');
const audioPlayback = document.getElementById('audio-playback');
const audioPlayer = document.getElementById('audio-player-main');
const rerecordBtn = document.getElementById('rerecord-audio-btn');
const downloadAudioBtn = document.getElementById('download-audio-btn');
const skipAudioBtn = document.getElementById('skip-audio-btn');
const nextToCaptureBtn = document.getElementById('next-to-capture-btn');
const recordingTimer = document.getElementById('recording-timer');
const timerBar = document.getElementById('timer-bar');

if (recordBtn) {
    recordBtn.addEventListener('click', () => {
        audioModal.classList.add('active');
    });
}

if (cancelRecordingBtn) {
    cancelRecordingBtn.addEventListener('click', () => {
        audioModal.classList.remove('active');
    });
}

if (startRecordingBtn) {
    startRecordingBtn.addEventListener('click', async () => {
        audioModal.classList.remove('active');

        const durationSelect = document.getElementById('audio-duration');
        recordingDuration = parseFloat(durationSelect.value) * 60;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStream = stream;

            mediaRecorder = new MediaRecorder(stream);
            const chunks = [];

            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

            mediaRecorder.onstop = () => {
                audioBlob = new Blob(chunks, { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(audioBlob);
                audioPlayer.src = audioUrl;

                recordingVisual.style.display = 'none';
                recordingActive.style.display = 'none';
                audioPlayback.style.display = 'block';
                nextToCaptureBtn.disabled = false;

                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            recordingStartTime = Date.now();

            recordingVisual.style.display = 'none';
            recordingActive.style.display = 'block';
            recordingVisual.classList.add('recording');

            updateRecordingTimer();

        } catch (error) {
            debugError('Error accessing microphone:', error);
            alert('Could not access microphone. Please check permissions.');
        }
    });
}

function updateRecordingTimer() {
    if (!recordingStartTime || !mediaRecorder || mediaRecorder.state !== 'recording') return;

    const elapsed = (Date.now() - recordingStartTime) / 1000;
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);

    recordingTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    timerBar.style.width = `${(elapsed / recordingDuration) * 100}%`;

    if (elapsed >= recordingDuration) {
        stopRecording();
    } else {
        requestAnimationFrame(updateRecordingTimer);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        recordingVisual.classList.remove('recording');
    }
}

if (stopRecordingBtn) {
    stopRecordingBtn.addEventListener('click', stopRecording);
}

if (rerecordBtn) {
    rerecordBtn.addEventListener('click', () => {
        audioBlob = null;
        audioPlayback.style.display = 'none';
        recordingVisual.style.display = 'block';
        nextToCaptureBtn.disabled = true;
    });
}

if (downloadAudioBtn) {
    downloadAudioBtn.addEventListener('click', () => {
        if (audioBlob) {
            const url = URL.createObjectURL(audioBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `recording-${Date.now()}.webm`;
            a.click();
        }
    });
}

if (skipAudioBtn) {
    skipAudioBtn.addEventListener('click', () => {
        audioBlob = null;
        showSection('camera');
    });
}

if (nextToCaptureBtn) {
    nextToCaptureBtn.addEventListener('click', () => {
        showSection('camera');
    });
}

// ============ CAMERA/CAPTURE ============
const camera = document.getElementById('camera');
const cameraCanvas = document.getElementById('camera-canvas');
const captureBtn = document.getElementById('capture-btn');
const uploadBtn = document.getElementById('upload-btn-camera');
const fileInputCamera = document.getElementById('file-input-camera');
const backToAudioBtn = document.getElementById('back-to-audio-btn');
const nextToHighlightBtn = document.getElementById('next-to-highlight-btn');

async function initCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        camera.srcObject = stream;
        mediaStream = stream;
    } catch (error) {
        debugError('Error accessing camera:', error);
    }
}

// Initialize camera when entering camera section
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.target.classList.contains('active') && mutation.target.id === 'camera-section') {
            initCamera();
        }
    });
});

if (cameraSection) {
    observer.observe(cameraSection, { attributes: true, attributeFilter: ['class'] });
}

if (captureBtn) {
    captureBtn.addEventListener('click', () => {
        const ctx = cameraCanvas.getContext('2d');
        cameraCanvas.width = camera.videoWidth;
        cameraCanvas.height = camera.videoHeight;
        ctx.drawImage(camera, 0, 0);

        capturedImage = cameraCanvas.toDataURL('image/jpeg', 1.0);
        nextToHighlightBtn.disabled = false;

        // Stop camera
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
        }
    });
}

if (uploadBtn) {
    uploadBtn.addEventListener('click', () => fileInputCamera.click());
}

if (fileInputCamera) {
    fileInputCamera.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                capturedImage = event.target.result;
                nextToHighlightBtn.disabled = false;
            };
            reader.readAsDataURL(file);
        }
    });
}

if (backToAudioBtn) {
    backToAudioBtn.addEventListener('click', () => showSection('audio'));
}

if (nextToHighlightBtn) {
    nextToHighlightBtn.addEventListener('click', () => {
        showSection('image');
        processImage();
    });
}

// ============ IMAGE PROCESSING & HIGHLIGHTING ============
const selectionCanvas = document.getElementById('selection-canvas');
const backToCaptureBtn = document.getElementById('back-to-capture-btn');
const analyzeBtn = document.getElementById('analyze-audio-btn');
const resetSelectionBtn = document.getElementById('reset-selection-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomResetBtn = document.getElementById('zoom-reset-btn');

let canvasImage = null;
let canvasScale = 1;
let canvasPan = { x: 0, y: 0 };

async function processImage() {
    if (!capturedImage || !apiKey) return;

    const loadingOverlay = document.getElementById('highlight-loading-overlay');
    loadingOverlay.style.display = 'flex';

    try {
        // Load image
        canvasImage = new Image();
        canvasImage.onload = async () => {
            const ctx = selectionCanvas.getContext('2d');
            selectionCanvas.width = canvasImage.width;
            selectionCanvas.height = canvasImage.height;
            ctx.drawImage(canvasImage, 0, 0);

            // Call Vision API
            const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    requests: [{
                        image: { content: capturedImage.split(',')[1] },
                        features: [{ type: 'TEXT_DETECTION' }]
                    }]
                })
            });

            const data = await response.json();
            await trackApiUsage('vision');

            if (data.responses && data.responses[0] && data.responses[0].textAnnotations) {
                detectedWords = data.responses[0].textAnnotations.slice(1).map((annotation, index) => ({
                    id: index,
                    text: annotation.description,
                    bounds: annotation.boundingPoly.vertices,
                    selected: false
                }));

                renderCanvas();
            }

            loadingOverlay.style.display = 'none';
            analyzeBtn.disabled = false;
        };
        canvasImage.src = capturedImage;

    } catch (error) {
        debugError('Error processing image:', error);
        loadingOverlay.style.display = 'none';
        alert('Error processing image. Please try again.');
    }
}

function renderCanvas() {
    if (!canvasImage) return;

    const ctx = selectionCanvas.getContext('2d');
    ctx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
    ctx.drawImage(canvasImage, 0, 0);

    // Draw word boxes
    detectedWords.forEach(word => {
        const bounds = word.bounds;
        if (!bounds || bounds.length < 4) return;

        ctx.beginPath();
        ctx.moveTo(bounds[0].x, bounds[0].y);
        bounds.forEach(point => ctx.lineTo(point.x, point.y));
        ctx.closePath();

        if (word.selected) {
            ctx.fillStyle = 'rgba(255, 215, 0, 0.4)';
            ctx.fill();
            ctx.strokeStyle = '#ffc107';
            ctx.lineWidth = 2;
        } else {
            ctx.fillStyle = 'rgba(26, 83, 92, 0.1)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(26, 83, 92, 0.3)';
            ctx.lineWidth = 1;
        }
        ctx.stroke();
    });
}

// Canvas click handling
if (selectionCanvas) {
    selectionCanvas.addEventListener('click', (e) => {
        const rect = selectionCanvas.getBoundingClientRect();
        const scaleX = selectionCanvas.width / rect.width;
        const scaleY = selectionCanvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        // Find clicked word
        for (const word of detectedWords) {
            if (isPointInPolygon(x, y, word.bounds)) {
                word.selected = !word.selected;
                renderCanvas();
                updateWordCount();
                break;
            }
        }
    });
}

function isPointInPolygon(x, y, vertices) {
    if (!vertices || vertices.length < 3) return false;

    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].x, yi = vertices[i].y;
        const xj = vertices[j].x, yj = vertices[j].y;

        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

function updateWordCount() {
    selectedWords = detectedWords.filter(w => w.selected);
    document.getElementById('word-count').textContent = selectedWords.length;
}

if (resetSelectionBtn) {
    resetSelectionBtn.addEventListener('click', () => {
        detectedWords.forEach(w => w.selected = false);
        renderCanvas();
        updateWordCount();
    });
}

if (backToCaptureBtn) {
    backToCaptureBtn.addEventListener('click', () => showSection('camera'));
}

// ============ ANALYSIS & RESULTS ============
if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
        if (selectedWords.length === 0) {
            alert('Please select some words first');
            return;
        }

        // Show results
        showSection('results');
        displayResults();
    });
}

function displayResults() {
    const resultsContainer = document.getElementById('results-container');
    const selectedTexts = selectedWords.map(w => w.text);

    resultsContainer.innerHTML = `
        <div class="results-card">
            <h3>Word Count Results</h3>
            <div class="results-stats">
                <div class="result-stat">
                    <span class="stat-value">${selectedWords.length}</span>
                    <span class="stat-label">Words Selected</span>
                </div>
            </div>
            <div class="words-display">
                <h4>Selected Words</h4>
                <div class="word-chips">
                    ${selectedTexts.map(w => `<span class="word-chip">${escapeHtml(w)}</span>`).join('')}
                </div>
            </div>
        </div>
    `;

    // Update student dropdown
    window.updateStudentDropdownAsync();
}

// Save assessment
const saveAssessmentBtn = document.getElementById('save-assessment-btn');
const studentSelect = document.getElementById('student-select');

if (studentSelect) {
    studentSelect.addEventListener('change', () => {
        saveAssessmentBtn.disabled = !studentSelect.value;
    });
}

if (saveAssessmentBtn) {
    saveAssessmentBtn.addEventListener('click', async () => {
        const studentId = studentSelect.value;
        if (!studentId) return;

        const assessmentData = {
            totalWords: selectedWords.length,
            wordList: selectedWords.map(w => w.text),
            accuracy: 100, // Placeholder for word-count-only mode
            wpm: 0,
            prosodyScore: 0
        };

        const success = await FirebaseDB.addAssessmentToStudent(studentId, assessmentData);

        const saveStatus = document.getElementById('save-status');
        if (success) {
            saveStatus.textContent = 'Assessment saved successfully!';
            saveStatus.className = 'save-status success';
        } else {
            saveStatus.textContent = 'Failed to save assessment';
            saveStatus.className = 'save-status error';
        }
    });
}

// New assessment button
const newAssessmentBtn = document.getElementById('start-new-analysis-btn');
if (newAssessmentBtn) {
    newAssessmentBtn.addEventListener('click', () => {
        // Reset state
        audioBlob = null;
        capturedImage = null;
        selectedWords = [];
        detectedWords = [];

        // Reset UI
        audioPlayback.style.display = 'none';
        recordingVisual.style.display = 'block';
        nextToCaptureBtn.disabled = true;
        nextToHighlightBtn.disabled = true;
        updateWordCount();

        showSection('audio');
    });
}

// ============ CLASS OVERVIEW ============
const classOverviewBtn = document.getElementById('class-overview-btn');
const backFromClassBtn = document.getElementById('back-from-class-btn');
const addStudentBtn = document.getElementById('add-student-btn');
const addStudentModal = document.getElementById('add-student-modal');
const confirmAddStudentBtn = document.getElementById('confirm-add-student-btn');
const cancelAddStudentBtn = document.getElementById('cancel-add-student-btn');
const quickAddStudentBtn = document.getElementById('quick-add-student-btn');

if (classOverviewBtn) {
    classOverviewBtn.addEventListener('click', async () => {
        await window.renderStudentsGridAsync();
        showSection('class-overview');
    });
}

if (backFromClassBtn) {
    backFromClassBtn.addEventListener('click', () => showSection('audio'));
}

if (addStudentBtn) {
    addStudentBtn.addEventListener('click', () => addStudentModal.classList.add('active'));
}

if (quickAddStudentBtn) {
    quickAddStudentBtn.addEventListener('click', () => addStudentModal.classList.add('active'));
}

if (cancelAddStudentBtn) {
    cancelAddStudentBtn.addEventListener('click', () => addStudentModal.classList.remove('active'));
}

if (confirmAddStudentBtn) {
    confirmAddStudentBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('student-name-input');
        const gradeInput = document.getElementById('student-grade-input');

        const name = nameInput.value.trim();
        const grade = gradeInput.value.trim();

        if (!name) {
            alert('Please enter a student name');
            return;
        }

        await FirebaseDB.addStudent(name, grade);

        nameInput.value = '';
        gradeInput.value = '';
        addStudentModal.classList.remove('active');

        await window.renderStudentsGridAsync();
        await window.updateAssessmentStudentDropdownAsync();
        await window.updateStudentDropdownAsync();
    });
}

// ============ STUDENT PROFILE ============
const backToClassBtn = document.getElementById('back-to-class-btn');
const deleteStudentBtn = document.getElementById('delete-student-btn');

window.showStudentProfileAsync = async function(studentId) {
    const student = await FirebaseDB.getStudent(studentId);
    if (!student) return;

    currentStudentId = studentId;

    document.getElementById('student-profile-name').textContent = student.name;
    document.getElementById('student-profile-subtitle').textContent = student.grade || 'No grade set';
    document.getElementById('profile-avatar').textContent = student.name.charAt(0).toUpperCase();

    const stats = FirebaseDB.getStudentStats(student);
    const statsSummary = document.getElementById('student-stats-summary');

    statsSummary.innerHTML = `
        <div class="stat-card">
            <span class="stat-value">${stats.totalAssessments}</span>
            <span class="stat-label">Assessments</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">${stats.avgAccuracy}%</span>
            <span class="stat-label">Avg Accuracy</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">${stats.avgWpm}</span>
            <span class="stat-label">Avg WPM</span>
        </div>
        <div class="stat-card">
            <span class="stat-value">${stats.avgProsody}</span>
            <span class="stat-label">Avg Prosody</span>
        </div>
    `;

    // Render assessment history
    const historyContainer = document.getElementById('assessment-history');
    if (!student.assessments || student.assessments.length === 0) {
        historyContainer.innerHTML = '<p class="no-assessments">No assessments yet</p>';
    } else {
        historyContainer.innerHTML = `
            <h3>Assessment History</h3>
            ${student.assessments.slice().reverse().map(a => `
                <div class="assessment-item">
                    <div class="assessment-header">
                        <span class="assessment-date">${new Date(a.date).toLocaleDateString()}</span>
                        <span class="assessment-score ${getAccuracyClassification(a.accuracy)}">${a.accuracy?.toFixed(1) || 'N/A'}%</span>
                    </div>
                    <div class="assessment-details">
                        <span>Words: ${a.totalWords || 0}</span>
                        <span>WPM: ${a.wpm || 0}</span>
                        <span>Prosody: ${a.prosodyScore?.toFixed(1) || 'N/A'}</span>
                    </div>
                </div>
            `).join('')}
        `;
    }

    showSection('student-profile');
};

if (backToClassBtn) {
    backToClassBtn.addEventListener('click', async () => {
        await window.renderStudentsGridAsync();
        showSection('class-overview');
    });
}

if (deleteStudentBtn) {
    deleteStudentBtn.addEventListener('click', async () => {
        if (!currentStudentId) return;

        if (confirm('Are you sure you want to delete this student? This cannot be undone.')) {
            await FirebaseDB.deleteStudent(currentStudentId);
            currentStudentId = null;
            await window.renderStudentsGridAsync();
            showSection('class-overview');
        }
    });
}

// ============ SIDEBAR NAVIGATION ============
progressSteps.forEach(step => {
    step.addEventListener('click', () => {
        const stepName = step.getAttribute('data-step');
        const mapping = {
            'setup': 'setup',
            'audio': 'audio',
            'capture': 'camera',
            'highlight': 'image',
            'results': 'results'
        };

        if (mapping[stepName]) {
            showSection(mapping[stepName]);
        }
    });
});

// Mobile menu toggle
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.querySelector('.sidebar');

if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });
}

// New assessment from sidebar
const newAssessmentSidebarBtn = document.getElementById('new-assessment-btn');
if (newAssessmentSidebarBtn) {
    newAssessmentSidebarBtn.addEventListener('click', () => {
        audioBlob = null;
        capturedImage = null;
        selectedWords = [];
        detectedWords = [];
        showSection('audio');
    });
}

// Student selection in audio section
const assessmentStudentSelect = document.getElementById('assessment-student-select');
const currentStudentDisplay = document.getElementById('current-student-display');
const currentStudentName = document.getElementById('current-student-name');
const studentInitial = document.getElementById('student-initial');

if (assessmentStudentSelect) {
    assessmentStudentSelect.addEventListener('change', async () => {
        const studentId = assessmentStudentSelect.value;
        if (studentId) {
            const student = await FirebaseDB.getStudent(studentId);
            if (student) {
                currentStudentId = studentId;
                currentStudentName.textContent = student.name;
                studentInitial.textContent = student.name.charAt(0).toUpperCase();
                currentStudentDisplay.style.display = 'flex';
            }
        } else {
            currentStudentId = null;
            currentStudentDisplay.style.display = 'none';
        }
    });
}

// Add results card styles
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    .results-card {
        background: white;
        border-radius: var(--radius-lg);
        padding: var(--space-2xl);
        box-shadow: var(--shadow-md);
        margin-bottom: var(--space-xl);
    }

    .results-card h3 {
        text-align: center;
        margin-bottom: var(--space-xl);
        color: var(--color-primary);
    }

    .results-stats {
        display: flex;
        justify-content: center;
        gap: var(--space-xl);
        margin-bottom: var(--space-2xl);
    }

    .result-stat {
        text-align: center;
    }

    .result-stat .stat-value {
        display: block;
        font-family: var(--font-display);
        font-size: 3rem;
        font-weight: 700;
        color: var(--color-primary);
    }

    .result-stat .stat-label {
        color: var(--color-slate);
        font-size: 0.9rem;
    }

    .words-display {
        background: var(--color-paper);
        padding: var(--space-lg);
        border-radius: var(--radius-md);
    }

    .words-display h4 {
        margin-bottom: var(--space-md);
        color: var(--color-charcoal);
    }

    .word-chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-sm);
    }

    .word-chip {
        background: white;
        padding: var(--space-xs) var(--space-md);
        border-radius: 100px;
        font-size: 0.875rem;
        border: 1px solid var(--color-sand);
    }

    .stat-card {
        background: white;
        border-radius: var(--radius-md);
        padding: var(--space-lg);
        text-align: center;
        box-shadow: var(--shadow-sm);
    }

    .stat-card .stat-value {
        display: block;
        font-family: var(--font-display);
        font-size: 2rem;
        font-weight: 700;
        color: var(--color-primary);
        margin-bottom: var(--space-xs);
    }

    .stat-card .stat-label {
        font-size: 0.8rem;
        color: var(--color-slate);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .assessment-item {
        background: white;
        border-radius: var(--radius-md);
        padding: var(--space-lg);
        margin-bottom: var(--space-md);
        box-shadow: var(--shadow-sm);
    }

    .assessment-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--space-md);
    }

    .assessment-date {
        font-weight: 600;
        color: var(--color-primary);
    }

    .assessment-score {
        font-family: var(--font-display);
        font-size: 1.25rem;
        font-weight: 700;
        padding: var(--space-xs) var(--space-md);
        border-radius: var(--radius-sm);
    }

    .assessment-score.excellent {
        background: rgba(74, 222, 128, 0.2);
        color: var(--color-success-dark);
    }

    .assessment-score.good {
        background: rgba(56, 189, 248, 0.2);
        color: #0284c7;
    }

    .assessment-score.fair {
        background: rgba(251, 191, 36, 0.2);
        color: #d97706;
    }

    .assessment-score.poor {
        background: rgba(239, 68, 68, 0.2);
        color: var(--color-error);
    }

    .assessment-details {
        display: flex;
        gap: var(--space-lg);
        color: var(--color-slate);
        font-size: 0.9rem;
    }

    .no-assessments {
        text-align: center;
        padding: var(--space-2xl);
        color: var(--color-slate);
    }

    .empty-state {
        text-align: center;
        padding: var(--space-3xl);
        background: white;
        border-radius: var(--radius-lg);
        grid-column: 1 / -1;
    }

    .empty-icon {
        width: 64px;
        height: 64px;
        margin: 0 auto var(--space-lg);
        color: var(--color-stone);
    }

    .empty-icon svg {
        width: 100%;
        height: 100%;
    }

    .empty-state h3 {
        margin-bottom: var(--space-sm);
    }

    .empty-state p {
        color: var(--color-slate);
        margin: 0;
    }
`;
document.head.appendChild(styleSheet);

debugLog('Word Analyzer V2 initialized');
