/* ============================================
   Photomaton ID — Boîte à Photos d'Identité
   Vocal: Mistral Voxtral TTS + Pixtral Vision
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

var API_KEY='FNynEhIM3TpeO0ibei4dREFf1EdfqDiC';
const IS_LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
var API_HOST = IS_LOCAL ? '' : 'https://api.mistral.ai'; // ← change ici pour ton Worker Cloudflare

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

// ---- Main speak: direct Mistral TTS (GitHub Pages), puis serveur, puis browser ----
async function speak(text, priority = false) {
    if (!state.soundEnabled) return;
    if (state.speaking && !priority) return;

    state.speaking = true;

    // GitHub Pages → direct Mistral API
    if (!IS_LOCAL && state.mistralAvailable) {
        const ok = await speakMistralDirect(text);
        if (ok) { state.speaking = false; return; }
        state.mistralAvailable = false;
    }

    // Localhost → serveur endpoint
    if (IS_LOCAL && state.mistralAvailable) {
        const ok = await speakMistral(text);
        if (ok) { state.speaking = false; return; }
        state.mistralAvailable = false;
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

function captureFrame() {
    const video = $('camera');
    if (!video || !video.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = 320; c.height = 240;
    c.getContext('2d').drawImage(video, 0, 0, 320, 240);
    return c.toDataURL('image/jpeg', 0.5).split(',')[1];
}

// ---- Mistral Vision direct (GitHub Pages) ----
async function askMistralVision(imageB64, instruction) {
    if (IS_LOCAL) return null;
    try {
        const resp = await fetch(API_HOST + '/v1/chat/completions', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY},
            body: JSON.stringify({
                model: 'pixtral-12b-2409',
                messages: [
                    {role: 'system', content: 'Tu es un photomaton. Tu regardes la photo de la personne et vérifies sa position : tête droite, épaules alignées, expression neutre, visage bien centré. 1 phrase précise.'},
                    {role: 'user', content: [{type: 'image_url', image_url: 'data:image/jpeg;base64,' + imageB64}, {type: 'text', text: instruction}]}
                ],
                max_tokens: 100,
                temperature: 0.3
            })
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        return data.choices[0].message.content;
    } catch (e) {
        return null;
    }
}

// ---- Direct Mistral TTS (GitHub Pages) ----
async function speakMistralDirect(text) {
    if (IS_LOCAL) return false;
    try {
        const resp = await fetch(API_HOST + '/v1/audio/speech', {
            method: 'POST',
            headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY},
            body: JSON.stringify({model: 'voxtral-mini-tts-2603', input: text, voice_id: 'c69964a6-ab8b-4f8a-9465-ec0925096ec8', response_format: 'wav'})
        });
        if (!resp.ok) return false;
        const data = await resp.json();
        if (!data.audio_data) return false;
        return await playMistralAudio(data.audio_data, 'wav');
    } catch (e) {
        return false;
    }
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
function playShutterSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        if (ctx.state === 'suspended') ctx.resume();

        // Click court (bruit blanc filtré) - son de l'obturateur
        const dur = 0.08;
        const sr = ctx.sampleRate;
        const len = sr * dur;
        const buf = ctx.createBuffer(1, len, sr);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
            const env = 1 - i / len;
            data[i] = (Math.random() * 2 - 1) * env * env;
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;

        // Filtre passe-haut pour le clic
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 800;

        // Enveloppe de gain
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.6, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);

        src.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        src.start(ctx.currentTime);
        setTimeout(() => ctx.close(), 500);
    } catch (e) { /* silencieux */ }
}

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
    $('pose-label').textContent = 'Photo ' + state.currentPhoto + ' / ' + state.maxPhotos;

    // Capture un frame et demande à l'IA de donner une instruction
    const frame = captureFrame();
    let poseText = poses[Math.min(state.currentPhoto - 1, poses.length - 1)];
    if (frame && !IS_LOCAL) {
        const aiInstruction = await askMistralVision(frame,
            'Photo ' + state.currentPhoto + ' sur 4. ' +
            'Regarde bien la position : tête droite ? épaules alignées ? expression neutre ? visage centré ? ' +
            'Dis exactement ce qui va ou ce qui doit changer.'
        );
        if (aiInstruction) poseText = aiInstruction;
    }

    // Parle l'instruction
    await speak(poseText, true);

    // Attente pour que la voix se termine + positionnement
    await sleep(1500);

    // Countdown
    await startCountdown();

    // Son obturateur + Flash
    playShutterSound();
    await flashEffect();

    // Capture
    state.photos.push(capturePhoto());

    // Feedback visuel
    const vf = document.querySelector('.viewfinder');
    vf.style.border = '3px solid var(--yellow-accent)';
    setTimeout(() => { vf.style.border = '3px solid var(--blue-primary)'; }, 300);

    // Feedback vocal via IA
    const photoB64 = state.photos[state.photos.length - 1].split(',')[1];
    let feedbackText = randomFeedback[Math.floor(Math.random() * randomFeedback.length)];
    if (photoB64 && !IS_LOCAL) {
        const aiFeedback = await askMistralVision(photoB64,
            'Vérifie si cette photo est valable pour une carte d\'identité. ' +
            'Dis si la personne est bien placée, si la tête est droite, le regard correct. ' +
            '1 phrase.'
        );
        if (aiFeedback) feedbackText = aiFeedback;
    }
    await speak(feedbackText, true);
    await sleep(1000);

    // Photo suivante
    captureNextPhoto();
}

// ---- Finish ----
function finishCapture() {
    stopVoiceAI();
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

// ===== Voice AI (real-time conversation as in parler) =====
const voiceState = {
    history: [],
    waiting: false,
    listening: false,
    recognition: null,
    maxHistory: 30,
    trimTo: 20
};
const SYS_PROMPT = "Tu es un assistant pour photomaton d'identité. Tu vois en direct la personne via la caméra. Tu regardes si elle est bien placée : tête droite, épaules alignées, expression neutre. Tu parles naturellement, 1-2 phrases. Tu donnes des instructions précises pour corriger la position si nécessaire.";

function setVoiceStatus(msg) {
    const el = $('voice-status');
    if (el) el.textContent = msg;
}

function callMistralChat(messages) {
    if (IS_LOCAL) return Promise.resolve(null);
    return fetch(API_HOST + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: JSON.stringify({ model: 'pixtral-12b-2409', messages: messages, max_tokens: 300, temperature: 0.1 })
    }).then(function(r) { if (!r.ok) return r.json().then(function(e) { throw new Error('Chat ' + r.status + ': ' + (e.message || JSON.stringify(e))); }); return r.json() })
     .then(function(d) { return d.choices[0].message.content });
}

function callMistralTTS(text) {
    if (IS_LOCAL) return Promise.resolve('');
    return fetch(API_HOST + '/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
        body: JSON.stringify({ model: 'voxtral-mini-tts-2603', input: text, voice_id: 'c69964a6-ab8b-4f8a-9465-ec0925096ec8', response_format: 'wav' })
    }).then(function(r) { if (!r.ok) return ''; return r.json() })
     .then(function(d) { return d.audio_data || '' });
}

function onUserText(text) {
    if (!text || voiceState.waiting) return;
    voiceState.history.push({ role: 'user', content: text });
    if (voiceState.history.length > voiceState.maxHistory) voiceState.history = voiceState.history.slice(-voiceState.trimTo);
    voiceState.waiting = true;
    setVoiceStatus('Réflexion...');

    var msgs = [{ role: 'system', content: SYS_PROMPT }].concat(voiceState.history.slice(-20));
    var userContent = [];
    var frame = captureFrame();
    if (frame) userContent.push({ type: 'image_url', image_url: 'data:image/jpeg;base64,' + frame });
    userContent.push({ type: 'text', text: text });
    msgs.push({ role: 'user', content: userContent });

    callMistralChat(msgs).then(function(aiText) {
        return callMistralTTS(aiText).then(function(audioB64) {
            return { aiText: aiText, audioB64: audioB64 };
        });
    }).then(function(result) {
        voiceState.history.push({ role: 'assistant', content: result.aiText });
        if (result.audioB64) {
            setVoiceStatus('Parle...');
            state.speaking = true;
            return playMistralAudio(result.audioB64, 'wav');
        }
        return false;
    }).then(function() {
        state.speaking = false;
        setVoiceStatus(voiceState.listening ? 'En écoute' : '');
        voiceState.waiting = false;
    }).catch(function(e) {
        console.error('[Voice AI] Error:', e);
        state.speaking = false;
        setVoiceStatus(voiceState.listening ? 'En écoute' : '');
        voiceState.waiting = false;
    });
}

function startVoiceAI() {
    if (voiceState.listening) return;
    // Speech recognition
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setVoiceStatus('Pas de reconnaissance'); return; }
    var rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'fr-FR';
    rec.onresult = function(e) {
        for (var i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) {
                var t = e.results[i][0].transcript.trim();
                if (t) onUserText(t);
            }
        }
    };
    rec.onend = function() {
        if (voiceState.listening) try { rec.start(); } catch (e) {}
    };
    rec.onerror = function(e) {
        if (voiceState.listening && e.error !== 'no-speech' && e.error !== 'aborted')
            setTimeout(function() { try { rec.start(); } catch (e) {} }, 800);
    };
    try {
        rec.start();
        voiceState.recognition = rec;
        voiceState.listening = true;
        setVoiceStatus('En écoute');
    } catch (e) {
        setVoiceStatus('Erreur micro');
    }
}

function stopVoiceAI() {
    voiceState.listening = false;
    if (voiceState.recognition) {
        try { voiceState.recognition.abort(); } catch (e) {}
        voiceState.recognition = null;
    }
    setVoiceStatus('');
}

// ---- Event Listeners ----
document.addEventListener('DOMContentLoaded', () => {

    // ---- COMMENCER: unlock audio + camera + voice AI ----
    $('btn-start').addEventListener('click', async () => {
        // 1) Unlock audio IMMEDIATELY in the click handler
        await unlockAudio();

        showScreen('screen-camera');
        const ok = await startCamera();
        if (!ok) { showScreen('screen-welcome'); return; }

        state.currentPhoto = 0;
        state.photos = [];
        $('photo-count').textContent = '0';

        // 2) Start voice AI (speech recognition + conversation)
        startVoiceAI();

        // 3) Longue introduction
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
    $('btn-cancel').addEventListener('click', () => { stopVoiceAI(); stopCamera(); resetSession(); });

    // ---- Retake ----
    $('btn-retake').addEventListener('click', async () => {
        await unlockAudio();
        resetSession();
        showScreen('screen-camera');
        await startCamera();
        startVoiceAI();
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
