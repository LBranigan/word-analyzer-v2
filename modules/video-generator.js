/**
 * Video Generator Module - Lazy-loaded module for video generation
 * This module is loaded on-demand when user clicks "Generate Video"
 */

import { debugLog, debugError } from '../utils.js';

/**
 * Generate transcript video from analysis data
 * @param {Object} state - Application state containing analysis data
 * @param {HTMLElement} statusDiv - Status display element
 * @param {HTMLElement} generateBtn - Generate button element
 */
export async function generateVideo(state, statusDiv, generateBtn) {
    if (!state.latestAnalysis || !state.latestSpokenWords) {
        alert('No analysis data available');
        return;
    }

    if (!state.recordedAudioBlob) {
        if (state.viewingHistoricalAssessment) {
            alert('No audio recording available for this historical assessment. This assessment was saved before audio storage was enabled. New assessments will include audio for video generation.');
        } else {
            alert('No audio recording available');
        }
        return;
    }

    try {
        generateBtn.disabled = true;
        statusDiv.innerHTML = '<div class="video-progress">🎬 Generating video... Please wait</div>';
        statusDiv.style.display = 'block';

        const analysis = state.latestAnalysis;
        const audioBlob = state.recordedAudioBlob;

        // Create canvas for video rendering
        const canvas = document.createElement('canvas');
        canvas.width = 1280;
        canvas.height = 720;
        const ctx = canvas.getContext('2d');

        // Video rendering settings
        const padding = 60;
        const lineHeight = 50;
        const fontSize = 36;

        // Prepare word layout (wrap text)
        const wordLayouts = prepareWordLayouts(analysis.aligned, ctx, canvas, padding, lineHeight, fontSize);

        // Create audio context and decode audio
        const audioContext = new AudioContext();
        const audioBuffer = await audioBlob.arrayBuffer();
        const decodedAudio = await audioContext.decodeAudioData(audioBuffer);
        const audioDuration = decodedAudio.duration;

        // Create render function
        const renderFrame = createRenderFunction(ctx, canvas, wordLayouts, padding, fontSize);

        // Create canvas stream for video
        const canvasStream = canvas.captureStream(30); // 30 fps

        // Create media stream destination for audio
        const audioDestination = audioContext.createMediaStreamDestination();

        // Create buffer source from previously decoded audio
        const audioSource = audioContext.createBufferSource();
        audioSource.buffer = decodedAudio;
        audioSource.connect(audioDestination);

        // Combine video and audio streams
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioDestination.stream.getAudioTracks()
        ]);

        const mediaRecorder = new MediaRecorder(combinedStream, {
            mimeType: 'video/webm;codecs=vp9,opus',
            videoBitsPerSecond: 2500000,
            audioBitsPerSecond: 128000
        });

        const chunks = [];
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                chunks.push(e.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const videoBlob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(videoBlob);

            // Clean up audio context
            audioContext.close();

            // Create download link
            const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
            const filename = `reading-comprehension-video-${timestamp}.webm`;

            statusDiv.innerHTML = `
                <div class="video-complete">
                    ✅ Video generated successfully!
                    <a href="${url}" download="${filename}" class="btn btn-primary" style="margin-left: 10px;">
                        💾 Download Video
                    </a>
                </div>
            `;

            generateBtn.disabled = false;
        };

        // Start recording and audio playback simultaneously
        mediaRecorder.start();
        audioSource.start(0);

        // Render frames
        const fps = 30;
        const frameInterval = 1000 / fps;
        let currentTime = 0;

        const renderInterval = setInterval(() => {
            currentTime += frameInterval / 1000;

            if (currentTime >= audioDuration) {
                clearInterval(renderInterval);
                mediaRecorder.stop();
                audioSource.stop();
            } else {
                renderFrame(currentTime);
            }
        }, frameInterval);

    } catch (error) {
        debugError('Error generating video:', error);
        statusDiv.innerHTML = `<div class="error">Error generating video: ${error.message}</div>`;
        generateBtn.disabled = false;
    }
}

/**
 * Prepare word layouts for video rendering
 */
function prepareWordLayouts(aligned, ctx, canvas, padding, lineHeight, fontSize) {
    const wordLayouts = [];
    let xPos = padding;
    let yPos = padding + fontSize;

    aligned.forEach((item) => {
        const word = item.expected;
        ctx.font = `${fontSize}px Arial`;
        const wordWidth = ctx.measureText(word + ' ').width;

        // Wrap to next line if needed
        if (xPos + wordWidth > canvas.width - padding) {
            xPos = padding;
            yPos += lineHeight;
        }

        wordLayouts.push({
            word: word,
            x: xPos,
            y: yPos,
            width: wordWidth,
            status: item.status,
            spoken: item.spoken,
            startTime: item.startTime,
            endTime: item.endTime
        });

        xPos += wordWidth;
    });

    return wordLayouts;
}

/**
 * Create render function for video frames
 */
function createRenderFunction(ctx, canvas, wordLayouts, padding, fontSize) {
    return function renderFrame(currentTime) {
        // Clear canvas with white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw title
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 28px Arial';
        ctx.fillText('Oral Fluency Analysis', padding, 35);

        // Draw each word with appropriate highlighting
        ctx.font = `${fontSize}px Arial`;

        wordLayouts.forEach(layout => {
            const { color, isCurrentWord } = getWordColor(layout, currentTime);

            // Draw word
            ctx.fillStyle = color;
            ctx.fillText(layout.word, layout.x, layout.y);

            // Draw underline for current word
            if (isCurrentWord) {
                ctx.fillRect(layout.x, layout.y + 8, layout.width - 10, 3);
            }
        });

        // Draw legend at bottom
        drawLegend(ctx, canvas, padding);
    };
}

/**
 * Get color for word based on status and timing
 */
function getWordColor(layout, currentTime) {
    let color = '#cccccc'; // Default: not yet spoken
    let isCurrentWord = false;

    // Check if this word is being spoken right now
    if (layout.startTime && layout.endTime) {
        const startTime = parseFloat(layout.startTime.replace('s', ''));
        const endTime = parseFloat(layout.endTime.replace('s', ''));

        if (currentTime >= startTime && currentTime <= endTime) {
            isCurrentWord = true;
            // Highlight current word based on status
            if (layout.status === 'correct') {
                color = '#22c55e'; // Bright green
            } else if (layout.status === 'misread') {
                color = '#f97316'; // Orange
            } else if (layout.status === 'skipped') {
                color = '#ef4444'; // Red
            } else if (layout.status === 'substituted') {
                color = '#dc2626'; // Dark red
            }
        } else if (currentTime > endTime) {
            // Already spoken - use dimmer colors
            if (layout.status === 'correct') {
                color = '#86efac'; // Light green
            } else if (layout.status === 'misread') {
                color = '#fdba74'; // Light orange
            } else if (layout.status === 'skipped') {
                color = '#fca5a5'; // Light red
            } else if (layout.status === 'substituted') {
                color = '#fca5a5'; // Light red
            }
        }
    } else {
        // No timing data - use status colors dimly
        if (layout.status === 'correct') {
            color = '#86efac';
        } else if (layout.status === 'misread') {
            color = '#fdba74';
        } else if (layout.status === 'skipped') {
            color = '#fca5a5';
        }
    }

    return { color, isCurrentWord };
}

/**
 * Draw legend at bottom of video frame
 */
function drawLegend(ctx, canvas, padding) {
    const legendY = canvas.height - 40;
    ctx.font = '20px Arial';

    ctx.fillStyle = '#22c55e';
    ctx.fillText('■ Correct', padding, legendY);

    ctx.fillStyle = '#f97316';
    ctx.fillText('■ Misread', padding + 150, legendY);

    ctx.fillStyle = '#ef4444';
    ctx.fillText('■ Skipped', padding + 300, legendY);

    ctx.fillStyle = '#cccccc';
    ctx.fillText('■ Not Yet Spoken', padding + 450, legendY);
}

export default { generateVideo };
