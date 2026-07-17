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
    mistralAvailable: true,
    audioUnlocked: false
};

// ---- Elements ----
const $ = id => document.getElementById(id);

// ---- Persistent audio element (key to bypass autoplay) ----
const ttsAudio = document.createElement('audio');
ttsAudio.style.display = 'none';
document.body.appendChild(ttsAudio);

// Silent 1-second WAV (inline base64) — used to unlock audio on first click
const SILENT_WAV = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

// ---- Screens ----
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    $(id).classList.add('active');
}

// ---- Unlock audio on first user gesture ----
function unlockAudio() {
    if (state.audioUnlocked) return;
    return new Promise((resolve) => {
        ttsAudio.src = 'data:audio/wav;base64,' + SILENT_WAV;
        ttsAudio.onended = () => {
            state.audioUnlocked = true;
            console.log('[Audio] Unlocked successfully');
            resolve();
        };
        ttsAudio.onerror = () => {
            state.audioUnlocked = true; // still mark as unlocked
            resolve();
        };
        ttsAudio.play().then(() => {
            // play() succeeded — audio is unlocked
            state.audioUnlocked = true;
            console.log('[Audio] Unlocked via play()');
            resolve();
        }).catch(e => {
            console.warn('[Audio] Unlock failed:', e);
            state.audioUnlocked = true;
            resolve();
        });
    });
}

// ---- Play Mistral audio (base64 → blob URL → persistent <audio>) ----
function playMistralAudio(base64Data, format) {
    return new Promise((resolve) => {
        try {
            const mime = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';
            const raw = atob(base64Data);
            const bytes = new Uint8Array(raw.length);
            for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
            const blob = new Blob([bytes], { type: mime });
            const url = URL.createObjectURL(blob);

            ttsAudio.src = url;
            ttsAudio.onended = () => {
                URL.revokeObjectURL(url);
                resolve(true);
            };
            ttsAudio.onerror = (e) => {
                console.warn('[Audio] Playback error:', e);
                URL.revokeObjectURL(url);
                resolve(false);
            };
            ttsAudio.play().then(() => {
                console.log('[Audio] Playing Mistral audio');
            }).catch(e => {
                console.warn('[Audio] play() blocked:', e);
                URL.revokeObjectURL(url);
                resolve(false);
            });
        } catch (e) {
            console.warn('[Audio] playMistralAudio error:', e);
            resolve(false);
        }
    });
}

// ---- Mistral Voxtral TTS ----
async function speakMistral(text) {
    try {
        console.log('[TTS] Mistral request:', text.substring(0, 60));
        const resp = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (!resp.ok) {
            console.warn('[TTS] HTTP error:', resp.status);
            return false;
        }

        const data = await resp.json();
        if (!data.audio_data) {
            console.warn('[TTS] No audio_data');
            return false;
        }

        console.log('[TTS] Got audio:', data.audio_data.length, 'chars, format:', data.format);

        const ok = await playMistralAudio(data.audio_data, data.format || 'mp3');
        console.log('[TTS] Play result:', ok);
        return ok;
    } catch (err) {
        console.warn('[TTS] Error:', err);
        return false;
    }
}

// ---- Browser TTS fallback ----
function speakBrowser(text) {
    return new Promise((resolve) => {
        if (!window.speechSynthesis) { resolve(false); return; }
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'fr-FR';
        u.rate = 0.9;
        const voices = window.speechSynthesis.getVoices();
        const fr = voices.find(v => v.lang.startsWith('fr'));
        if (fr) u.voice = fr;
        u.onend = () => resolve(true);
        u.onerror = () => resolve(false);
        window.speechSynthesis.speak(u);
    });
}

// ---- Main speak: Mistral first, browser fallback ----
async function speak(text, priority = false) {
    if (!state.soundEnabled) return;
    if (state.speaking && !priority) return;

    state.speaking = true;

    if (state.mistralAvailable) {
        const ok = await speakMistral(text);
        if (ok) {
            state.speaking = false;
            return;
        }
        state.mistralAvailable = false;
        console.warn('[TTS] Mistral failed → browser fallback');
    }

    await speakBrowser(text);
    state.speaking = false;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---- Camera ----
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
            audio: false
        });
        state.stream = stream;
        $('camera').srcObject = stream;
        return true;
    } catch (err) {
        console.error('Camera error:', err);
        alert('Caméra non disponible.\nAutorisez l\'accès dans les paramètres du navigateur.');
        return false;
    }
}

function stopCamera() {
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
}

// ---- Photo Capture ----
function capturePhoto() {
    const video = $('camera');
    const canvas = $('camera-canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const idRatio = 7 / 9;
    const srcRatio = canvas.width / canvas.height;
    let sx, sy, sw, sh;
    if (srcRatio > idRatio) { sh = canvas.height; sw = sh * idRatio; sx = (canvas.width - sw) / 2; sy = 0; }
    else { sw = canvas.width; sh = sw / idRatio; sx = 0; sy = (canvas.height - sh) / 2; }

    const crop = document.createElement('canvas');
    crop.width = 350; crop.height = 450;
    const c = crop.getContext('2d');
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 350, 450);
    c.drawImage(canvas, sx, sy, sw, sh, 0, 0, 350, 450);
    return crop.toDataURL('image/jpeg', 0.95);
}

// ---- Flash ----
function flashEffect() {
    return new Promise(resolve => {
        const flash = $('camera-flash');
        const overlay = $('flash-overlay');
        flash.classList.add('flash');
        overlay.classList.add('flash');
        setTimeout(() => { flash.classList.remove('flash'); overlay.classList.remove('flash'); resolve(); }, 150);
    });
}

// ---- Countdown ----
function startCountdown() {
    return new Promise(resolve => {
        const container = $('countdown');
        const num = $('countdown-number');
        container.classList.add('active');
        let count = 3;
        num.textContent = count;
        num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';

        const tick = setInterval(() => {
            count--;
            if (count > 0) {
                num.textContent = count;
                num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
            } else {
                clearInterval(tick);
                num.textContent = '📸';
                num.style.animation = 'none'; void num.offsetWidth; num.style.animation = '';
                setTimeout(() => { container.classList.remove('active'); resolve(); }, 300);
            }
        }, 1000);
    });
}

// ---- Pose instructions (longues explications) ----
const poses = [
    'Photo numéro 1 : restez bien face à la caméra, dos droit, expression neutre. Ne souriez pas, regardez juste la lentille.',
    'Photo numéro 2 : parfait ! Cette fois, souriez légèrement. Un tout petit sourire, naturel.',
    'Photo numéro 3 : tournez votre tête de trois quarts vers la droite. Juste un peu, comme pour montrer votre profil.',
    'Photo numéro 4 : revenez face caméra. Expression neutre et détendue, comme la première photo.'
];

const randomFeedback = [
    'Excellente photo ! Continuez comme ça.',
    'Parfait ! On continue.',
    'Très bien ! Restez immobile.',
    'Super ! Dernière photo.',
    'Bravo ! Vous faites bien.'
];

// ---- Capture flow ----
async function captureNextPhoto() {
    if (state.currentPhoto >= state.maxPhotos) { finishCapture(); return; }

    state.currentPhoto++;
    $('photo-count').textContent = state.currentPhoto;

    const poseText = poses[Math.min(state.currentPhoto - 1, poses.length - 1)];
    $('pose-label').textContent = 'Photo ' + state.currentPhoto + ' / ' + state.maxPhotos;

    // Parle l'instruction
    await speak(poseText, true);

    // Attente pour que la voix se termine + positionnement
    await sleep(1500);

    // Countdown
    await startCountdown();

    // Flash
    await flashEffect();

    // Capture
    state.photos.push(capturePhoto());

    // Feedback visuel
    const vf = document.querySelector('.viewfinder');
    vf.style.border = '3px solid var(--yellow-accent)';
    setTimeout(() => { vf.style.border = '3px solid var(--blue-primary)'; }, 300);

    // Feedback vocal
    await speak(randomFeedback[Math.floor(Math.random() * randomFeedback.length)], true);
    await sleep(1000);

    // Photo suivante
    captureNextPhoto();
}

// ---- Finish ----
function finishCapture() {
    stopCamera();
    showScreen('screen-preview');
    renderPreview();
    speak('Voilà ! Vos quatre photos d\'identité sont prêtes. Vous pouvez les imprimer en format carte d\'identité, trente-cinq millimètres sur quarante-cinq. Bonne journée !');
}

function renderPreview() {
    const strip = $('photo-strip');
    strip.innerHTML = state.photos.map((p, i) => '<img src="' + p + '" alt="Photo ' + (i + 1) + '">').join('');

    const idCard = $('id-card-preview');
    if (state.photos.length > 0) {
        idCard.innerHTML =
            '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">' +
                '<img src="' + state.photos[0] + '" style="width:50px;height:65px">' +
                '<div style="font-size:6px;color:#666">PHOTO</div>' +
            '</div>' +
            '<div style="flex:1.5;display:flex;flex-direction:column;gap:4px;padding-top:16px">' +
                '<div style="font-size:8px;color:#1a3a6a;font-weight:700">NOM Prénom</div>' +
                '<div style="font-size:7px;color:#666">Né(e) le : --/--/----</div>' +
                '<div style="font-size:7px;color:#666">Lieu de naissance : -----</div>' +
                '<div style="font-size:7px;color:#666">Nationalité : Française</div>' +
            '</div>';
    }
}

// ---- Download ----
function downloadPhotos() {
    if (!state.photos.length) return;
    const canvas = document.createElement('canvas');
    const cols = 2, rows = 4, pw = 350, ph = 450, gap = 20, pad = 40;
    canvas.width = cols * pw + (cols - 1) * gap + 2 * pad;
    canvas.height = rows * ph + (rows - 1) * gap + 2 * pad;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = pad + c * (pw + gap), y = pad + r * (ph + gap);
                ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
                ctx.strokeRect(x - 2, y - 2, pw + 4, ph + 4); ctx.setLineDash([]);
                ctx.drawImage(img, x, y, pw, ph);
            }
        }
        const link = document.createElement('a');
        link.download = 'photomaton-id-' + Date.now() + '.jpg';
        link.href = canvas.toDataURL('image/jpeg', 0.95);
        link.click();
        speak('Feuille de huit photos téléchargée. Imprimez-la en taille réelle.');
    };
    img.src = state.photos[0];
}

// ---- Reset ----
function resetSession() {
    state.photos = [];
    state.currentPhoto = 0;
    $('photo-count').textContent = '0';
    $('pose-label').textContent = 'En attente...';
    showScreen('screen-welcome');
}

// ---- Toggle sound ----
function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    $('sound-icon').textContent = state.soundEnabled ? '🔊' : '🔇';
}

// ---- Event Listeners ----
document.addEventListener('DOMContentLoaded', () => {

    // ---- COMMENCER: unlock audio + camera + introduction ----
    $('btn-start').addEventListener('click', async () => {
        // 1) Unlock audio IMMEDIATELY in the click handler
        await unlockAudio();

        showScreen('screen-camera');
        const ok = await startCamera();
        if (!ok) { showScreen('screen-welcome'); return; }

        state.currentPhoto = 0;
        state.photos = [];
        $('photo-count').textContent = '0';

        // 2) Longue introduction
        await speak(
            'Bienvenue au photomaton d\'identité ! ' +
            'Je vais prendre quatre photos de vous au format carte d\'identité française. ' +
            'Les photos font trente-cinq millimètres sur quarante-cinq, sur fond blanc. ' +
            'Restez bien calme, regardez la caméra, et je vous guiderai à chaque étape. ' +
            'On commence !',
            true
        );

        // 3) Lancer la prise de photos
        await sleep(1000);
        captureNextPhoto();
    });

    // ---- Capture button ----
    $('btn-capture').addEventListener('click', () => {
        if (state.currentPhoto >= state.maxPhotos) return;
        captureNextPhoto();
    });

    // ---- Cancel ----
    $('btn-cancel').addEventListener('click', () => { stopCamera(); resetSession(); });

    // ---- Retake ----
    $('btn-retake').addEventListener('click', async () => {
        await unlockAudio();
        resetSession();
        showScreen('screen-camera');
        await startCamera();
        await speak('On reprend tout ! Restez face à la caméra, on recommence.', true);
        await sleep(1000);
        captureNextPhoto();
    });

    // ---- Download ----
    $('btn-download').addEventListener('click', downloadPhotos);

    // ---- Sound toggle ----
    $('btn-sound').addEventListener('click', () => {
        unlockAudio();
        toggleSound();
    });

    // ---- Machine light ----
    const light = $('machine-light');
    if (light) {
        setInterval(() => {
            light.style.background = light.style.background === 'rgb(0, 255, 136)' ? '#ffcc00' : '#00ff88';
        }, 2000);
    }
});
