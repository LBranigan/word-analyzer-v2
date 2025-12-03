/**
 * Word Analyzer V2 - Main Application
 * A reading assessment tool with overhauled UI
 */

import { showAppReady, updateLoadingStatus, getCurrentUser } from './firebase-auth.js';
import { loadApiKeyFromFirebase, saveApiKeyToFirebase, validateApiKey, trackApiUsage } from './firebase-api-key-manager.js';
import * as FirebaseDB from './firebase-db.js';
import { escapeHtml, debugLog, debugError, getAccuracyClassification } from './utils.js';

// ============ GLOBAL STATE ============
const state = {
    apiKey: null,
    currentStep: 'setup',
    capturedImage: null,
    ocrData: null,
    selectedWords: new Set(),
    detectedWords: [],
    audioBlob: null,
    recordedAudioBlob: null, // For video generation
    mediaStream: null,
    mediaRecorder: null,
    recordingStartTime: null,
    recordingDuration: 60,
    currentStudentId: null,
    // Drawing state for drag selection
    isDrawing: false,
    wasDragged: false,
    startPoint: null,
    endPoint: null,
    // Zoom/pan
    zoom: 1,
    panX: 0,
    panY: 0,
    // Analysis results (for PDF/video export)
    latestAnalysis: null,
    latestExpectedWords: null,
    latestSpokenWords: null,
    latestProsodyMetrics: null,
    latestErrorPatterns: null,
    viewingHistoricalAssessment: false
};

// Image cache for performance
const imageCache = {
    img: null,
    src: null,
    load(src) {
        if (this.src === src && this.img && this.img.complete) {
            return Promise.resolve(this.img);
        }
        this.src = src;
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                this.img = img;
                resolve(img);
            };
            img.src = src;
        });
    }
};

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

// ============ BUILD TIMESTAMP ============
const BUILD_TIMESTAMP = '2024-12-03 17:45';
const timestampEl = document.getElementById('build-timestamp');
if (timestampEl) timestampEl.textContent = BUILD_TIMESTAMP;

// ============ INITIALIZATION ============
window.addEventListener('userAuthenticated', async (event) => {
    debugLog('User authenticated, initializing app...');

    state.apiKey = await loadApiKeyFromFirebase();

    await window.updateAssessmentStudentDropdownAsync();
    await window.updateStudentDropdownAsync();

    if (state.apiKey) {
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
    const allSections = document.querySelectorAll('.page-section');
    allSections.forEach(s => s.classList.remove('active'));

    const targetSection = document.getElementById(`${sectionName}-section`);
    if (targetSection) {
        targetSection.classList.add('active');
        state.currentStep = sectionName;
    }

    if (['setup', 'audio', 'camera', 'image', 'results'].includes(sectionName)) {
        updateProgress(sectionName);
    }

    // Initialize camera when entering camera section
    if (sectionName === 'camera') {
        initCamera();
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

    const fillPercent = ((currentIndex + 1) / stepOrder.length) * 100;
    if (spineFill) {
        spineFill.style.height = `${fillPercent}%`;
    }

    progressSteps.forEach((stepEl) => {
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
            state.apiKey = key;
            showSection('audio');
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

window.addEventListener('openApiSettings', () => showSection('setup'));

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
    recordBtn.addEventListener('click', () => audioModal.classList.add('active'));
}

if (cancelRecordingBtn) {
    cancelRecordingBtn.addEventListener('click', () => audioModal.classList.remove('active'));
}

if (startRecordingBtn) {
    startRecordingBtn.addEventListener('click', async () => {
        audioModal.classList.remove('active');

        const durationSelect = document.getElementById('audio-duration');
        state.recordingDuration = parseFloat(durationSelect.value) * 60;

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            state.mediaStream = stream;

            state.mediaRecorder = new MediaRecorder(stream);
            const chunks = [];

            state.mediaRecorder.ondataavailable = (e) => chunks.push(e.data);

            state.mediaRecorder.onstop = () => {
                state.audioBlob = new Blob(chunks, { type: 'audio/webm' });
                state.recordedAudioBlob = state.audioBlob; // Store for video generation
                const audioUrl = URL.createObjectURL(state.audioBlob);
                audioPlayer.src = audioUrl;

                recordingVisual.style.display = 'none';
                recordingActive.style.display = 'none';
                audioPlayback.style.display = 'block';
                nextToCaptureBtn.disabled = false;

                stream.getTracks().forEach(track => track.stop());
            };

            state.mediaRecorder.start();
            state.recordingStartTime = Date.now();

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
    if (!state.recordingStartTime || !state.mediaRecorder || state.mediaRecorder.state !== 'recording') return;

    const elapsed = (Date.now() - state.recordingStartTime) / 1000;
    const minutes = Math.floor(elapsed / 60);
    const seconds = Math.floor(elapsed % 60);

    recordingTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    timerBar.style.width = `${(elapsed / state.recordingDuration) * 100}%`;

    if (elapsed >= state.recordingDuration) {
        stopRecording();
    } else {
        requestAnimationFrame(updateRecordingTimer);
    }
}

function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state === 'recording') {
        state.mediaRecorder.stop();
        recordingVisual.classList.remove('recording');
    }
}

if (stopRecordingBtn) stopRecordingBtn.addEventListener('click', stopRecording);

if (rerecordBtn) {
    rerecordBtn.addEventListener('click', () => {
        state.audioBlob = null;
        audioPlayback.style.display = 'none';
        recordingVisual.style.display = 'block';
        nextToCaptureBtn.disabled = true;
    });
}

if (downloadAudioBtn) {
    downloadAudioBtn.addEventListener('click', () => {
        if (state.audioBlob) {
            const url = URL.createObjectURL(state.audioBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `recording-${Date.now()}.webm`;
            a.click();
        }
    });
}

if (skipAudioBtn) {
    skipAudioBtn.addEventListener('click', () => {
        state.audioBlob = null;
        showSection('camera');
    });
}

if (nextToCaptureBtn) {
    nextToCaptureBtn.addEventListener('click', () => showSection('camera'));
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
    // Reset preview state
    camera.style.display = 'block';
    cameraCanvas.style.display = 'none';

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
        });
        camera.srcObject = stream;
        state.mediaStream = stream;
    } catch (error) {
        debugError('Error accessing camera:', error);
    }
}

if (captureBtn) {
    captureBtn.addEventListener('click', () => {
        const ctx = cameraCanvas.getContext('2d');
        cameraCanvas.width = camera.videoWidth;
        cameraCanvas.height = camera.videoHeight;
        ctx.drawImage(camera, 0, 0);

        state.capturedImage = cameraCanvas.toDataURL('image/jpeg', 1.0);
        nextToHighlightBtn.disabled = false;

        // FIX #1: Show captured image preview instead of black screen
        camera.style.display = 'none';
        cameraCanvas.style.display = 'block';

        // Stop camera
        if (state.mediaStream) {
            state.mediaStream.getTracks().forEach(track => track.stop());
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
                state.capturedImage = event.target.result;
                nextToHighlightBtn.disabled = false;

                // Show preview of uploaded image
                const img = new Image();
                img.onload = () => {
                    const ctx = cameraCanvas.getContext('2d');
                    cameraCanvas.width = img.width;
                    cameraCanvas.height = img.height;
                    ctx.drawImage(img, 0, 0);
                    camera.style.display = 'none';
                    cameraCanvas.style.display = 'block';
                };
                img.src = event.target.result;
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
const redoAutodetectBtn = document.getElementById('redo-autodetect-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomResetBtn = document.getElementById('zoom-reset-btn');

async function processImage() {
    if (!state.capturedImage || !state.apiKey) return;

    const loadingOverlay = document.getElementById('highlight-loading-overlay');
    const loadingStatus = document.getElementById('highlight-loading-status');
    loadingOverlay.style.display = 'flex';

    try {
        loadingStatus.textContent = 'Detecting text...';
        updateLoadingStep(1);

        // Call Vision API with DOCUMENT_TEXT_DETECTION for better word boundaries
        const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${state.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requests: [{
                    image: { content: state.capturedImage.split(',')[1] },
                    features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }]
                }]
            })
        });

        const data = await response.json();
        await trackApiUsage('vision');

        if (data.error) {
            throw new Error(data.error.message);
        }

        // Extract words with bounding boxes
        const words = [];
        if (data.responses && data.responses[0] && data.responses[0].fullTextAnnotation) {
            const pages = data.responses[0].fullTextAnnotation.pages || [];
            pages.forEach(page => {
                page.blocks.forEach(block => {
                    block.paragraphs.forEach(paragraph => {
                        paragraph.words.forEach(word => {
                            const vertices = word.boundingBox.vertices;
                            const text = word.symbols.map(s => s.text).join('');

                            // Only include words with alphanumeric characters
                            if (/[a-zA-Z0-9]/.test(text)) {
                                const xs = vertices.map(v => v.x || 0);
                                const ys = vertices.map(v => v.y || 0);
                                words.push({
                                    text: text,
                                    bbox: {
                                        x0: Math.min(...xs),
                                        y0: Math.min(...ys),
                                        x1: Math.max(...xs),
                                        y1: Math.max(...ys)
                                    },
                                    vertices: vertices
                                });
                            }
                        });
                    });
                });
            });
        }

        state.ocrData = { words };
        state.selectedWords.clear();

        debugLog('OCR found', words.length, 'words');

        // Draw canvas
        drawImageWithWords();

        // Auto-detect if audio was recorded
        if (state.audioBlob && words.length > 0) {
            loadingStatus.textContent = 'Transcribing audio...';
            updateLoadingStep(2);
            await autoDetectSpokenWords();
        }

        loadingOverlay.style.display = 'none';
        analyzeBtn.disabled = false;

    } catch (error) {
        debugError('Error processing image:', error);
        loadingOverlay.style.display = 'none';
        alert('Error processing image: ' + error.message);
    }
}

function updateLoadingStep(step) {
    for (let i = 1; i <= 3; i++) {
        const el = document.getElementById(`load-step-${i}`);
        if (el) {
            el.classList.remove('active', 'completed');
            if (i < step) el.classList.add('completed');
            if (i === step) el.classList.add('active');
        }
    }
}

function drawImageWithWords() {
    imageCache.load(state.capturedImage).then(img => {
        const canvas = selectionCanvas;
        canvas.width = img.width;
        canvas.height = img.height;

        redrawCanvas();
        setupCanvasInteraction();
    });
}

let pendingRedraw = null;

function redrawCanvas() {
    if (pendingRedraw) cancelAnimationFrame(pendingRedraw);
    pendingRedraw = requestAnimationFrame(performRedraw);
}

function performRedraw() {
    pendingRedraw = null;
    if (!state.capturedImage) return;

    imageCache.load(state.capturedImage).then(img => {
        const canvas = selectionCanvas;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Apply zoom/pan
        ctx.setTransform(state.zoom, 0, 0, state.zoom, state.panX, state.panY);

        ctx.drawImage(img, 0, 0);

        // Draw word boxes
        if (state.ocrData && state.ocrData.words) {
            state.ocrData.words.forEach((word, index) => {
                const { x0, y0, x1, y1 } = word.bbox;

                if (state.selectedWords.has(index)) {
                    ctx.fillStyle = 'rgba(255, 255, 0, 0.5)';
                    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
                    ctx.strokeStyle = 'rgba(255, 200, 0, 0.9)';
                    ctx.lineWidth = 3 / state.zoom;
                } else {
                    ctx.strokeStyle = 'rgba(26, 83, 92, 0.3)';
                    ctx.lineWidth = 1 / state.zoom;
                }
                ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
            });
        }

        // Draw selection line if drawing
        if (state.isDrawing && state.startPoint && state.endPoint) {
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
            ctx.lineWidth = 8 / state.zoom;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(state.startPoint.x, state.startPoint.y);
            ctx.lineTo(state.endPoint.x, state.endPoint.y);
            ctx.stroke();

            // Draw circles at endpoints
            ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
            ctx.beginPath();
            ctx.arc(state.startPoint.x, state.startPoint.y, 15 / state.zoom, 0, 2 * Math.PI);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(state.endPoint.x, state.endPoint.y, 15 / state.zoom, 0, 2 * Math.PI);
            ctx.fill();
        }
    });
}

// ============ CANVAS INTERACTION (FIX #4: Drag to highlight) ============
let listenersAttached = false;

function setupCanvasInteraction() {
    const canvas = selectionCanvas;
    if (!canvas) return;

    if (listenersAttached) {
        canvas.removeEventListener('touchstart', handleStart);
        canvas.removeEventListener('touchmove', handleMove);
        canvas.removeEventListener('touchend', handleEnd);
        canvas.removeEventListener('mousedown', handleStart);
        canvas.removeEventListener('mousemove', handleMove);
        canvas.removeEventListener('mouseup', handleEnd);
    }

    canvas.addEventListener('touchstart', handleStart, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });
    canvas.addEventListener('touchend', handleEnd, { passive: false });
    canvas.addEventListener('mousedown', handleStart);
    canvas.addEventListener('mousemove', handleMove);
    canvas.addEventListener('mouseup', handleEnd);

    listenersAttached = true;
}

function handleStart(e) {
    e.preventDefault();
    state.isDrawing = true;
    state.wasDragged = false;
    state.startPoint = getCanvasPoint(e);
    state.endPoint = state.startPoint;
    debugLog('Started drawing at:', state.startPoint);
}

function handleMove(e) {
    if (!state.isDrawing) return;
    e.preventDefault();
    state.wasDragged = true;
    state.endPoint = getCanvasPoint(e);
    redrawCanvas();
}

function handleEnd(e) {
    if (!state.isDrawing) return;
    e.preventDefault();
    state.isDrawing = false;
    state.endPoint = getCanvasPoint(e);

    const dragDistance = Math.sqrt(
        Math.pow(state.endPoint.x - state.startPoint.x, 2) +
        Math.pow(state.endPoint.y - state.startPoint.y, 2)
    );

    if (state.wasDragged && dragDistance >= 15) {
        // Drag selection - select words between points
        selectWordsBetweenPoints();
    } else {
        // Tap/click - toggle single word
        const clickedIndex = findWordAtPoint(state.startPoint);
        if (clickedIndex !== -1) {
            if (state.selectedWords.has(clickedIndex)) {
                state.selectedWords.delete(clickedIndex);
            } else {
                state.selectedWords.add(clickedIndex);
            }
        }
    }

    state.startPoint = null;
    state.endPoint = null;
    updateWordCount();
    redrawCanvas();
}

function getCanvasPoint(e) {
    const canvas = selectionCanvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    let clientX, clientY;
    if (e.touches && e.touches.length > 0) {
        clientX = e.touches[0].clientX;
        clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
        clientY = e.changedTouches[0].clientY;
    } else {
        clientX = e.clientX;
        clientY = e.clientY;
    }

    const screenX = (clientX - rect.left) * scaleX;
    const screenY = (clientY - rect.top) * scaleY;

    return {
        x: (screenX - state.panX) / state.zoom,
        y: (screenY - state.panY) / state.zoom
    };
}

function findWordAtPoint(point) {
    if (!state.ocrData || !state.ocrData.words) return -1;

    for (let i = 0; i < state.ocrData.words.length; i++) {
        const { x0, y0, x1, y1 } = state.ocrData.words[i].bbox;
        if (point.x >= x0 && point.x <= x1 && point.y >= y0 && point.y <= y1) {
            return i;
        }
    }
    return -1;
}

function findClosestWordIndex(point) {
    if (!state.ocrData || !state.ocrData.words) return -1;

    let closestIndex = -1;
    let closestDist = Infinity;

    state.ocrData.words.forEach((word, index) => {
        const { x0, y0, x1, y1 } = word.bbox;
        const centerX = (x0 + x1) / 2;
        const centerY = (y0 + y1) / 2;
        const dist = Math.sqrt(Math.pow(point.x - centerX, 2) + Math.pow(point.y - centerY, 2));

        if (dist < closestDist) {
            closestDist = dist;
            closestIndex = index;
        }
    });

    return closestIndex;
}

function selectWordsBetweenPoints() {
    if (!state.ocrData || !state.ocrData.words || !state.startPoint || !state.endPoint) return;

    let startIndex = findClosestWordIndex(state.startPoint);
    let endIndex = findClosestWordIndex(state.endPoint);

    if (startIndex === -1 || endIndex === -1) return;

    if (startIndex > endIndex) {
        [startIndex, endIndex] = [endIndex, startIndex];
    }

    debugLog('Selecting words from', startIndex, 'to', endIndex);

    for (let i = startIndex; i <= endIndex; i++) {
        state.selectedWords.add(i);
    }
}

function updateWordCount() {
    document.getElementById('word-count').textContent = state.selectedWords.size;
}

// Zoom controls
if (zoomInBtn) zoomInBtn.addEventListener('click', () => { state.zoom = Math.min(state.zoom * 1.2, 5); redrawCanvas(); });
if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { state.zoom = Math.max(state.zoom / 1.2, 0.5); redrawCanvas(); });
if (zoomResetBtn) zoomResetBtn.addEventListener('click', () => { state.zoom = 1; state.panX = 0; state.panY = 0; redrawCanvas(); });

if (resetSelectionBtn) {
    resetSelectionBtn.addEventListener('click', () => {
        state.selectedWords.clear();
        updateWordCount();
        redrawCanvas();
    });
}

if (backToCaptureBtn) {
    backToCaptureBtn.addEventListener('click', () => showSection('camera'));
}

// ============ AUTO-DETECT (FIX #3) ============
if (redoAutodetectBtn) {
    redoAutodetectBtn.addEventListener('click', async () => {
        if (!state.audioBlob) {
            alert('No audio recorded. Please record audio first.');
            return;
        }
        const loadingOverlay = document.getElementById('highlight-loading-overlay');
        loadingOverlay.style.display = 'flex';
        await autoDetectSpokenWords();
        loadingOverlay.style.display = 'none';
    });
}

async function autoDetectSpokenWords() {
    if (!state.audioBlob || !state.ocrData || !state.ocrData.words.length || !state.apiKey) {
        debugLog('Cannot auto-detect: missing audio, OCR data, or API key');
        return;
    }

    state.selectedWords.clear();
    updateWordCount();

    try {
        updateLoadingStep(2);
        document.getElementById('highlight-loading-status').textContent = 'Transcribing audio...';

        // Run speech-to-text (get full word info for better matching)
        const spokenWordInfo = await runSpeechToText(true);

        if (!spokenWordInfo || spokenWordInfo.length === 0) {
            debugLog('No speech detected');
            return;
        }

        debugLog('Spoken words:', spokenWordInfo.map(w => w.word));

        updateLoadingStep(3);
        document.getElementById('highlight-loading-status').textContent = 'Matching words...';

        // Get OCR words
        const ocrWords = state.ocrData.words.map(w => w.text);

        // Use sophisticated matching algorithm
        const matchResult = findSpokenRangeInOCR(spokenWordInfo, ocrWords);

        if (matchResult.firstIndex !== -1 && matchResult.lastIndex !== -1) {
            debugLog('Auto-selecting from', matchResult.firstIndex, 'to', matchResult.lastIndex);
            for (let i = matchResult.firstIndex; i <= matchResult.lastIndex; i++) {
                state.selectedWords.add(i);
            }
            updateWordCount();
            redrawCanvas();

            // Store spoken words for later analysis
            state.latestSpokenWords = spokenWordInfo;
        } else {
            debugLog('Could not match spoken words to OCR text');
        }

    } catch (error) {
        debugError('Auto-detect error:', error);
    }
}

// ============ SOPHISTICATED AUTO-DETECT MATCHING ============

function findSpokenRangeInOCR(spokenWords, ocrWords) {
    // Normalize spoken words (remove filler words, clean up)
    const cleanSpoken = spokenWords
        .filter(w => w && w.word && !isFillerWord(w.word))
        .map(w => normalizeWordForMatching(w.word))
        .filter(w => w.length > 0);

    // Normalize OCR words
    const cleanOCR = ocrWords.map(w => normalizeWordForMatching(w));

    debugLog('Clean spoken:', cleanSpoken);
    debugLog('Clean OCR:', cleanOCR);

    if (cleanSpoken.length === 0 || cleanOCR.length === 0) {
        return { firstIndex: -1, lastIndex: -1, matchedCount: 0 };
    }

    // Build similarity matrix and find best alignment
    const similarityMatrix = buildSimilarityMatrix(cleanSpoken, cleanOCR);
    const alignment = findBestAlignment(cleanSpoken, cleanOCR, similarityMatrix);

    if (alignment.firstOCRIndex === -1 || alignment.lastOCRIndex === -1) {
        // Fallback: Try anchor-based matching
        return findRangeByAnchors(cleanSpoken, cleanOCR);
    }

    return {
        firstIndex: alignment.firstOCRIndex,
        lastIndex: alignment.lastOCRIndex,
        matchedCount: alignment.matchedCount
    };
}

function buildSimilarityMatrix(spoken, ocr) {
    const matrix = [];
    for (let s = 0; s < spoken.length; s++) {
        matrix[s] = [];
        for (let o = 0; o < ocr.length; o++) {
            matrix[s][o] = calculateWordSimilarity(spoken[s], ocr[o]);
        }
    }
    return matrix;
}

function calculateWordSimilarity(word1, word2) {
    if (!word1 || !word2) return 0;
    if (word1 === word2) return 1.0;

    // Check phonetic similarity
    const phonetic1 = getPhoneticCode(word1);
    const phonetic2 = getPhoneticCode(word2);
    if (phonetic1 && phonetic2 && phonetic1 === phonetic2) {
        return 0.95;
    }

    // Check for common OCR/STT confusions
    if (areCommonConfusions(word1, word2)) {
        return 0.9;
    }

    // Check prefix matching
    const minLen = Math.min(word1.length, word2.length);
    const maxLen = Math.max(word1.length, word2.length);

    if (minLen >= 3) {
        if (word1.startsWith(word2) || word2.startsWith(word1)) {
            return 0.7 + (0.25 * minLen / maxLen);
        }
        const prefixLen = Math.min(4, minLen);
        if (word1.substring(0, prefixLen) === word2.substring(0, prefixLen)) {
            return 0.6 + (0.3 * minLen / maxLen);
        }
    }

    // Levenshtein-based similarity
    const distance = levenshteinDistance(word1, word2);
    const similarity = 1 - (distance / maxLen);
    const lengthBonus = Math.min(0.1, maxLen * 0.01);

    return Math.min(1.0, similarity + lengthBonus);
}

function getPhoneticCode(word) {
    if (!word || word.length < 2) return null;

    let code = word[0].toUpperCase();
    const phonemeMap = {
        'b': '1', 'f': '1', 'p': '1', 'v': '1',
        'c': '2', 'g': '2', 'j': '2', 'k': '2', 'q': '2', 's': '2', 'x': '2', 'z': '2',
        'd': '3', 't': '3', 'l': '4', 'm': '5', 'n': '5', 'r': '6'
    };

    let lastCode = '';
    for (let i = 1; i < word.length && code.length < 4; i++) {
        const char = word[i].toLowerCase();
        const phoneCode = phonemeMap[char];
        if (phoneCode && phoneCode !== lastCode) {
            code += phoneCode;
            lastCode = phoneCode;
        } else if (!phonemeMap[char]) {
            lastCode = '';
        }
    }

    while (code.length < 4) code += '0';
    return code;
}

function areCommonConfusions(word1, word2) {
    const ocrConfusions = [
        ['0', 'o'], ['1', 'l'], ['1', 'i'], ['5', 's'],
        ['8', 'b'], ['rn', 'm'], ['cl', 'd'], ['vv', 'w']
    ];

    let normalized1 = word1.toLowerCase();
    let normalized2 = word2.toLowerCase();

    for (const [from, to] of ocrConfusions) {
        const alt1a = normalized1.replace(new RegExp(from, 'g'), to);
        const alt1b = normalized1.replace(new RegExp(to, 'g'), from);
        const alt2a = normalized2.replace(new RegExp(from, 'g'), to);
        const alt2b = normalized2.replace(new RegExp(to, 'g'), from);

        if (alt1a === normalized2 || alt1b === normalized2 ||
            normalized1 === alt2a || normalized1 === alt2b) {
            return true;
        }
    }

    const wordConfusions = [
        ['the', 'a'], ['the', 'uh'], ['and', 'an'], ['to', 'too', 'two'],
        ['there', 'their', 'theyre'], ['its', 'its'], ['your', 'youre'],
        ['were', 'where', 'were'], ['then', 'than']
    ];

    for (const group of wordConfusions) {
        if (group.includes(normalized1) && group.includes(normalized2)) {
            return true;
        }
    }

    return false;
}

function findBestAlignment(spoken, ocr, similarityMatrix) {
    const m = spoken.length;
    const n = ocr.length;

    const MATCH_THRESHOLD = 0.55;
    const SKIP_PENALTY = 0.3;
    const GAP_PENALTY = 0.4;

    let bestScore = 0;
    let bestEndOCR = -1;
    let bestStartOCR = -1;
    let bestMatchCount = 0;

    for (let startOCR = 0; startOCR < n; startOCR++) {
        const dp = new Array(m + 1).fill(null).map(() => ({
            score: 0, matchCount: 0, lastOCR: startOCR - 1, firstOCR: -1
        }));

        for (let s = 0; s < m; s++) {
            const prevState = dp[s];

            for (let o = prevState.lastOCR + 1; o < n; o++) {
                const sim = similarityMatrix[s][o];

                if (sim >= MATCH_THRESHOLD) {
                    const skippedOCR = o - prevState.lastOCR - 1;
                    const skipPenalty = skippedOCR * SKIP_PENALTY;
                    const newScore = prevState.score + sim - skipPenalty;

                    if (newScore > dp[s + 1].score) {
                        dp[s + 1] = {
                            score: newScore,
                            matchCount: prevState.matchCount + 1,
                            lastOCR: o,
                            firstOCR: prevState.firstOCR === -1 ? o : prevState.firstOCR
                        };
                    }
                }
            }

            if (dp[s].score - GAP_PENALTY > dp[s + 1].score) {
                dp[s + 1] = {
                    score: dp[s].score - GAP_PENALTY,
                    matchCount: dp[s].matchCount,
                    lastOCR: dp[s].lastOCR,
                    firstOCR: dp[s].firstOCR
                };
            }
        }

        const finalState = dp[m];
        if (finalState.matchCount >= 2 && finalState.score > bestScore) {
            bestScore = finalState.score;
            bestEndOCR = finalState.lastOCR;
            bestStartOCR = finalState.firstOCR;
            bestMatchCount = finalState.matchCount;
        }
    }

    debugLog('DP alignment:', { bestStartOCR, bestEndOCR, bestScore, bestMatchCount });

    return {
        firstOCRIndex: bestStartOCR,
        lastOCRIndex: bestEndOCR,
        matchedCount: bestMatchCount,
        score: bestScore
    };
}

function findRangeByAnchors(spoken, ocr) {
    debugLog('Using anchor-based fallback...');

    const ocrWordCounts = {};
    ocr.forEach(w => { ocrWordCounts[w] = (ocrWordCounts[w] || 0) + 1; });

    const anchors = [];

    for (let s = 0; s < spoken.length; s++) {
        const spokenWord = spoken[s];
        if (spokenWord.length < 4) continue;

        for (let o = 0; o < ocr.length; o++) {
            const ocrWord = ocr[o];
            if (ocrWordCounts[ocrWord] > 2) continue;

            const sim = calculateWordSimilarity(spokenWord, ocrWord);
            if (sim >= 0.6) {
                anchors.push({ spokenIdx: s, ocrIdx: o, similarity: sim });
            }
        }
    }

    if (anchors.length === 0) {
        debugLog('No anchors found');
        return { firstIndex: -1, lastIndex: -1, matchedCount: 0 };
    }

    anchors.sort((a, b) => a.spokenIdx - b.spokenIdx);

    let bestStart = anchors[0].ocrIdx;
    let bestEnd = anchors[0].ocrIdx;
    let currentStart = anchors[0].ocrIdx;
    let currentEnd = anchors[0].ocrIdx;
    let matchCount = 1;
    let bestMatchCount = 1;

    for (let i = 1; i < anchors.length; i++) {
        if (anchors[i].ocrIdx > currentEnd) {
            currentEnd = anchors[i].ocrIdx;
            matchCount++;
            if (matchCount > bestMatchCount) {
                bestMatchCount = matchCount;
                bestStart = currentStart;
                bestEnd = currentEnd;
            }
        } else if (anchors[i].ocrIdx < currentStart) {
            currentStart = anchors[i].ocrIdx;
            currentEnd = anchors[i].ocrIdx;
            matchCount = 1;
        }
    }

    debugLog('Anchor result:', { bestStart, bestEnd, bestMatchCount });

    return { firstIndex: bestStart, lastIndex: bestEnd, matchedCount: bestMatchCount };
}

function normalizeWordForMatching(word) {
    if (!word || typeof word !== 'string') return '';

    let normalized = word.toLowerCase().replace(/[^\w]/g, '');

    normalized = normalized
        .replace(/n't$/, 'not')
        .replace(/'re$/, 'are')
        .replace(/'ve$/, 'have')
        .replace(/'ll$/, 'will')
        .replace(/'d$/, 'would')
        .replace(/'s$/, '');

    const numberWords = {
        '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
        '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
        '10': 'ten', '11': 'eleven', '12': 'twelve'
    };
    if (numberWords[normalized]) {
        normalized = numberWords[normalized];
    }

    return normalized;
}

async function runSpeechToText(returnFullInfo = false) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(state.audioBlob);

        reader.onloadend = async () => {
            try {
                const base64Audio = reader.result.split(',')[1];

                const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${state.apiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        config: {
                            encoding: 'WEBM_OPUS',
                            sampleRateHertz: 48000,
                            languageCode: 'en-US',
                            enableWordTimeOffsets: true,
                            enableAutomaticPunctuation: true,
                            enableWordConfidence: true
                        },
                        audio: { content: base64Audio }
                    })
                });

                const data = await response.json();
                await trackApiUsage('speech');

                if (data.error) {
                    throw new Error(data.error.message);
                }

                const words = [];
                const wordInfo = [];
                if (data.results) {
                    data.results.forEach(result => {
                        if (result.alternatives && result.alternatives[0]) {
                            const alt = result.alternatives[0];
                            if (alt.words) {
                                alt.words.forEach(w => {
                                    words.push(w.word);
                                    wordInfo.push({
                                        word: w.word,
                                        startTime: w.startTime,
                                        endTime: w.endTime,
                                        confidence: w.confidence || alt.confidence || 0.9
                                    });
                                });
                            } else if (alt.transcript) {
                                const transcriptWords = alt.transcript.split(/\s+/);
                                transcriptWords.forEach(w => {
                                    words.push(w);
                                    wordInfo.push({ word: w, confidence: alt.confidence || 0.9 });
                                });
                            }
                        }
                    });
                }

                resolve(returnFullInfo ? wordInfo : words);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => reject(new Error('Error reading audio'));
    });
}

function normalizeWord(word) {
    return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isFillerWord(word) {
    const fillers = ['um', 'uh', 'er', 'ah', 'like', 'you know', 'i mean'];
    return fillers.includes(word.toLowerCase());
}

function wordsMatch(word1, word2) {
    if (word1 === word2) return true;
    if (word1.length < 2 || word2.length < 2) return false;

    // Check prefix match
    const minLen = Math.min(word1.length, word2.length);
    if (minLen >= 3 && word1.substring(0, 3) === word2.substring(0, 3)) return true;

    // Levenshtein distance for fuzzy matching
    const maxLen = Math.max(word1.length, word2.length);
    const distance = levenshteinDistance(word1, word2);
    return (1 - distance / maxLen) >= 0.7;
}

function levenshteinDistance(str1, str2) {
    const m = str1.length, n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}

// ============ PHONETIC EQUIVALENCES ============
const phoneticEquivalences = {
    'graham': ['gram', 'grahm'], 'michael': ['mike', 'micheal'], 'stephen': ['steven', 'stefan'],
    'catherine': ['katherine', 'kathryn'], 'anne': ['ann'], 'sara': ['sarah'], 'jon': ['john'],
    'knight': ['night'], 'know': ['no'], 'knew': ['new'], 'write': ['right', 'rite'],
    'whole': ['hole'], 'hour': ['our'], 'their': ['there', 'theyre'], 'your': ['youre'],
    'its': ['its'], 'to': ['too', 'two'], 'by': ['bye', 'buy'], 'for': ['four', 'fore']
};

function arePhoneticEquivalents(word1, word2) {
    const w1 = word1.toLowerCase();
    const w2 = word2.toLowerCase();
    if (w1 === w2) return true;
    for (const [base, equivalents] of Object.entries(phoneticEquivalences)) {
        const allForms = [base, ...equivalents];
        if (allForms.includes(w1) && allForms.includes(w2)) return true;
    }
    return false;
}

function wordsAreSimilar(word1, word2) {
    const w1 = normalizeWord(word1);
    const w2 = normalizeWord(word2);
    if (w1 === w2) return true;
    const maxLen = Math.max(w1.length, w2.length);
    if (maxLen === 0) return true;
    const dist = levenshteinDistance(w1, w2);
    return (1 - dist / maxLen) >= 0.6;
}

function detectHesitation(spokenWordInfo, index) {
    if (index === 0 || !spokenWordInfo[index] || !spokenWordInfo[index - 1]) return false;
    const curr = spokenWordInfo[index];
    const prev = spokenWordInfo[index - 1];
    if (!curr.startTime || !prev.endTime) return false;
    const currStart = parseFloat(curr.startTime.replace('s', ''));
    const prevEnd = parseFloat(prev.endTime.replace('s', ''));
    return (currStart - prevEnd) > 0.5;
}

// ============ PRONUNCIATION ANALYSIS ============
function analyzePronunciation(expectedWords, spokenWordInfo) {
    const analysis = {
        aligned: [],
        errors: {
            skippedWords: [], misreadWords: [], substitutedWords: [],
            hesitations: [], repeatedWords: [], skippedLines: [], repeatedPhrases: []
        },
        correctCount: 0
    };

    // First pass: Detect hesitations and repetitions
    for (let i = 0; i < spokenWordInfo.length; i++) {
        const word = spokenWordInfo[i];
        if (!word || !word.word) continue;
        if (isFillerWord(word.word)) {
            analysis.errors.hesitations.push({ spokenIndex: i, type: 'filler', word: word.word });
        } else if (detectHesitation(spokenWordInfo, i)) {
            analysis.errors.hesitations.push({ spokenIndex: i, type: 'pause', word: word.word });
        }
        const prevWord = spokenWordInfo[i - 1];
        if (i > 0 && prevWord && prevWord.word && normalizeWord(word.word) === normalizeWord(prevWord.word)) {
            analysis.errors.repeatedWords.push({ spokenIndex: i, word: word.word });
        }
    }

    // Filter spoken words
    const cleanSpoken = [];
    for (let i = 0; i < spokenWordInfo.length; i++) {
        const word = spokenWordInfo[i];
        if (!word || !word.word || isFillerWord(word.word)) continue;
        const prev = cleanSpoken[cleanSpoken.length - 1];
        if (prev && normalizeWord(word.word) === normalizeWord(prev.word)) continue;
        cleanSpoken.push(word);
    }

    // DP alignment
    const m = expectedWords.length;
    const n = cleanSpoken.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
    const path = Array(m + 1).fill(null).map(() => Array(n + 1).fill(null));

    for (let i = 1; i <= m; i++) { dp[i][0] = -i; path[i][0] = 'skip'; }
    for (let j = 1; j <= n; j++) { dp[0][j] = -j * 0.5; path[0][j] = 'insert'; }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const expNorm = normalizeWord(expectedWords[i - 1]);
            const spkNorm = normalizeWord(cleanSpoken[j - 1].word);
            let matchScore = (expNorm === spkNorm || arePhoneticEquivalents(expNorm, spkNorm)) ? 1 :
                             wordsAreSimilar(expectedWords[i - 1], cleanSpoken[j - 1].word) ? 0.3 : -1;
            const matchOption = dp[i - 1][j - 1] + matchScore;
            const skipOption = dp[i - 1][j] - 1;
            const insertOption = dp[i][j - 1] - 0.5;
            if (matchOption >= skipOption && matchOption >= insertOption) {
                dp[i][j] = matchOption; path[i][j] = 'match';
            } else if (skipOption >= insertOption) {
                dp[i][j] = skipOption; path[i][j] = 'skip';
            } else {
                dp[i][j] = insertOption; path[i][j] = 'insert';
            }
        }
    }

    // Backtrack
    let i = m, j = n;
    const alignment = [];
    while (i > 0 || j > 0) {
        const action = path[i][j];
        if (action === 'match') {
            const expected = expectedWords[i - 1];
            const spoken = cleanSpoken[j - 1];
            const expNorm = normalizeWord(expected);
            const spkNorm = normalizeWord(spoken.word);
            if (expNorm === spkNorm || arePhoneticEquivalents(expNorm, spkNorm)) {
                alignment.unshift({ expected, spoken: spoken.word, status: 'correct', confidence: spoken.confidence, startTime: spoken.startTime, endTime: spoken.endTime, index: i - 1 });
                analysis.correctCount++;
            } else {
                alignment.unshift({ expected, spoken: spoken.word, status: 'misread', confidence: spoken.confidence, startTime: spoken.startTime, endTime: spoken.endTime, index: i - 1 });
                analysis.errors.misreadWords.push({ index: i - 1, expected, spoken: spoken.word });
            }
            i--; j--;
        } else if (action === 'skip') {
            alignment.unshift({ expected: expectedWords[i - 1], spoken: null, status: 'skipped', index: i - 1 });
            analysis.errors.skippedWords.push(i - 1);
            i--;
        } else if (action === 'insert') {
            j--;
        } else break;
    }
    analysis.aligned = alignment;
    return analysis;
}

// ============ ERROR PATTERN ANALYSIS ============
function analyzeErrorPatterns(analysis, expectedWords) {
    const patterns = {
        phonicsPatterns: { initialSoundErrors: [], finalSoundErrors: [], vowelPatterns: [], consonantBlends: [], silentLetters: [], rControlledVowels: [], digraphs: [] },
        readingStrategies: { firstLetterGuessing: [], contextGuessing: [], partialDecoding: [] },
        speechPatterns: { rSoundIssues: [], sSoundIssues: [], lSoundIssues: [], thSoundIssues: [] },
        morphologicalErrors: [], visualSimilarityErrors: [], summary: {}
    };

    if (!analysis || !analysis.errors) {
        patterns.summary = generatePatternSummary(patterns, analysis);
        return patterns;
    }

    (analysis.errors.misreadWords || []).forEach(error => {
        if (!error || !error.expected || !error.spoken) return;
        const expected = error.expected.toLowerCase();
        const actual = error.spoken.toLowerCase();
        analyzePhonicsPattern(expected, actual, patterns);
        analyzeReadingStrategy(expected, actual, patterns);
        analyzeSpeechPattern(expected, actual, patterns);
        analyzeVisualSimilarity(expected, actual, patterns);
    });

    patterns.summary = generatePatternSummary(patterns, analysis);
    return patterns;
}

function analyzePhonicsPattern(expected, actual, patterns) {
    if (!expected || !actual) return;
    if (expected[0] !== actual[0]) {
        patterns.phonicsPatterns.initialSoundErrors.push({ expected, actual, pattern: 'Initial consonant substitution' });
    }
    if (expected.length > 0 && actual.length > 0 && expected[expected.length - 1] !== actual[actual.length - 1]) {
        patterns.phonicsPatterns.finalSoundErrors.push({ expected, actual, pattern: 'Final sound error' });
    }
    const blends = ['bl', 'cl', 'fl', 'gl', 'pl', 'br', 'cr', 'dr', 'fr', 'gr', 'tr', 'sc', 'sk', 'sp', 'st'];
    blends.forEach(blend => {
        if (expected.includes(blend) && !actual.includes(blend)) {
            patterns.phonicsPatterns.consonantBlends.push({ expected, actual, blend, pattern: 'Consonant blend reduction' });
        }
    });
    const digraphs = ['ch', 'sh', 'th', 'ph', 'wh'];
    digraphs.forEach(digraph => {
        if (expected.includes(digraph) && !actual.includes(digraph)) {
            patterns.phonicsPatterns.digraphs.push({ expected, actual, digraph, pattern: 'Digraph error' });
        }
    });
}

function analyzeReadingStrategy(expected, actual, patterns) {
    if (!expected || !actual) return;
    if (expected[0] === actual[0] && expected.length > 2 && actual.length > 2) {
        const similarity = 1 - levenshteinDistance(expected, actual) / Math.max(expected.length, actual.length);
        if (similarity < 0.5) {
            patterns.readingStrategies.firstLetterGuessing.push({ expected, actual, pattern: 'First letter guessing' });
        }
    }
}

function analyzeSpeechPattern(expected, actual, patterns) {
    if (!expected || !actual) return;
    if (expected.includes('r') && actual.includes('w')) {
        patterns.speechPatterns.rSoundIssues.push({ expected, actual, pattern: 'R → W substitution' });
    }
    if (expected.includes('th') && (actual.includes('d') || actual.includes('t') || actual.includes('f'))) {
        patterns.speechPatterns.thSoundIssues.push({ expected, actual, pattern: 'TH substitution' });
    }
}

function analyzeVisualSimilarity(expected, actual, patterns) {
    if (!expected || !actual) return;
    const visualPairs = [['b', 'd'], ['p', 'q'], ['m', 'n'], ['u', 'n']];
    let isVisual = false;
    visualPairs.forEach(pair => {
        if ((expected.includes(pair[0]) && actual.includes(pair[1])) || (expected.includes(pair[1]) && actual.includes(pair[0]))) {
            isVisual = true;
        }
    });
    if (isVisual) {
        patterns.visualSimilarityErrors.push({ expected, actual, pattern: 'Visual similarity confusion' });
    }
}

function generatePatternSummary(patterns, analysis) {
    const summary = { primaryIssues: [], recommendations: [], severity: 'mild' };
    const totalErrors = (analysis?.errors?.skippedWords?.length || 0) + (analysis?.errors?.misreadWords?.length || 0) + (analysis?.errors?.substitutedWords?.length || 0);

    if (patterns.phonicsPatterns.initialSoundErrors.length >= 3) {
        summary.primaryIssues.push('Consistent initial sound errors');
        summary.recommendations.push('Focus on initial consonant sounds');
    }
    if (patterns.phonicsPatterns.consonantBlends.length >= 2) {
        summary.primaryIssues.push('Difficulty with consonant blends');
        summary.recommendations.push('Practice blending sounds together');
    }
    if (patterns.readingStrategies.firstLetterGuessing.length >= 2) {
        summary.primaryIssues.push('Guessing based on first letter');
        summary.recommendations.push('Encourage sounding out entire word');
    }
    if (patterns.speechPatterns.rSoundIssues.length >= 3 || patterns.speechPatterns.thSoundIssues.length >= 2) {
        summary.primaryIssues.push('Speech sound difficulties detected');
        summary.recommendations.push('Consider speech-language evaluation');
    }

    summary.severity = totalErrors === 0 ? 'excellent' : totalErrors < 5 ? 'mild' : totalErrors < 10 ? 'moderate' : 'significant';
    return summary;
}

// ============ PROSODY METRICS ============
function calculateProsodyMetrics(expectedWords, spokenWordInfo, analysis, recordingDurationSeconds) {
    const metrics = { totalWords: expectedWords.length, wordsRead: analysis.correctCount + (analysis.errors?.misreadWords?.length || 0), accuracy: 0, wpm: 0, prosodyScore: 0, prosodyGrade: '', readingTime: 0 };

    if (spokenWordInfo && spokenWordInfo.length > 0) {
        const first = spokenWordInfo[0];
        const last = spokenWordInfo[spokenWordInfo.length - 1];
        if (first.startTime && last.endTime) {
            metrics.readingTime = parseFloat(last.endTime.replace('s', '')) - parseFloat(first.startTime.replace('s', ''));
        } else {
            metrics.readingTime = recordingDurationSeconds || 0;
        }
    } else {
        metrics.readingTime = recordingDurationSeconds || 0;
    }

    if (metrics.readingTime > 0) {
        metrics.wpm = Math.round(metrics.wordsRead / (metrics.readingTime / 60));
    }
    if (metrics.totalWords > 0) {
        metrics.accuracy = (analysis.correctCount / metrics.totalWords) * 100;
    }

    let accuracyPoints = metrics.accuracy >= 98 ? 4 : metrics.accuracy >= 95 ? 3.5 : metrics.accuracy >= 90 ? 3 : metrics.accuracy >= 85 ? 2.5 : metrics.accuracy >= 75 ? 2 : 1.5;
    let ratePoints = (metrics.wpm >= 100 && metrics.wpm <= 180) ? 4 : (metrics.wpm >= 80 && metrics.wpm <= 200) ? 3.5 : (metrics.wpm >= 60 && metrics.wpm <= 220) ? 3 : 2;
    const totalErrors = (analysis.errors?.skippedWords?.length || 0) + (analysis.errors?.misreadWords?.length || 0) + (analysis.errors?.hesitations?.length || 0);
    const errorRate = metrics.totalWords > 0 ? totalErrors / metrics.totalWords : 0;
    let fluencyPoints = errorRate <= 0.02 ? 4 : errorRate <= 0.05 ? 3.5 : errorRate <= 0.10 ? 3 : errorRate <= 0.20 ? 2.5 : 2;

    metrics.prosodyScore = Math.round((accuracyPoints * 0.4 + ratePoints * 0.3 + fluencyPoints * 0.3) * 10) / 10;
    metrics.prosodyGrade = metrics.prosodyScore >= 3.8 ? 'Excellent' : metrics.prosodyScore >= 3.0 ? 'Proficient' : metrics.prosodyScore >= 2.0 ? 'Developing' : 'Needs Support';

    return metrics;
}

// ============ ANALYSIS & RESULTS ============
if (analyzeBtn) {
    analyzeBtn.addEventListener('click', async () => {
        if (state.selectedWords.size === 0) {
            alert('Please select some words first');
            return;
        }
        showSection('results');
        await performFullAnalysis();
    });
}

async function performFullAnalysis() {
    const resultsContainer = document.getElementById('results-container');
    const selectedIndices = Array.from(state.selectedWords).sort((a, b) => a - b);
    const expectedWords = selectedIndices.map(i => state.ocrData.words[i].text);

    // Show loading
    resultsContainer.innerHTML = '<div class="loading-analysis"><div class="spinner"></div><p>Analyzing pronunciation...</p></div>';

    if (state.audioBlob) {
        try {
            // Get full word info for analysis
            const spokenWordInfo = await runSpeechToText(true);
            const analysis = analyzePronunciation(expectedWords, spokenWordInfo);
            const errorPatterns = analyzeErrorPatterns(analysis, expectedWords);
            const prosodyMetrics = calculateProsodyMetrics(expectedWords, spokenWordInfo, analysis, state.recordingDuration);

            // Store for PDF/video export
            state.latestAnalysis = analysis;
            state.latestExpectedWords = expectedWords;
            state.latestSpokenWords = spokenWordInfo;
            state.latestProsodyMetrics = prosodyMetrics;
            state.latestErrorPatterns = errorPatterns;

            displayPronunciationResults(expectedWords, spokenWordInfo, analysis, prosodyMetrics);
        } catch (error) {
            debugError('Analysis error:', error);
            displayWordCountOnlyResults(expectedWords);
        }
    } else {
        displayWordCountOnlyResults(expectedWords);
    }

    window.updateStudentDropdownAsync();
}

function displayWordCountOnlyResults(expectedWords) {
    const resultsContainer = document.getElementById('results-container');
    resultsContainer.innerHTML = `
        <div class="results-card">
            <h3>Word Count Results</h3>
            <div class="results-stats">
                <div class="result-stat"><span class="stat-value">${expectedWords.length}</span><span class="stat-label">Words Selected</span></div>
            </div>
            <div class="info-box"><p><strong>Word Count Only Mode</strong></p><p>Audio was skipped. Record audio to get accuracy, WPM, and error analysis.</p></div>
            <div class="words-display"><h4>Selected Words</h4><div class="word-chips">${expectedWords.map(w => `<span class="word-chip">${escapeHtml(w)}</span>`).join('')}</div></div>
        </div>
    `;
}

function displayPronunciationResults(expectedWords, spokenWordInfo, analysis, prosodyMetrics) {
    const resultsContainer = document.getElementById('results-container');
    const totalWords = expectedWords.length;
    const correctCount = analysis.correctCount;
    const totalErrors = (analysis.errors?.skippedWords?.length || 0) + (analysis.errors?.misreadWords?.length || 0) + (analysis.errors?.substitutedWords?.length || 0);
    const accuracy = Math.round((correctCount / totalWords) * 100); // Integer, no decimal

    // Build word-by-word display
    let wordsHtml = '';
    analysis.aligned.forEach(item => {
        const safeWord = escapeHtml(item.expected);
        let className = 'word-correct';
        let errorLabel = '';
        if (item.status === 'skipped') { className = 'word-skipped'; errorLabel = '<span class="error-badge">skipped</span>'; }
        else if (item.status === 'misread') { className = 'word-misread'; errorLabel = '<span class="error-badge">misread</span>'; }
        else if (item.status === 'substituted') { className = 'word-substituted'; errorLabel = '<span class="error-badge">substituted</span>'; }
        wordsHtml += `<span class="${className}">${safeWord}${errorLabel}</span> `;
    });

    // Build error breakdown
    let errorBreakdownHtml = '';
    if (analysis.errors.skippedWords.length > 0) {
        errorBreakdownHtml += `<div class="error-category"><strong>Skipped Words (${analysis.errors.skippedWords.length}):</strong> Words not read aloud</div>`;
    }
    if (analysis.errors.misreadWords.length > 0) {
        const list = analysis.errors.misreadWords.map(e => `"${escapeHtml(e.expected)}" → "${escapeHtml(e.spoken)}"`).join(', ');
        errorBreakdownHtml += `<div class="error-category"><strong>Misread Words (${analysis.errors.misreadWords.length}):</strong> ${list}</div>`;
    }
    if (analysis.errors.hesitations.length > 0) {
        errorBreakdownHtml += `<div class="error-category"><strong>Hesitations (${analysis.errors.hesitations.length}):</strong> Pauses or filler words detected</div>`;
    }
    if (analysis.errors.repeatedWords.length > 0) {
        errorBreakdownHtml += `<div class="error-category"><strong>Repeated Words (${analysis.errors.repeatedWords.length}):</strong> Words repeated during reading</div>`;
    }

    resultsContainer.innerHTML = `
        <div class="audio-analysis-result">
            <div class="export-buttons">
                <button id="download-pdf-btn" class="btn btn-export">📄 PDF</button>
                <button id="generate-video-btn" class="btn btn-export">🎬 Video</button>
                <button id="view-patterns-btn" class="btn btn-export">📊 Patterns</button>
                <button id="export-words-btn" class="btn btn-export">📋 Export Words</button>
            </div>
            <div id="video-generation-status" class="video-status"></div>

            <div class="stats-grid">
                <div class="stat-box stat-correct"><div class="stat-number">${correctCount}</div><div class="stat-label">Correct</div></div>
                <div class="stat-box stat-error"><div class="stat-number">${totalErrors}</div><div class="stat-label">Errors</div></div>
                <div class="stat-box stat-accuracy"><div class="stat-number">${accuracy}%</div><div class="stat-label">Accuracy</div></div>
                ${prosodyMetrics ? `<div class="stat-box stat-wpm"><div class="stat-number">${prosodyMetrics.wpm}</div><div class="stat-label">WPM</div></div>
                <div class="stat-box stat-prosody"><div class="stat-number">${prosodyMetrics.prosodyScore}</div><div class="stat-label">${prosodyMetrics.prosodyGrade}</div></div>` : ''}
            </div>

            <div class="pronunciation-text">
                <h4>Text with Error Highlighting:</h4>
                <div class="analyzed-text">${wordsHtml}</div>
                <div class="legend">
                    <span class="legend-item"><span class="word-correct">Green</span> = Correct</span>
                    <span class="legend-item"><span class="word-skipped">Gray</span> = Skipped</span>
                    <span class="legend-item"><span class="word-misread">Orange</span> = Misread</span>
                    <span class="legend-item"><span class="word-substituted">Red</span> = Substituted</span>
                </div>
            </div>

            ${errorBreakdownHtml ? `<div class="error-breakdown"><h4>Error Breakdown:</h4>${errorBreakdownHtml}</div>` : ''}
        </div>
    `;

    // Attach event listeners
    document.getElementById('download-pdf-btn')?.addEventListener('click', downloadAnalysisAsHtml2Pdf);
    document.getElementById('generate-video-btn')?.addEventListener('click', generateTranscriptVideo);
    document.getElementById('view-patterns-btn')?.addEventListener('click', viewDetailedPatterns);
    document.getElementById('export-words-btn')?.addEventListener('click', exportSelectedWords);
}

// ============ EXPORT WORDS ============
function exportSelectedWords() {
    let selectedWordTexts = [];

    if (state.ocrData && state.ocrData.words && state.selectedWords.size > 0) {
        const selectedIndices = Array.from(state.selectedWords).sort((a, b) => a - b);
        selectedWordTexts = selectedIndices.map(index => state.ocrData.words[index].text);
    } else if (state.latestExpectedWords && state.latestExpectedWords.length > 0) {
        selectedWordTexts = state.latestExpectedWords;
    } else {
        alert('No words available to export. Please run an analysis first.');
        return;
    }

    const plainText = selectedWordTexts.join(' ');
    const wordCount = selectedWordTexts.length;

    const fileContent = `Selected Words Export
====================
Word Count: ${wordCount}
Date: ${new Date().toLocaleString()}

--- Words (space-separated) ---
${plainText}

--- Word List ---
${selectedWordTexts.map((word, i) => `${i + 1}. ${word}`).join('\n')}
`;

    const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `selected-words-${wordCount}-words-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============ PDF GENERATION ============
function downloadAnalysisAsHtml2Pdf() {
    if (!state.latestAnalysis || !state.latestExpectedWords) {
        alert('No analysis data available');
        return;
    }

    const pdfBtn = document.getElementById('download-pdf-btn');
    const originalBtnContent = pdfBtn ? pdfBtn.innerHTML : '';
    if (pdfBtn) {
        pdfBtn.disabled = true;
        pdfBtn.innerHTML = '⏳ Generating...';
    }

    const analysis = state.latestAnalysis;
    const prosodyMetrics = state.latestProsodyMetrics || {};
    const patterns = state.latestErrorPatterns;
    const totalErrors = (analysis.errors?.skippedWords?.length || 0) + (analysis.errors?.misreadWords?.length || 0) + (analysis.errors?.substitutedWords?.length || 0);
    const accuracy = analysis.correctCount > 0 ? Math.round((analysis.correctCount / (analysis.correctCount + totalErrors)) * 100) : 0;

    // Build word content
    let wordsContent = '';
    if (analysis.aligned) {
        analysis.aligned.forEach(item => {
            let style = 'color: #28a745;';
            if (item.status === 'skipped') style = 'color: #6c757d; text-decoration: line-through;';
            else if (item.status === 'misread') style = 'color: #fd7e14;';
            else if (item.status === 'substituted') style = 'color: #dc3545;';
            wordsContent += `<span style="${style}">${item.expected}</span> `;
        });
    }

    // Build error sections
    let errorsContent = '';
    if (analysis.errors?.skippedWords?.length > 0) {
        errorsContent += `<div style="background: #fff3cd; padding: 8px; border-radius: 4px; margin-bottom: 6px;"><strong>Skipped Words (${analysis.errors.skippedWords.length}):</strong> Words were not read</div>`;
    }
    if (analysis.errors?.misreadWords?.length > 0) {
        const list = analysis.errors.misreadWords.map(e => `"${e.expected}"`).join(', ');
        errorsContent += `<div style="background: #fff3cd; padding: 8px; border-radius: 4px; margin-bottom: 6px;"><strong>Misread Words (${analysis.errors.misreadWords.length}):</strong> ${list}</div>`;
    }

    // Build summary
    let summaryContent = '';
    if (patterns?.summary?.primaryIssues?.length > 0) {
        summaryContent += `<div style="margin-bottom: 8px;"><strong>Primary Issues:</strong><ul style="margin: 4px 0; padding-left: 20px;">${patterns.summary.primaryIssues.slice(0, 3).map(i => `<li>${i}</li>`).join('')}</ul></div>`;
    }
    if (patterns?.summary?.recommendations?.length > 0) {
        summaryContent += `<div><strong>Recommendations:</strong><ul style="margin: 4px 0; padding-left: 20px;">${patterns.summary.recommendations.slice(0, 3).map(r => `<li>${r}</li>`).join('')}</ul></div>`;
    }

    // Build stats table (not flexbox - flexbox fails on mobile html2canvas)
    let statCount = 3;
    if (prosodyMetrics.wpm) statCount++;
    if (prosodyMetrics.prosodyScore) statCount++;

    let statsHtml = `<table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;"><tr>
        <td style="text-align: center; padding: 10px; background: #f5f5f5; border-radius: 6px;"><div style="font-size: 20px; font-weight: bold; color: #333;">${analysis.correctCount || 0}</div><div style="font-size: 9px; color: #666;">Correct</div></td>
        <td style="width: 8px;"></td>
        <td style="text-align: center; padding: 10px; background: #f5f5f5; border-radius: 6px;"><div style="font-size: 20px; font-weight: bold; color: #333;">${totalErrors}</div><div style="font-size: 9px; color: #666;">Errors</div></td>
        <td style="width: 8px;"></td>
        <td style="text-align: center; padding: 10px; background: #f5f5f5; border-radius: 6px;"><div style="font-size: 20px; font-weight: bold; color: #333;">${accuracy}%</div><div style="font-size: 9px; color: #666;">Accuracy</div></td>
        ${prosodyMetrics.wpm ? `<td style="width: 8px;"></td><td style="text-align: center; padding: 10px; background: #f5f5f5; border-radius: 6px;"><div style="font-size: 20px; font-weight: bold; color: #333;">${prosodyMetrics.wpm}</div><div style="font-size: 9px; color: #666;">WPM</div></td>` : ''}
        ${prosodyMetrics.prosodyScore ? `<td style="width: 8px;"></td><td style="text-align: center; padding: 10px; background: #f5f5f5; border-radius: 6px;"><div style="font-size: 20px; font-weight: bold; color: #333;">${prosodyMetrics.prosodyScore}</div><div style="font-size: 9px; color: #666;">Prosody</div></td>` : ''}
    </tr></table>`;

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || (window.innerWidth <= 768);

    // Create themed overlay to hide PDF generation
    const overlay = document.createElement('div');
    overlay.id = 'pdf-generation-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: linear-gradient(135deg, #1a535c 0%, #4ecdc4 100%); z-index: 100000; display: flex; align-items: center; justify-content: center; flex-direction: column;';
    overlay.innerHTML = `
        <div style="width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: pdfspinner 0.8s linear infinite;"></div>
        <p style="color: white; margin-top: 15px; font-size: 16px; font-weight: 500; font-family: -apple-system, sans-serif;">Generating PDF...</p>
        <style>@keyframes pdfspinner { to { transform: rotate(360deg); } }</style>
    `;
    document.body.appendChild(overlay);

    // Create content for PDF capture (behind overlay)
    const printContainer = document.createElement('div');
    printContainer.id = 'pdf-content-container';
    printContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 794px; background: #ffffff; font-family: Arial, sans-serif; font-size: 11px; line-height: 1.4; color: #333; padding: 57px; box-sizing: border-box; z-index: 99999;';
    printContainer.innerHTML = `
        <h1 style="text-align: center; color: #1a535c; font-size: 18px; margin: 0 0 5px 0;">Oral Fluency Analysis Report</h1>
        <div style="text-align: center; color: #666; font-size: 10px; margin-bottom: 15px;">Generated on ${new Date().toLocaleDateString()}</div>
        ${statsHtml}
        <div style="font-size: 13px; font-weight: bold; color: #1a535c; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin: 12px 0 8px 0;">Text with Error Highlighting</div>
        <div style="line-height: 1.8; margin-bottom: 8px;">${wordsContent}</div>
        <div style="font-size: 9px; color: #666; margin-bottom: 15px;">
            <span style="color:#28a745; margin-right: 10px;">■ Correct</span>
            <span style="color:#6c757d; margin-right: 10px;">■ Skipped</span>
            <span style="color:#fd7e14; margin-right: 10px;">■ Misread</span>
            <span style="color:#dc3545;">■ Substituted</span>
        </div>
        ${errorsContent ? `<div style="font-size: 13px; font-weight: bold; color: #1a535c; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin: 12px 0 8px 0;">Error Breakdown</div>${errorsContent}` : ''}
        ${summaryContent ? `<div style="font-size: 13px; font-weight: bold; color: #1a535c; border-bottom: 1px solid #ddd; padding-bottom: 3px; margin: 12px 0 8px 0;">Summary & Recommendations</div><div style="background: #e8f4fd; padding: 10px; border-radius: 4px; font-size: 10px;">${summaryContent}</div>` : ''}
        <div style="text-align: center; color: #999; font-size: 8px; margin-top: 20px; font-style: italic;">Generated by Word Analyzer V2</div>
    `;
    document.body.appendChild(printContainer);

    setTimeout(() => {
        const scale = isMobile ? 1.5 : 2;
        const options = {
            margin: 0,
            filename: `oral-fluency-analysis-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.pdf`,
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: { scale, useCORS: true, logging: false, scrollX: 0, scrollY: 0, x: 0, y: 0, width: 794, height: printContainer.scrollHeight, windowWidth: 794, windowHeight: printContainer.scrollHeight, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: 'avoid-all' }
        };

        html2pdf().set(options).from(printContainer).outputPdf('blob')
            .then(blob => {
                const pdfUrl = URL.createObjectURL(blob);
                window.open(pdfUrl, '_blank');
                const downloadLink = document.createElement('a');
                downloadLink.href = pdfUrl;
                downloadLink.download = options.filename;
                downloadLink.click();
                if (printContainer.parentNode) document.body.removeChild(printContainer);
                if (overlay.parentNode) document.body.removeChild(overlay);
                if (pdfBtn) { pdfBtn.disabled = false; pdfBtn.innerHTML = originalBtnContent; }
            })
            .catch(err => {
                debugError('PDF generation error:', err);
                if (printContainer.parentNode) document.body.removeChild(printContainer);
                if (overlay.parentNode) document.body.removeChild(overlay);
                if (pdfBtn) { pdfBtn.disabled = false; pdfBtn.innerHTML = originalBtnContent; }
                alert('Failed to generate PDF: ' + err.message);
            });
    }, 200);
}

// ============ VIDEO GENERATION ============
async function generateTranscriptVideo() {
    if (!state.latestAnalysis || !state.latestSpokenWords) {
        alert('No analysis data available');
        return;
    }
    if (!state.recordedAudioBlob) {
        alert('No audio recording available for video generation');
        return;
    }

    const statusDiv = document.getElementById('video-generation-status');
    const generateBtn = document.getElementById('generate-video-btn');

    try {
        if (generateBtn) generateBtn.disabled = true;
        if (statusDiv) { statusDiv.innerHTML = '<div class="video-progress">🎬 Loading video generator...</div>'; statusDiv.style.display = 'block'; }

        const { generateVideo } = await import('./modules/video-generator.js');
        await generateVideo(state, statusDiv, generateBtn);
    } catch (error) {
        debugError('Error loading video generator:', error);
        if (statusDiv) statusDiv.innerHTML = `<div class="error">Error: ${error.message}</div>`;
        if (generateBtn) generateBtn.disabled = false;
    }
}

// ============ VIEW DETAILED PATTERNS ============
function viewDetailedPatterns() {
    if (!state.latestErrorPatterns) {
        alert('No error pattern data available. Please run an analysis first.');
        return;
    }

    const patterns = state.latestErrorPatterns;
    const analysis = state.latestAnalysis;
    const prosody = state.latestProsodyMetrics;
    const totalErrors = (analysis?.errors?.skippedWords?.length || 0) + (analysis?.errors?.misreadWords?.length || 0) + (analysis?.errors?.substitutedWords?.length || 0);
    const accuracy = analysis?.correctCount ? Math.round((analysis.correctCount / (analysis.correctCount + totalErrors)) * 100) : 0;

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Detailed Error Patterns</title>
    <style>
        body { font-family: -apple-system, sans-serif; line-height: 1.6; color: #333; background: #f5f5f5; padding: 20px; }
        .container { max-width: 900px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #1a535c 0%, #4ecdc4 100%); color: white; padding: 24px; text-align: center; }
        .header h1 { margin: 0 0 8px 0; }
        .section { padding: 20px 24px; border-bottom: 1px solid #eee; }
        .stats { display: flex; gap: 20px; flex-wrap: wrap; }
        .stat-box { background: #f8f9ff; padding: 15px; border-radius: 8px; text-align: center; flex: 1; min-width: 100px; }
        .stat-box .value { font-size: 1.5rem; font-weight: bold; color: #1a535c; }
        .stat-box .label { font-size: 0.85rem; color: #666; }
        .issue-list { background: #fff3cd; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .issue-list h4 { color: #856404; margin: 0 0 10px 0; }
        .rec-list { background: #d4edda; padding: 15px; border-radius: 8px; }
        .rec-list h4 { color: #155724; margin: 0 0 10px 0; }
        ul { margin: 0; padding-left: 20px; }
        li { margin-bottom: 5px; }
        .pattern-section { background: #fafafa; padding: 15px; border-radius: 8px; margin-bottom: 10px; }
        .pattern-section h4 { margin: 0 0 10px 0; color: #1a535c; }
        .print-btn { position: fixed; top: 20px; right: 20px; background: #1a535c; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; }
        @media print { .print-btn { display: none; } }
    </style></head><body>
    <button class="print-btn" onclick="window.print()">Print Report</button>
    <div class="container">
        <div class="header"><h1>Detailed Error Patterns Report</h1><p>Comprehensive Analysis of Reading Errors</p></div>
        <div class="section"><h3>Overview</h3><div class="stats">
            <div class="stat-box"><div class="value">${accuracy}%</div><div class="label">Accuracy</div></div>
            <div class="stat-box"><div class="value">${prosody?.wpm || '-'}</div><div class="label">WPM</div></div>
            <div class="stat-box"><div class="value">${prosody?.prosodyScore || '-'}</div><div class="label">Prosody</div></div>
            <div class="stat-box"><div class="value">${totalErrors}</div><div class="label">Total Errors</div></div>
        </div></div>
        <div class="section"><h3>Summary</h3>
            ${patterns.summary?.primaryIssues?.length > 0 ? `<div class="issue-list"><h4>Primary Issues</h4><ul>${patterns.summary.primaryIssues.map(i => `<li>${i}</li>`).join('')}</ul></div>` : '<p>No significant issues identified</p>'}
            ${patterns.summary?.recommendations?.length > 0 ? `<div class="rec-list"><h4>Recommendations</h4><ul>${patterns.summary.recommendations.map(r => `<li>${r}</li>`).join('')}</ul></div>` : ''}
        </div>
        <div class="section"><h3>Phonics Patterns</h3>
            ${patterns.phonicsPatterns.initialSoundErrors.length > 0 ? `<div class="pattern-section"><h4>Initial Sound Errors (${patterns.phonicsPatterns.initialSoundErrors.length})</h4><ul>${patterns.phonicsPatterns.initialSoundErrors.slice(0,5).map(e => `<li>"${e.expected}" → "${e.actual}"</li>`).join('')}</ul></div>` : ''}
            ${patterns.phonicsPatterns.consonantBlends.length > 0 ? `<div class="pattern-section"><h4>Consonant Blend Issues (${patterns.phonicsPatterns.consonantBlends.length})</h4><ul>${patterns.phonicsPatterns.consonantBlends.slice(0,5).map(e => `<li>"${e.expected}" → "${e.actual}"</li>`).join('')}</ul></div>` : ''}
            ${patterns.phonicsPatterns.digraphs.length > 0 ? `<div class="pattern-section"><h4>Digraph Issues (${patterns.phonicsPatterns.digraphs.length})</h4><ul>${patterns.phonicsPatterns.digraphs.slice(0,5).map(e => `<li>"${e.expected}" → "${e.actual}"</li>`).join('')}</ul></div>` : ''}
            ${Object.values(patterns.phonicsPatterns).every(arr => arr.length === 0) ? '<p>No phonics pattern errors detected</p>' : ''}
        </div>
        <div class="section"><h3>Speech Patterns</h3>
            ${patterns.speechPatterns.rSoundIssues.length > 0 ? `<div class="pattern-section"><h4>R Sound Issues (${patterns.speechPatterns.rSoundIssues.length})</h4><ul>${patterns.speechPatterns.rSoundIssues.slice(0,5).map(e => `<li>"${e.expected}" → "${e.actual}"</li>`).join('')}</ul></div>` : ''}
            ${patterns.speechPatterns.thSoundIssues.length > 0 ? `<div class="pattern-section"><h4>TH Sound Issues (${patterns.speechPatterns.thSoundIssues.length})</h4><ul>${patterns.speechPatterns.thSoundIssues.slice(0,5).map(e => `<li>"${e.expected}" → "${e.actual}"</li>`).join('')}</ul></div>` : ''}
            ${Object.values(patterns.speechPatterns).every(arr => arr.length === 0) ? '<p>No speech pattern issues detected</p>' : ''}
        </div>
        <div class="section" style="text-align: center; color: #999; font-size: 0.85rem;">Generated by Word Analyzer V2 on ${new Date().toLocaleString()}</div>
    </div></body></html>`;

    const newWindow = window.open('', '_blank');
    if (newWindow) {
        newWindow.document.write(html);
        newWindow.document.close();
    } else {
        alert('Pop-up blocked. Please allow pop-ups for this site.');
    }
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

        const selectedTexts = Array.from(state.selectedWords).map(i => state.ocrData.words[i].text);
        const analysis = state.latestAnalysis;
        const prosodyMetrics = state.latestProsodyMetrics;

        // Build assessment data with full analysis for historical viewing
        const assessmentData = {
            totalWords: state.selectedWords.size,
            wordList: selectedTexts,
            accuracy: prosodyMetrics?.accuracy || (analysis ? ((analysis.correctCount / state.selectedWords.size) * 100) : 100),
            wpm: prosodyMetrics?.wpm || 0,
            prosodyScore: prosodyMetrics?.prosodyScore || 0,
            correctCount: analysis?.correctCount || state.selectedWords.size,
            errors: {
                skippedWords: analysis?.errors?.skippedWords?.map(i => selectedTexts[i]) || [],
                misreadWords: analysis?.errors?.misreadWords || [],
                substitutedWords: analysis?.errors?.substitutedWords || [],
                hesitations: analysis?.errors?.hesitations?.length || 0,
                repeatedWords: analysis?.errors?.repeatedWords?.length || 0
            },
            // Full data for historical viewing
            expectedWords: state.latestExpectedWords || selectedTexts,
            aligned: analysis?.aligned || null,
            spokenWords: state.latestSpokenWords || [],
            prosodyMetrics: prosodyMetrics || null,
            errorPatterns: state.latestErrorPatterns || null
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

// New assessment
const newAssessmentBtn = document.getElementById('start-new-analysis-btn');
if (newAssessmentBtn) {
    newAssessmentBtn.addEventListener('click', () => {
        state.audioBlob = null;
        state.capturedImage = null;
        state.ocrData = null;
        state.selectedWords.clear();

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

if (backFromClassBtn) backFromClassBtn.addEventListener('click', () => showSection('audio'));
if (addStudentBtn) addStudentBtn.addEventListener('click', () => addStudentModal.classList.add('active'));
if (quickAddStudentBtn) quickAddStudentBtn.addEventListener('click', () => addStudentModal.classList.add('active'));
if (cancelAddStudentBtn) cancelAddStudentBtn.addEventListener('click', () => addStudentModal.classList.remove('active'));

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
let currentViewingStudentId = null;

window.showStudentProfileAsync = async function(studentId) {
    const student = await FirebaseDB.getStudent(studentId);
    if (!student) return;

    state.currentStudentId = studentId;
    currentViewingStudentId = studentId;

    document.getElementById('student-profile-name').textContent = student.name;
    document.getElementById('student-profile-subtitle').textContent = `${student.grade || 'No grade set'} • ${student.assessments?.length || 0} assessment${(student.assessments?.length || 0) !== 1 ? 's' : ''}`;
    document.getElementById('profile-avatar').textContent = student.name.charAt(0).toUpperCase();

    const stats = FirebaseDB.getStudentStats(student);
    document.getElementById('student-stats-summary').innerHTML = `
        <div class="stat-card"><span class="stat-value">${stats.totalAssessments}</span><span class="stat-label">Assessments</span></div>
        <div class="stat-card"><span class="stat-value">${stats.avgAccuracy}%</span><span class="stat-label">Avg Accuracy</span></div>
        <div class="stat-card"><span class="stat-value">${stats.avgWpm}</span><span class="stat-label">Avg WPM</span></div>
        <div class="stat-card"><span class="stat-value">${stats.avgProsody}</span><span class="stat-label">Avg Prosody</span></div>
    `;

    // Render assessment history with View/Delete buttons
    renderAssessmentHistory(student);

    // Render progress chart and pattern analysis after a short delay
    setTimeout(() => {
        renderProgressChart(student);
        renderAggregatedPatterns(student);
    }, 100);

    showSection('student-profile');
};

// Render assessment history with action buttons
function renderAssessmentHistory(student) {
    const historyContainer = document.getElementById('assessment-history');
    if (!student.assessments || student.assessments.length === 0) {
        historyContainer.innerHTML = '<p class="no-assessments">No assessments yet. Complete an assessment and save it to this student\'s profile.</p>';
        return;
    }

    const sortedAssessments = [...student.assessments].sort((a, b) => b.date - a.date);

    historyContainer.innerHTML = '<h3>Assessment History</h3>' + sortedAssessments.map(a => {
        const date = new Date(a.date);
        const dateStr = date.toLocaleDateString() + ' at ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const accuracy = a.accuracy || 0;
        const totalErrors = (a.errors?.skippedWords?.length || 0) + (a.errors?.misreadWords?.length || 0) + (a.errors?.substitutedWords?.length || 0);
        const hasDetailedData = a.expectedWords && a.aligned;

        return `
            <div class="assessment-item">
                <div class="assessment-header">
                    <span class="assessment-date">${dateStr}</span>
                    <span class="assessment-score ${getAccuracyClassification(accuracy)}">${accuracy.toFixed(1)}%</span>
                </div>
                <div class="assessment-details">
                    <span>Correct: ${a.correctCount || 0}</span>
                    <span>Total: ${a.totalWords || 0}</span>
                    <span>Errors: ${totalErrors}</span>
                    <span>WPM: ${a.wpm || 'N/A'}</span>
                    <span>Prosody: ${a.prosodyScore?.toFixed(1) || 'N/A'}</span>
                </div>
                <div class="assessment-actions">
                    <button class="btn btn-primary btn-small view-assessment-btn" data-assessment-id="${a.id}" ${!hasDetailedData ? 'disabled title="Old assessment - no detailed data"' : ''}>View Details</button>
                    <button class="btn btn-danger btn-small delete-assessment-btn" data-assessment-id="${a.id}">Delete</button>
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners
    document.querySelectorAll('.view-assessment-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const assessmentId = btn.getAttribute('data-assessment-id');
            viewHistoricalAssessment(currentViewingStudentId, assessmentId);
        });
    });

    document.querySelectorAll('.delete-assessment-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const assessmentId = btn.getAttribute('data-assessment-id');
            if (confirm('Are you sure you want to delete this assessment?')) {
                await FirebaseDB.deleteAssessment(currentViewingStudentId, assessmentId);
                window.showStudentProfileAsync(currentViewingStudentId);
            }
        });
    });
}

// View historical assessment details
async function viewHistoricalAssessment(studentId, assessmentId) {
    const student = await FirebaseDB.getStudent(studentId);
    if (!student) { alert('Student not found'); return; }

    const assessment = student.assessments.find(a => a.id === assessmentId);
    if (!assessment) { alert('Assessment not found'); return; }

    if (!assessment.expectedWords || !assessment.aligned) {
        alert('This assessment was created before detailed viewing was available. Only summary data is shown.');
        return;
    }

    // Load historical data into state
    state.latestExpectedWords = assessment.expectedWords;
    state.latestSpokenWords = assessment.spokenWords || [];
    state.latestProsodyMetrics = assessment.prosodyMetrics || { wpm: assessment.wpm, prosodyScore: assessment.prosodyScore };
    state.latestAnalysis = { aligned: assessment.aligned, errors: assessment.errors, correctCount: assessment.correctCount };
    state.latestErrorPatterns = assessment.errorPatterns || null;
    state.viewingHistoricalAssessment = true;
    state.historicalAssessmentStudentId = studentId;

    // Display the results
    displayPronunciationResults(state.latestExpectedWords, state.latestSpokenWords, state.latestAnalysis, state.latestProsodyMetrics);

    showSection('results');

    // Show historical banner and hide save card
    const historicalBanner = document.getElementById('historical-assessment-banner');
    const saveCard = document.querySelector('.save-card');
    const studentNameSpan = document.getElementById('historical-student-name');
    const dateSpan = document.getElementById('historical-assessment-date');

    if (historicalBanner) {
        historicalBanner.style.display = 'flex';
        if (studentNameSpan) studentNameSpan.textContent = student.name;
        if (dateSpan) dateSpan.textContent = new Date(assessment.date).toLocaleDateString();
    }
    if (saveCard) saveCard.style.display = 'none';
}

// Render progress chart
function renderProgressChart(student) {
    const canvas = document.getElementById('progress-chart');
    if (!canvas || !student.assessments || student.assessments.length === 0) {
        if (canvas) canvas.style.display = 'none';
        return;
    }
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.parentElement.offsetWidth * 2;
    const height = canvas.height = 400;

    ctx.clearRect(0, 0, width, height);

    const sortedAssessments = [...student.assessments].sort((a, b) => a.date - b.date);
    const count = sortedAssessments.length;
    if (count === 0) return;

    const padding = 60;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    // Background
    ctx.fillStyle = '#f9fafb';
    ctx.fillRect(padding, padding, chartWidth, chartHeight);

    // Grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
        const y = padding + (chartHeight / 10) * i;
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(padding + chartWidth, y);
        ctx.stroke();
    }

    // Data
    const accuracyData = sortedAssessments.map(a => a.accuracy || 0);
    const wpmData = sortedAssessments.map(a => Math.min((a.wpm || 0) / 2, 100));
    const prosodyData = sortedAssessments.map(a => (a.prosodyScore || 0) * 25);

    // Axes
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, padding + chartHeight);
    ctx.lineTo(padding + chartWidth, padding + chartHeight);
    ctx.stroke();

    // Y labels
    ctx.fillStyle = '#374151';
    ctx.font = '24px Arial';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 10; i++) {
        const y = padding + (chartHeight / 10) * i;
        ctx.fillText(100 - i * 10, padding - 10, y);
    }

    // X labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '20px Arial';
    for (let i = 0; i < count; i++) {
        const x = padding + (chartWidth / (count - 1 || 1)) * i;
        const date = new Date(sortedAssessments[i].date);
        ctx.fillText(`${date.getMonth() + 1}/${date.getDate()}`, x, padding + chartHeight + 15);
    }

    // Draw lines helper
    function drawLine(data, color) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        data.forEach((value, i) => {
            const x = padding + (chartWidth / (count - 1 || 1)) * i;
            const y = padding + chartHeight - (value / 100) * chartHeight;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.fillStyle = color;
        data.forEach((value, i) => {
            const x = padding + (chartWidth / (count - 1 || 1)) * i;
            const y = padding + chartHeight - (value / 100) * chartHeight;
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();
        });
    }

    drawLine(accuracyData, '#10b981');
    drawLine(wpmData, '#3b82f6');
    drawLine(prosodyData, '#8b5cf6');

    // Title
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#111827';
    ctx.fillText('Progress Over Time', padding, 35);

    // Legend
    const legendItems = [{ label: 'Accuracy', color: '#10b981' }, { label: 'WPM (÷2)', color: '#3b82f6' }, { label: 'Prosody (×25)', color: '#8b5cf6' }];
    ctx.font = 'bold 18px Arial';
    let lx = width - padding - 350;
    legendItems.forEach(item => {
        ctx.fillStyle = item.color;
        ctx.fillRect(lx, 28, 14, 14);
        ctx.fillStyle = '#374151';
        ctx.textAlign = 'left';
        ctx.fillText(item.label, lx + 20, 35);
        lx += 120;
    });
}

// Aggregate error patterns across all assessments
function aggregateErrorPatterns(student) {
    const aggregated = {
        totalAssessments: student.assessments?.length || 0,
        assessmentsWithPatterns: 0,
        phonicsPatterns: { initialSoundErrors: 0, finalSoundErrors: 0, vowelPatterns: 0, consonantBlends: 0, rControlledVowels: 0, silentLetters: 0, digraphs: 0 },
        readingStrategies: { firstLetterGuessing: 0, partialDecoding: 0, contextGuessing: 0 },
        speechPatterns: { rSoundIssues: 0, sSoundIssues: 0, lSoundIssues: 0, thSoundIssues: 0 },
        primaryIssues: {},
        severityCounts: { excellent: 0, mild: 0, moderate: 0, significant: 0 }
    };

    (student.assessments || []).forEach(assessment => {
        if (assessment.errorPatterns) {
            aggregated.assessmentsWithPatterns++;
            const p = assessment.errorPatterns;

            aggregated.phonicsPatterns.initialSoundErrors += p.phonicsPatterns?.initialSoundErrors?.length || 0;
            aggregated.phonicsPatterns.finalSoundErrors += p.phonicsPatterns?.finalSoundErrors?.length || 0;
            aggregated.phonicsPatterns.vowelPatterns += p.phonicsPatterns?.vowelPatterns?.length || 0;
            aggregated.phonicsPatterns.consonantBlends += p.phonicsPatterns?.consonantBlends?.length || 0;
            aggregated.phonicsPatterns.digraphs += p.phonicsPatterns?.digraphs?.length || 0;

            aggregated.readingStrategies.firstLetterGuessing += p.readingStrategies?.firstLetterGuessing?.length || 0;

            aggregated.speechPatterns.rSoundIssues += p.speechPatterns?.rSoundIssues?.length || 0;
            aggregated.speechPatterns.thSoundIssues += p.speechPatterns?.thSoundIssues?.length || 0;

            (p.summary?.primaryIssues || []).forEach(issue => {
                aggregated.primaryIssues[issue] = (aggregated.primaryIssues[issue] || 0) + 1;
            });

            if (p.summary?.severity) aggregated.severityCounts[p.summary.severity]++;
        }
    });

    return aggregated;
}

// Generate insights from aggregated patterns
function generateMacroInsights(aggregated) {
    const insights = [];

    if (aggregated.assessmentsWithPatterns === 0) {
        return ['No detailed pattern data yet. Complete new assessments to see insights.'];
    }

    const totalPhonics = Object.values(aggregated.phonicsPatterns).reduce((a, b) => a + b, 0);
    if (totalPhonics > 0) {
        const avgPer = (totalPhonics / aggregated.assessmentsWithPatterns).toFixed(1);
        const issues = [
            { name: 'Initial sounds', count: aggregated.phonicsPatterns.initialSoundErrors },
            { name: 'Final sounds', count: aggregated.phonicsPatterns.finalSoundErrors },
            { name: 'Consonant blends', count: aggregated.phonicsPatterns.consonantBlends }
        ].filter(i => i.count > 0).sort((a, b) => b.count - a.count).slice(0, 2);

        if (issues.length > 0) {
            insights.push(`📚 Common phonics challenges: ${issues.map(i => i.name).join(', ')} (avg ${avgPer}/assessment)`);
        }
    }

    if (aggregated.readingStrategies.firstLetterGuessing >= aggregated.assessmentsWithPatterns * 2) {
        insights.push(`🎯 Student relies on guessing strategies - focus on systematic phonics`);
    }

    const totalSpeech = Object.values(aggregated.speechPatterns).reduce((a, b) => a + b, 0);
    if (totalSpeech >= aggregated.assessmentsWithPatterns * 2) {
        insights.push(`🗣️ Speech pattern issues detected - consider speech-language evaluation`);
    }

    if (aggregated.severityCounts.excellent > aggregated.totalAssessments * 0.3) {
        insights.push(`✨ Strong performance - ${Math.round(aggregated.severityCounts.excellent / aggregated.totalAssessments * 100)}% excellent accuracy`);
    }

    if (aggregated.severityCounts.significant > aggregated.totalAssessments * 0.3) {
        insights.push(`⚠️ ${Math.round(aggregated.severityCounts.significant / aggregated.totalAssessments * 100)}% significant challenges - intensive support recommended`);
    }

    const topIssue = Object.entries(aggregated.primaryIssues).sort((a, b) => b[1] - a[1])[0];
    if (topIssue && topIssue[1] >= aggregated.assessmentsWithPatterns * 0.5) {
        insights.push(`🔍 Persistent: "${topIssue[0]}" in ${topIssue[1]} of ${aggregated.assessmentsWithPatterns} assessments`);
    }

    return insights.length > 0 ? insights : ['Continue regular assessments to identify patterns.'];
}

// Render aggregated patterns section
function renderAggregatedPatterns(student) {
    const section = document.getElementById('aggregated-patterns-section');
    if (!section) return;

    const aggregated = aggregateErrorPatterns(student);
    const insights = generateMacroInsights(aggregated);

    if (aggregated.assessmentsWithPatterns === 0) {
        section.innerHTML = `
            <div class="pattern-analysis-card">
                <h3>Pattern Analysis</h3>
                <p class="pattern-note">Complete assessments to see error pattern analysis and insights.</p>
            </div>
        `;
        return;
    }

    const createPatternItem = (label, count) => count > 0 ? `<div class="pattern-item"><span class="pattern-label">${label}</span><span class="pattern-count">${count}</span></div>` : '';

    const phonicsHtml = [
        createPatternItem('Initial Sounds', aggregated.phonicsPatterns.initialSoundErrors),
        createPatternItem('Final Sounds', aggregated.phonicsPatterns.finalSoundErrors),
        createPatternItem('Consonant Blends', aggregated.phonicsPatterns.consonantBlends),
        createPatternItem('Digraphs', aggregated.phonicsPatterns.digraphs)
    ].filter(h => h).join('');

    const speechHtml = [
        createPatternItem('R Sound', aggregated.speechPatterns.rSoundIssues),
        createPatternItem('TH Sound', aggregated.speechPatterns.thSoundIssues)
    ].filter(h => h).join('');

    section.innerHTML = `
        <div class="pattern-analysis-card">
            <h3>Pattern Analysis Across ${aggregated.assessmentsWithPatterns} Assessment${aggregated.assessmentsWithPatterns > 1 ? 's' : ''}</h3>
            <div class="macro-insights">
                <h4>Key Insights:</h4>
                <ul class="insights-list">${insights.map(i => `<li>${i}</li>`).join('')}</ul>
            </div>
            ${phonicsHtml ? `<div class="pattern-breakdown"><h4>Phonics Patterns:</h4><div class="pattern-grid">${phonicsHtml}</div></div>` : ''}
            ${speechHtml ? `<div class="pattern-breakdown"><h4>Speech Patterns:</h4><div class="pattern-grid">${speechHtml}</div></div>` : ''}
        </div>
    `;
}

if (backToClassBtn) {
    backToClassBtn.addEventListener('click', async () => {
        await window.renderStudentsGridAsync();
        showSection('class-overview');
    });
}

// Back to student profile from historical assessment view
const backToProfileBtn = document.getElementById('back-to-profile-btn');
if (backToProfileBtn) {
    backToProfileBtn.addEventListener('click', () => {
        // Reset historical viewing state
        state.viewingHistoricalAssessment = false;

        // Hide banner and show save card again
        const historicalBanner = document.getElementById('historical-assessment-banner');
        const saveCard = document.querySelector('.save-card');
        if (historicalBanner) historicalBanner.style.display = 'none';
        if (saveCard) saveCard.style.display = '';

        // Go back to student profile
        if (state.historicalAssessmentStudentId) {
            window.showStudentProfileAsync(state.historicalAssessmentStudentId);
        }
    });
}

if (deleteStudentBtn) {
    deleteStudentBtn.addEventListener('click', async () => {
        if (!state.currentStudentId) return;
        if (confirm('Are you sure you want to delete this student?')) {
            await FirebaseDB.deleteStudent(state.currentStudentId);
            state.currentStudentId = null;
            await window.renderStudentsGridAsync();
            showSection('class-overview');
        }
    });
}

// ============ SIDEBAR NAVIGATION ============
progressSteps.forEach(step => {
    step.addEventListener('click', () => {
        const stepName = step.getAttribute('data-step');
        const mapping = { 'setup': 'setup', 'audio': 'audio', 'capture': 'camera', 'highlight': 'image', 'results': 'results' };
        if (mapping[stepName]) showSection(mapping[stepName]);
    });
});

const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const sidebar = document.querySelector('.sidebar');
if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', () => sidebar.classList.toggle('open'));

const newAssessmentSidebarBtn = document.getElementById('new-assessment-btn');
if (newAssessmentSidebarBtn) {
    newAssessmentSidebarBtn.addEventListener('click', () => {
        state.audioBlob = null;
        state.capturedImage = null;
        state.selectedWords.clear();
        showSection('audio');
    });
}

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
                state.currentStudentId = studentId;
                currentStudentName.textContent = student.name;
                studentInitial.textContent = student.name.charAt(0).toUpperCase();
                currentStudentDisplay.style.display = 'flex';
            }
        } else {
            state.currentStudentId = null;
            currentStudentDisplay.style.display = 'none';
        }
    });
}

// ============ DYNAMIC STYLES ============
const styleSheet = document.createElement('style');
styleSheet.textContent = `
    /* FIX #2: Constrain canvas width on mobile */
    .canvas-wrapper {
        overflow: auto;
        max-width: 100%;
    }

    .canvas-wrapper canvas {
        max-width: 100%;
        height: auto !important;
        touch-action: none;
    }

    /* Camera preview styling */
    #camera-canvas {
        max-width: 100%;
        height: auto;
    }

    .results-card { background: white; border-radius: var(--radius-lg); padding: var(--space-2xl); box-shadow: var(--shadow-md); margin-bottom: var(--space-xl); }
    .results-card h3 { text-align: center; margin-bottom: var(--space-xl); color: var(--color-primary); }
    .results-stats { display: flex; justify-content: center; gap: var(--space-xl); margin-bottom: var(--space-2xl); }
    .result-stat { text-align: center; }
    .result-stat .stat-value { display: block; font-family: var(--font-display); font-size: 3rem; font-weight: 700; color: var(--color-primary); }
    .result-stat .stat-label { color: var(--color-slate); font-size: 0.9rem; }
    .words-display { background: var(--color-paper); padding: var(--space-lg); border-radius: var(--radius-md); }
    .words-display h4 { margin-bottom: var(--space-md); color: var(--color-charcoal); }
    .word-chips { display: flex; flex-wrap: wrap; gap: var(--space-sm); }
    .word-chip { background: white; padding: var(--space-xs) var(--space-md); border-radius: 100px; font-size: 0.875rem; border: 1px solid var(--color-sand); }
    .stat-card { background: white; border-radius: var(--radius-md); padding: var(--space-lg); text-align: center; box-shadow: var(--shadow-sm); }
    .stat-card .stat-value { display: block; font-family: var(--font-display); font-size: 2rem; font-weight: 700; color: var(--color-primary); margin-bottom: var(--space-xs); }
    .stat-card .stat-label { font-size: 0.8rem; color: var(--color-slate); text-transform: uppercase; letter-spacing: 0.05em; }
    .assessment-item { background: white; border-radius: var(--radius-md); padding: var(--space-lg); margin-bottom: var(--space-md); box-shadow: var(--shadow-sm); }
    .assessment-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--space-md); }
    .assessment-date { font-weight: 600; color: var(--color-primary); }
    .assessment-score { font-family: var(--font-display); font-size: 1.25rem; font-weight: 700; padding: var(--space-xs) var(--space-md); border-radius: var(--radius-sm); }
    .assessment-score.excellent { background: rgba(74, 222, 128, 0.2); color: var(--color-success-dark); }
    .assessment-score.good { background: rgba(56, 189, 248, 0.2); color: #0284c7; }
    .assessment-score.fair { background: rgba(251, 191, 36, 0.2); color: #d97706; }
    .assessment-score.poor { background: rgba(239, 68, 68, 0.2); color: var(--color-error); }
    .assessment-details { display: flex; gap: var(--space-lg); color: var(--color-slate); font-size: 0.9rem; }
    .no-assessments { text-align: center; padding: var(--space-2xl); color: var(--color-slate); }
    .empty-state { text-align: center; padding: var(--space-3xl); background: white; border-radius: var(--radius-lg); grid-column: 1 / -1; }
    .empty-icon { width: 64px; height: 64px; margin: 0 auto var(--space-lg); color: var(--color-stone); }
    .empty-icon svg { width: 100%; height: 100%; }
    .empty-state h3 { margin-bottom: var(--space-sm); }
    .empty-state p { color: var(--color-slate); margin: 0; }

    /* Analysis Results Styles */
    .audio-analysis-result { background: white; border-radius: var(--radius-lg); padding: var(--space-2xl); box-shadow: var(--shadow-md); }
    .export-buttons { display: flex; flex-wrap: wrap; gap: var(--space-md); margin-bottom: var(--space-xl); justify-content: center; }
    .btn-export { background: var(--color-primary); color: white; border: none; padding: var(--space-md) var(--space-lg); border-radius: var(--radius-md); cursor: pointer; font-weight: 600; transition: all 0.2s; }
    .btn-export:hover { background: var(--color-primary-dark, #155a66); transform: translateY(-1px); }
    .btn-export:disabled { background: var(--color-stone); cursor: not-allowed; }
    .video-status { margin-bottom: var(--space-lg); text-align: center; }
    .video-progress { color: var(--color-primary); font-weight: 500; }
    .video-complete { color: var(--color-success-dark, #166534); font-weight: 500; }
    .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--space-sm); margin-bottom: var(--space-xl); }
    @media (max-width: 600px) { .stats-grid { grid-template-columns: repeat(3, 1fr); } }
    .stat-box { background: var(--color-paper); border-radius: var(--radius-md); padding: var(--space-md); text-align: center; min-width: 0; }
    .stat-box .stat-number { font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; color: var(--color-primary); white-space: nowrap; }
    .stat-box .stat-label { font-size: 0.7rem; color: var(--color-slate); text-transform: uppercase; letter-spacing: 0.02em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .stat-correct { border-left: 4px solid var(--color-success, #22c55e); }
    .stat-error { border-left: 4px solid var(--color-error, #ef4444); }
    .stat-accuracy { border-left: 4px solid var(--color-primary); }
    .stat-wpm { border-left: 4px solid var(--color-accent, #ff6b6b); }
    .stat-prosody { border-left: 4px solid #8b5cf6; }
    .pronunciation-text { background: var(--color-paper); padding: var(--space-lg); border-radius: var(--radius-md); margin-bottom: var(--space-xl); }
    .pronunciation-text h4 { margin-bottom: var(--space-md); color: var(--color-charcoal); }
    .analyzed-text { line-height: 2.2; font-size: 1.1rem; }
    .analyzed-text span { display: inline; padding: 2px 4px; border-radius: 4px; margin: 2px; }
    .word-correct { color: #166534; background: rgba(34, 197, 94, 0.15); }
    .word-skipped { color: #6c757d; background: rgba(108, 117, 125, 0.15); text-decoration: line-through; }
    .word-misread { color: #c2410c; background: rgba(249, 115, 22, 0.15); }
    .word-substituted { color: #dc2626; background: rgba(239, 68, 68, 0.15); }
    .error-badge { font-size: 0.65rem; background: currentColor; color: white; padding: 1px 4px; border-radius: 3px; margin-left: 2px; vertical-align: super; }
    .word-skipped .error-badge { background: #6c757d; }
    .word-misread .error-badge { background: #f97316; }
    .word-substituted .error-badge { background: #ef4444; }
    .legend { display: flex; flex-wrap: wrap; gap: var(--space-md); margin-top: var(--space-md); font-size: 0.85rem; }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .error-breakdown { background: #fef3c7; padding: var(--space-lg); border-radius: var(--radius-md); }
    .error-breakdown h4 { margin-bottom: var(--space-md); color: #92400e; }
    .error-category { background: white; padding: var(--space-md); border-radius: var(--radius-sm); margin-bottom: var(--space-sm); border-left: 3px solid #f59e0b; }
    .loading-analysis { text-align: center; padding: var(--space-3xl); }
    .loading-analysis .spinner { width: 40px; height: 40px; border: 3px solid var(--color-sand); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto var(--space-lg); }
    @keyframes spin { to { transform: rotate(360deg); } }
    .info-box { background: #e0f2fe; padding: var(--space-lg); border-radius: var(--radius-md); margin: var(--space-lg) 0; border-left: 4px solid #0284c7; }
    .info-box p { margin: 0 0 var(--space-sm) 0; }
    .info-box p:last-child { margin-bottom: 0; }
`;
document.head.appendChild(styleSheet);

debugLog('Word Analyzer V2 initialized');
