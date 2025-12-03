// Firebase API Key Manager
// Handles saving/loading Google Cloud API keys to user's Firebase profile

import { db, doc, getDoc, setDoc } from './firebase-config.js';
import { getCurrentUser } from './firebase-auth.js';
import { debugLog, debugError, API_USAGE_CONSTANTS } from './utils.js';

// Save Google Cloud API key to user's Firestore profile
export async function saveApiKeyToFirebase(apiKey) {
    try {
        const user = getCurrentUser();
        if (!user) {
            throw new Error('User not authenticated');
        }

        const userConfigRef = doc(db, 'users', user.uid, 'config', 'apiKeys');

        await setDoc(userConfigRef, {
            googleCloudApiKey: apiKey,
            updatedAt: Date.now()
        }, { merge: true });

        debugLog('API key saved to Firebase successfully');
        return true;
    } catch (error) {
        debugError('Error saving API key to Firebase:', error);
        return false;
    }
}

// Load Google Cloud API key from user's Firestore profile
export async function loadApiKeyFromFirebase() {
    try {
        const user = getCurrentUser();
        if (!user) {
            return null;
        }

        const userConfigRef = doc(db, 'users', user.uid, 'config', 'apiKeys');
        const docSnap = await getDoc(userConfigRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            debugLog('API key loaded from Firebase');
            return data.googleCloudApiKey || null;
        }

        return null;
    } catch (error) {
        debugError('Error loading API key from Firebase:', error);
        return null;
    }
}

// Validate Google Cloud Vision API key
export async function validateApiKey(apiKey) {
    try {
        const testImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

        const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                requests: [{
                    image: {
                        content: testImage.split(',')[1]
                    },
                    features: [{
                        type: 'TEXT_DETECTION',
                        maxResults: 1
                    }]
                }]
            })
        });

        const data = await response.json();

        if (data.error) {
            debugError('API key validation failed:', data.error);
            return {
                valid: false,
                error: data.error.message || 'Invalid API key'
            };
        }

        return {
            valid: true,
            message: 'API key is valid'
        };

    } catch (error) {
        debugError('Error validating API key:', error);
        return {
            valid: false,
            error: 'Failed to validate API key. Please check your connection.'
        };
    }
}

// Track API usage in Firestore
export async function trackApiUsage(apiType, details = {}) {
    try {
        const user = getCurrentUser();
        if (!user) return;

        const usageRef = doc(db, 'users', user.uid, 'usage', apiType);
        const docSnap = await getDoc(usageRef);

        const now = Date.now();
        const currentMonth = new Date().toISOString().slice(0, 7);

        let usageData = {
            totalCalls: 0,
            monthlyUsage: {}
        };

        if (docSnap.exists()) {
            usageData = docSnap.data();
        }

        usageData.totalCalls = (usageData.totalCalls || 0) + 1;

        if (!usageData.monthlyUsage) {
            usageData.monthlyUsage = {};
        }
        if (!usageData.monthlyUsage[currentMonth]) {
            usageData.monthlyUsage[currentMonth] = {
                calls: 0,
                firstCall: now,
                lastCall: now
            };
        }

        usageData.monthlyUsage[currentMonth].calls += 1;
        usageData.monthlyUsage[currentMonth].lastCall = now;

        if (Object.keys(details).length > 0) {
            usageData.lastCallDetails = details;
        }

        await setDoc(usageRef, usageData);
        debugLog(`${apiType} usage tracked successfully`);

    } catch (error) {
        debugError('Error tracking API usage:', error);
    }
}

// Get usage statistics
export async function getUsageStats() {
    try {
        const user = getCurrentUser();
        if (!user) return null;

        const visionUsageRef = doc(db, 'users', user.uid, 'usage', 'vision');
        const speechUsageRef = doc(db, 'users', user.uid, 'usage', 'speech');

        const [visionSnap, speechSnap] = await Promise.all([
            getDoc(visionUsageRef),
            getDoc(speechUsageRef)
        ]);

        const currentMonth = new Date().toISOString().slice(0, 7);

        const visionData = visionSnap.exists() ? visionSnap.data() : { totalCalls: 0, monthlyUsage: {} };
        const speechData = speechSnap.exists() ? speechSnap.data() : { totalCalls: 0, monthlyUsage: {} };

        return {
            vision: {
                total: visionData.totalCalls || 0,
                thisMonth: visionData.monthlyUsage?.[currentMonth]?.calls || 0,
                freeTierLimit: API_USAGE_CONSTANTS.VISION_FREE_TIER_LIMIT,
                percentUsed: ((visionData.monthlyUsage?.[currentMonth]?.calls || 0) / API_USAGE_CONSTANTS.VISION_FREE_TIER_LIMIT * 100).toFixed(1)
            },
            speech: {
                total: speechData.totalCalls || 0,
                thisMonth: speechData.monthlyUsage?.[currentMonth]?.calls || 0,
                freeTierLimit: API_USAGE_CONSTANTS.SPEECH_FREE_TIER_LIMIT,
                percentUsed: ((speechData.monthlyUsage?.[currentMonth]?.calls || 0) / API_USAGE_CONSTANTS.SPEECH_FREE_TIER_LIMIT * 100).toFixed(1)
            }
        };

    } catch (error) {
        debugError('Error getting usage stats:', error);
        return null;
    }
}

export default {
    saveApiKeyToFirebase,
    loadApiKeyFromFirebase,
    validateApiKey,
    trackApiUsage,
    getUsageStats
};
