/* ============================================
   Photomaton ID — Boîte à Photos d'Identité
   Vocal: Mistral Voxtral TTS
   ============================================ */

// ---- State ----
const state = {
    soundEnabled: true,
    photos: [],
    maxPhotos: 4,
    currentPhoto: 0,
    stream: null,
    speaking: false,
    ttsQueue: [],
    mistralAvailable: true
};

// ---- Elements ----
const $ = id => document.getElementById(id);

// ---- Screens ----
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
}

// ---- Audio Context (unlocked on first user click) ----
let audioCtx = null;
let audioUnlocked = false;

function unlockAudio() {
    if (audioUnlocked) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Play silent buffer to unlock
        const buf = audioCtx.createBuffer(1, 1, 22050);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        src.start(0);
        audioUnlocked = true;
        console.log('AudioContext unlocked');
    } catch (e) {
        console.warn('AudioContext unlock failed:', e);
    }
}

// Play MP3 via Web Audio API (avoids autoplay policy)
function playMP3(base64Data) {
    return new Promise((resolve) => {
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            // Resume if suspended
            if (audioCtx.state === 'suspended') {
                audioCtx.resume().then(() => decodeAndPlay());
            } else {
                decodeAndPlay();
            }

            function decodeAndPlay() {
                const raw = atob(base64Data);
                const bytes = new Uint8Array(raw.length);
                for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

                audioCtx.decodeAudioData(bytes.buffer, (buffer) => {
                    const source = audioCtx.createBufferSource();
                    source.buffer = buffer;
                    source.connect(audioCtx.destination);
                    source.onended = () => resolve(true);
                    source.start(0);
                }, (err) => {
                    console.warn('decodeAudioData failed:', err);
                    resolve(false);
                });
            }
        } catch (e) {
            console.warn('playMP3 error:', e);
            resolve(false);
        }
    });
}

// ---- Mistral Voxtral TTS ----
async function speakMistral(text) {
    try {
        const resp = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (!resp.ok) {
            console.warn('Mistral TTS error:', resp.status);
            return false;
        }

        const data = await resp.json();
        if (!data.audio_data) return false;

        // Play via Web Audio API
        const ok = await playMP3(data.audio_data);
        if (ok) {
            state.speaking = false;
            setTimeout(() => updateVoiceBubble(''), 1500);
        }
        return ok;
    } catch (err) {
        console.warn('Mistral TTS fetch error:', err);
        return false;
    }
}

// ---- Browser TTS Fallback ----
function speakBrowser(text) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) { resolve(false); return; }

        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'fr-FR';
        utterance.rate = 0.9;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        const voices = window.speechSynthesis.getVoices();
        const frVoice = voices.find(v => v.lang.startsWith('fr'));
        if (frVoice) utterance.voice = frVoice;

        utterance.onend = () => {
            state.speaking = false;
            setTimeout(() => updateVoiceBubble(''), 1500);
            resolve(true);
        };
        utterance.onerror = () => resolve(false);

        window.speechSynthesis.speak(utterance);
    });
}

// ---- Main speak function (Mistral TTS → fallback browser) ----
async function speak(text, priority = false) {
    if (!state.soundEnabled) return;
    if (state.speaking && !priority) return;

    state.speaking = true;
    updateVoiceBubble(text);

    // Try Mistral TTS first
    if (state.mistralAvailable) {
        const ok = await speakMistral(text);
        if (ok) return;
        // If failed, mark as unavailable and fall back
        state.mistralAvailable = false;
        console.warn('Mistral TTS unavailable, using browser fallback');
    }

    // Fallback to browser TTS
    await speakBrowser(text);
}

function updateVoiceBubble(text) {
    const el = $('voice-text');
    if (el) el.textContent = text || 'En attente...';
}

// Preload browser voices for fallback
if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => {};
}

// ---- Test Mistral connection on load ----
async function testMistralConnection() {
    try {
        const resp = await fetch('/api/voices');
        if (resp.ok) {
            state.mistralAvailable = true;
            console.log('Mistral Voxtral TTS connecté');
        } else {
            state.mistralAvailable = false;
            console.warn('Mistral TTS non disponible, fallback navigateur');
        }
    } catch {
        state.mistralAvailable = false;
    }
}

// ---- Camera ----
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: { ideal: 1280 },
                height: { ideal: 960 }
            },
            audio: false
        });
        state.stream = stream;
        const video = $('camera');
        video.srcObject = stream;
        return true;
    } catch (err) {
        console.error('Camera error:', err);
        alert('Impossible d\'accéder à la caméra.\n\nVeuillez autoriser l\'accès à la caméra dans les paramètres de votre navigateur.');
        return false;
    }
}

function stopCamera() {
    if (state.stream) {
        state.stream.getTracks().forEach(t => t.stop());
        state.stream = null;
    }
}

// ---- Photo Capture ----
function capturePhoto() {
    const video = $('camera');
    const canvas = $('camera-canvas');
    const ctx = canvas.getContext('2d');

    // Set canvas size to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Mirror the image (front camera)
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Crop to ID photo ratio (35mm x 45mm ≈ 7:9)
    const idRatio = 7 / 9;
    const srcRatio = canvas.width / canvas.height;

    let sx, sy, sw, sh;
    if (srcRatio > idRatio) {
        sh = canvas.height;
        sw = sh * idRatio;
        sx = (canvas.width - sw) / 2;
        sy = 0;
    } else {
        sw = canvas.width;
        sh = sw / idRatio;
        sx = 0;
        sy = (canvas.height - sh) / 2;
    }

    // Create cropped canvas
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = 350;  // 35mm at 10dpi
    cropCanvas.height = 450; // 45mm at 10dpi
    const cropCtx = cropCanvas.getContext('2d');

    // White background (ID requirement)
    cropCtx.fillStyle = '#ffffff';
    cropCtx.fillRect(0, 0, cropCanvas.width, cropCanvas.height);

    // Draw cropped photo
    cropCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);

    return cropCanvas.toDataURL('image/jpeg', 0.95);
}

// ---- Flash Effect ----
function flashEffect() {
    return new Promise(resolve => {
        const flash = $('camera-flash');
        const overlay = $('flash-overlay');

        flash.classList.add('flash');
        overlay.classList.add('flash');

        setTimeout(() => {
            flash.classList.remove('flash');
            overlay.classList.remove('flash');
            resolve();
        }, 150);
    });
}

// ---- Countdown ----
function startCountdown() {
    return new Promise(resolve => {
        const container = $('countdown');
        const numberEl = $('countdown-number');
        container.classList.add('active');

        let count = 3;
        numberEl.textContent = count;
        numberEl.style.animation = 'none';
        void numberEl.offsetWidth;
        numberEl.style.animation = '';

        speak(getCountdownPhrase(count), true);

        const interval = setInterval(() => {
            count--;
            if (count > 0) {
                numberEl.textContent = count;
                numberEl.style.animation = 'none';
                void numberEl.offsetWidth;
                numberEl.style.animation = '';
                speak(getCountdownPhrase(count), true);
            } else {
                clearInterval(interval);
                numberEl.textContent = '📸';
                numberEl.style.animation = 'none';
                void numberEl.offsetWidth;
                numberEl.style.animation = '';
                setTimeout(() => {
                    container.classList.remove('active');
                    resolve();
                }, 300);
            }
        }, 1000);
    });
}

function getCountdownPhrase(n) {
    const phrases = {
        3: 'Trois...',
        2: 'Deux...',
        1: 'Un...'
    };
    return phrases[n] || '';
}

// ---- Pose Instructions ----
const poseInstructions = [
    { text: 'Regardez droit devant, expression neutre', voice: 'Regardez droit devant, gardez une expression neutre.' },
    { text: 'Ne bougez pas, sourire léger', voice: 'Parfait ! Maintenant, un léger sourire, s\'il vous plaît.' },
    { text: 'Tournez légèrement la tête à droite', voice: 'Tournez votre tête très légèrement vers la droite.' },
    { text: 'Revenez face caméra, expression naturelle', voice: 'Revenez face à la caméra, expression naturelle.' }
];

const randomPoses = [
    'Regardez droit devant, ne bougez plus !',
    'Parfait, gardez cette position !',
    'C\'est bien, restez immobile !',
    'Excellent ! On continue !',
    'Super ! Encore une photo !'
];

function getRandomPose() {
    return randomPoses[Math.floor(Math.random() * randomPoses.length)];
}

// ---- Capture Flow ----
async function captureNextPhoto() {
    if (state.currentPhoto >= state.maxPhotos) {
        finishCapture();
        return;
    }

    state.currentPhoto++;
    $('photo-count').textContent = state.currentPhoto;

    // Update pose label
    const poseIdx = Math.min(state.currentPhoto - 1, poseInstructions.length - 1);
    const instruction = poseInstructions[poseIdx];
    $('pose-label').textContent = instruction.text;
    speak(instruction.voice, true);

    // Wait for pose
    await sleep(1500);

    // Countdown
    await startCountdown();

    // Flash
    await flashEffect();

    // Capture
    const photoData = capturePhoto();
    state.photos.push(photoData);

    // Shutter sound effect (visual)
    const viewfinder = document.querySelector('.viewfinder');
    viewfinder.style.border = '3px solid var(--yellow-accent)';
    setTimeout(() => {
        viewfinder.style.border = '3px solid var(--blue-primary)';
    }, 300);

    // Feedback
    speak(getRandomPose(), true);

    // Next photo or finish
    setTimeout(() => captureNextPhoto(), 1200);
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ---- Finish & Preview ----
function finishCapture() {
    stopCamera();
    showScreen('screen-preview');
    renderPreview();
    speak('Voilà ! Vos photos d\'identité sont prêtes. Vous pouvez les télécharger ou les reprendre.', true);
}

function renderPreview() {
    // Photo strip
    const strip = $('photo-strip');
    strip.innerHTML = state.photos.map((p, i) =>
        `<img src="${p}" alt="Photo ${i + 1}">`
    ).join('');

    // ID card preview
    const idCard = $('id-card-preview');
    if (state.photos.length > 0) {
        idCard.innerHTML = `
            <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:4px;">
                <img src="${state.photos[0]}" alt="Photo d'identité" style="width:50px; height:65px;">
                <div style="font-size:6px; color:#666;">PHOTO</div>
            </div>
            <div style="flex:1.5; display:flex; flex-direction:column; gap:4px; padding-top:16px;">
                <div style="font-size:8px; color:#1a3a6a; font-weight:700;">NOM Prénom</div>
                <div style="font-size:7px; color:#666;">Né(e) le : --/--/----</div>
                <div style="font-size:7px; color:#666;">Lieu de naissance : -----</div>
                <div style="font-size:7px; color:#666;">Nationalité : Française</div>
            </div>
        `;
    }
}

// ---- Download ----
function downloadPhotos() {
    if (state.photos.length === 0) return;

    // Create a printable sheet with 8 ID photos (standard sheet)
    const canvas = document.createElement('canvas');
    const cols = 2;
    const rows = 4;
    const photoW = 350;
    const photoH = 450;
    const gap = 20;
    const padding = 40;

    canvas.width = cols * photoW + (cols - 1) * gap + 2 * padding;
    canvas.height = rows * photoH + (rows - 1) * gap + 2 * padding;

    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Place photos
    const photo = new Image();
    photo.onload = () => {
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = padding + col * (photoW + gap);
                const y = padding + row * (photoH + gap);

                // Cut lines (light gray)
                ctx.strokeStyle = '#ddd';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.strokeRect(x - 2, y - 2, photoW + 4, photoH + 4);
                ctx.setLineDash([]);

                // Photo
                ctx.drawImage(photo, x, y, photoW, photoH);
            }
        }

        // Download
        const link = document.createElement('a');
        link.download = `photomaton-id-${Date.now()}.jpg`;
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();

        speak('Feuille de photos téléchargée ! Imprimez-la en taille réelle.', true);
    };
    photo.src = state.photos[0];
}

// ---- Reset ----
function resetSession() {
    state.photos = [];
    state.currentPhoto = 0;
    $('photo-count').textContent = '0';
    $('pose-label').textContent = poseInstructions[0].text;
    showScreen('screen-welcome');
}

// ---- Toggle Sound ----
function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    $('sound-icon').textContent = state.soundEnabled ? '🔊' : '🔇';
    if (state.soundEnabled) {
        speak('Son activé !');
    } else {
        window.speechSynthesis.cancel();
    }
}

// ---- Event Listeners ----
document.addEventListener('DOMContentLoaded', () => {

    // Test Mistral TTS on load
    testMistralConnection();

    // Start button
    $('btn-start').addEventListener('click', async () => {
        // Unlock audio on first user gesture (required by browser autoplay policy)
        unlockAudio();

        showScreen('screen-camera');
        const ok = await startCamera();
        if (!ok) {
            showScreen('screen-welcome');
            return;
        }

        state.currentPhoto = 0;
        state.photos = [];
        $('photo-count').textContent = '0';
        $('pose-label').textContent = poseInstructions[0].text;

        speak('Bienvenue dans le Photomaton d\'identité ! Je vais vous guider pour prendre vos photos. Regardez droit devant vous.', true);

        // Auto-start capture after welcome
        setTimeout(() => captureNextPhoto(), 3000);
    });

    // Capture button (manual trigger)
    $('btn-capture').addEventListener('click', () => {
        if (state.currentPhoto >= state.maxPhotos) return;
        // Stop auto flow, manual capture
        captureNextPhoto();
    });

    // Cancel
    $('btn-cancel').addEventListener('click', () => {
        stopCamera();
        resetSession();
    });

    // Retake
    $('btn-retake').addEventListener('click', async () => {
        resetSession();
        showScreen('screen-camera');
        await startCamera();
        speak('On reprend les photos ! Regardez droit devant.', true);
        setTimeout(() => captureNextPhoto(), 2000);
    });

    // Download
    $('btn-download').addEventListener('click', downloadPhotos);

    // Sound toggle
    $('btn-sound').addEventListener('click', () => {
        unlockAudio();
        toggleSound();
    });

    // Machine light animation
    const light = $('machine-light');
    if (light) {
        setInterval(() => {
            light.style.background = light.style.background === 'rgb(0, 255, 136)'
                ? '#ffcc00'
                : '#00ff88';
        }, 2000);
    }
});
