/**
 * Utility functions and constants for Word Analyzer V2
 * Provides XSS sanitization, debug logging, and application constants
 */

// ============ DEBUG MODE ============
// Set to false in production to disable console logging
export const DEBUG = false;

/**
 * Debug logging wrapper - only logs when DEBUG is true
 * @param {...any} args - Arguments to log
 */
export function debugLog(...args) {
    if (DEBUG) {
        console.log(...args);
    }
}

/**
 * Debug error wrapper - only logs when DEBUG is true
 * @param {...any} args - Arguments to log
 */
export function debugError(...args) {
    if (DEBUG) {
        console.error(...args);
    }
}

/**
 * Debug warning wrapper - only logs when DEBUG is true
 * @param {...any} args - Arguments to log
 */
export function debugWarn(...args) {
    if (DEBUG) {
        console.warn(...args);
    }
}

// ============ XSS SANITIZATION ============

/**
 * Escapes HTML special characters to prevent XSS attacks
 * Use this for any user-provided content inserted via innerHTML
 * @param {string} str - String to escape
 * @returns {string} - Escaped string safe for innerHTML
 */
export function escapeHtml(str) {
    if (str === null || str === undefined) {
        return '';
    }

    const string = String(str);
    const htmlEscapes = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };

    return string.replace(/[&<>"'`=/]/g, char => htmlEscapes[char]);
}

/**
 * Escapes a string for use in JSON within HTML attributes
 * @param {object} obj - Object to stringify and escape
 * @returns {string} - Escaped JSON string safe for data attributes
 */
export function escapeJsonForAttribute(obj) {
    return JSON.stringify(obj)
        .replace(/&/g, '&amp;')
        .replace(/'/g, '&#39;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

// ============ APPLICATION CONSTANTS ============

// Camera/Image Processing
export const CAMERA_CONSTANTS = {
    MIN_WIDTH: 1280,
    MIN_HEIGHT: 720,
    IDEAL_WIDTH: 1920,
    IDEAL_HEIGHT: 1080,
    JPEG_QUALITY: 1.0
};

// Audio Recording
export const AUDIO_CONSTANTS = {
    DEFAULT_SAMPLE_RATE: 48000,
    DEFAULT_CHANNEL_COUNT: 1,
    DEFAULT_BITRATE: 32000,
    MAX_FILE_SIZE_MB: 9.5,
    MAX_INLINE_DURATION_SECONDS: 45,
    RECORDING_CHECK_INTERVAL_MS: 100
};

// Canvas Interaction
export const CANVAS_CONSTANTS = {
    MIN_DRAG_DISTANCE: 15,
    MAX_ZOOM: 5,
    MIN_ZOOM: 0.5,
    ZOOM_FACTOR: 1.2,
    SELECTION_LINE_WIDTH: 8,
    SELECTION_CIRCLE_RADIUS: 15,
    WORD_BORDER_WIDTH: 1,
    SELECTED_BORDER_WIDTH: 3
};

// Word Matching & Analysis
export const ANALYSIS_CONSTANTS = {
    // Similarity thresholds
    EXACT_MATCH_THRESHOLD: 1.0,
    HIGH_SIMILARITY_THRESHOLD: 0.85,
    MEDIUM_SIMILARITY_THRESHOLD: 0.70,
    LOW_SIMILARITY_THRESHOLD: 0.55,
    ANCHOR_SIMILARITY_THRESHOLD: 0.60,
    PHONETIC_MATCH_THRESHOLD: 0.60,

    // Word length thresholds
    MIN_WORD_LENGTH_FOR_SOUNDEX: 2,
    MIN_WORD_LENGTH_FOR_ANCHOR: 4,
    SOUNDEX_CODE_LENGTH: 4,

    // Error detection
    CONSECUTIVE_SKIPS_FOR_LINE_SKIP: 3,
    MAX_COMMON_WORD_COUNT: 2,

    // Pause/hesitation detection
    HESITATION_PAUSE_THRESHOLD_SECONDS: 1.0,

    // Prosody scoring
    MIN_PROSODY_SCORE: 1.0,
    MAX_PROSODY_SCORE: 5.0
};

// Accuracy Classification
export const ACCURACY_THRESHOLDS = {
    EXCELLENT: 95,
    GOOD: 85,
    FAIR: 75,
    NEEDS_IMPROVEMENT: 0
};

// API Usage Thresholds
export const API_USAGE_CONSTANTS = {
    WARNING_PERCENT: 80,
    DANGER_PERCENT: 95,
    VISION_FREE_TIER_LIMIT: 1000,
    SPEECH_FREE_TIER_LIMIT: 60  // minutes
};

// UI Timing
export const UI_CONSTANTS = {
    TOOLTIP_HIDE_DELAY_MS: 5000,
    SUCCESS_MESSAGE_DURATION_MS: 3000,
    SCROLL_BEHAVIOR: 'smooth',
    IMAGE_CACHE_CHECK_INTERVAL_MS: 10,
    LOADING_STEP_TRANSITION_MS: 300
};

// Duration options (in minutes)
export const RECORDING_DURATIONS = {
    SHORT: 0.5,  // 30 seconds
    MEDIUM: 1,   // 1 minute
    LONG: 2      // 2 minutes
};

// Bitrate options (in bps)
export const AUDIO_BITRATES = {
    LOW: 16000,
    RECOMMENDED: 32000,
    HIGH: 64000,
    VERY_HIGH: 128000
};

// ============ HELPER FUNCTIONS ============

/**
 * Get accuracy classification based on percentage
 * @param {number} accuracy - Accuracy percentage (0-100)
 * @returns {string} - Classification: 'excellent', 'good', 'fair', or 'poor'
 */
export function getAccuracyClassification(accuracy) {
    if (accuracy >= ACCURACY_THRESHOLDS.EXCELLENT) return 'excellent';
    if (accuracy >= ACCURACY_THRESHOLDS.GOOD) return 'good';
    if (accuracy >= ACCURACY_THRESHOLDS.FAIR) return 'fair';
    return 'poor';
}

/**
 * Get accuracy class for student cards (simplified)
 * @param {number} accuracy - Accuracy percentage (0-100)
 * @returns {string} - Classification: 'good', 'warning', or 'poor'
 */
export function getCardAccuracyClass(accuracy) {
    if (accuracy >= ACCURACY_THRESHOLDS.EXCELLENT) return 'good';
    if (accuracy >= ACCURACY_THRESHOLDS.GOOD) return 'warning';
    return 'poor';
}

/**
 * Get usage status class based on percentage used
 * @param {number} percentUsed - Percentage of quota used
 * @returns {string} - Status class: 'usage-good', 'usage-warning', or 'usage-danger'
 */
export function getUsageStatusClass(percentUsed) {
    if (percentUsed > API_USAGE_CONSTANTS.DANGER_PERCENT) return 'usage-danger';
    if (percentUsed > API_USAGE_CONSTANTS.WARNING_PERCENT) return 'usage-warning';
    return 'usage-good';
}

/**
 * Check if word similarity meets threshold for a match
 * @param {number} similarity - Similarity score (0-1)
 * @param {string} threshold - Threshold level: 'high', 'medium', 'low', 'anchor'
 * @returns {boolean} - Whether similarity meets threshold
 */
export function meetsSimilarityThreshold(similarity, threshold = 'medium') {
    const thresholds = {
        high: ANALYSIS_CONSTANTS.HIGH_SIMILARITY_THRESHOLD,
        medium: ANALYSIS_CONSTANTS.MEDIUM_SIMILARITY_THRESHOLD,
        low: ANALYSIS_CONSTANTS.LOW_SIMILARITY_THRESHOLD,
        anchor: ANALYSIS_CONSTANTS.ANCHOR_SIMILARITY_THRESHOLD,
        phonetic: ANALYSIS_CONSTANTS.PHONETIC_MATCH_THRESHOLD
    };
    return similarity >= (thresholds[threshold] || thresholds.medium);
}

// ============ EXPORT DEFAULT ============
export default {
    DEBUG,
    debugLog,
    debugError,
    debugWarn,
    escapeHtml,
    escapeJsonForAttribute,
    CAMERA_CONSTANTS,
    AUDIO_CONSTANTS,
    CANVAS_CONSTANTS,
    ANALYSIS_CONSTANTS,
    ACCURACY_THRESHOLDS,
    API_USAGE_CONSTANTS,
    UI_CONSTANTS,
    RECORDING_DURATIONS,
    AUDIO_BITRATES,
    getAccuracyClassification,
    getCardAccuracyClass,
    getUsageStatusClass,
    meetsSimilarityThreshold
};
