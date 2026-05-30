/* ============================================
   Météo App — Clean Script
   ============================================ */

// ---- Constantes ----
const SAVED_CITIES_KEY = 'meteo_cities';
const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';
const WX_API = 'https://api.open-meteo.com/v1/forecast';

// ---- État ----
let state = {
    cities: [],
    currentCity: 'Paris',
    coords: { lat: 48.8566, lon: 2.3522 },
    editMode: false,
    reqSeq: 0,
    isSearching: false
};

// ---- Helpers ----
const $ = id => document.getElementById(id);
const norm = s => (s || '').trim().toLowerCase();

function getWindDir(deg) {
    if (deg == null) return '—';
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
    return dirs[Math.round(deg / 22.5) % 16] || '—';
}

function fmtTime(iso) {
    if (!iso) return '--:--';
    try { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
    catch (_) { return '--:--'; }
}

function fmtDay(dateStr, i) {
    const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
    if (i === 0) return "Aujourd'hui";
    if (i === 1) return 'Demain';
    const d = new Date(dateStr + 'T12:00:00');
    return days[d.getDay()] || '';
}

// ---- LocalStorage ----
function loadCities() {
    try {
        const raw = JSON.parse(localStorage.getItem(SAVED_CITIES_KEY));
        if (Array.isArray(raw) && raw.length) return raw;
    } catch (_) {}
    return ['Paris', 'Lyon', 'Marseille'];
}
function saveCities() {
    localStorage.setItem(SAVED_CITIES_KEY, JSON.stringify(state.cities));
}

// ---- API ----
async function searchCity(query) {
    const url = `${GEO_API}?name=${encodeURIComponent(query)}&count=5&language=fr&format=json`;
    const res = await fetch(url);
    const data = await res.json();
    return data.results || [];
}

async function getCoords(query) {
    const results = await searchCity(query);
    if (!results.length) return null;
    const r = results[0];
    return { name: r.name, lat: r.latitude, lon: r.longitude, country: r.country, admin1: r.admin1 };
}

async function getWeather(lat, lon) {
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,is_day,precipitation,cloud_cover,visibility,dew_point_2m,uv_index',
        hourly: 'temperature_2m,weather_code,precipitation_probability,wind_speed_10m',
        daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum,wind_speed_10m_max,wind_direction_10m_dominant,uv_index_max,sunrise,sunset',
        timezone: 'auto',
        forecast_days: 10
    });
    const res = await fetch(`${WX_API}?${params}`);
    if (!res.ok) throw new Error('API error');
    return res.json();
}

// ---- Descriptions WMO ----
const WMO = {
    0: 'Ciel dégagé', 1: 'Peu nuageux', 2: 'Partiellement nuageux',
    3: 'Nuageux', 45: 'Brumeux', 48: 'Brouillard',
    51: 'Bruine', 53: 'Bruine modérée', 55: 'Bruine dense',
    56: 'Verglas', 57: 'Verglas dense',
    61: 'Pluie légère', 63: 'Pluie', 65: 'Forte pluie',
    66: 'Pluie verglaçante', 67: 'Forte pluie verglaçante',
    71: 'Neige légère', 73: 'Neige', 75: 'Forte neige',
    77: 'Grésil', 80: 'Averses', 81: 'Averses modérées',
    82: 'Averses violentes', 85: 'Averses neige', 86: 'Fortes averses neige',
    95: 'Orage', 96: 'Orage grêle', 99: 'Orage grêle fort'
};
const desc = c => WMO[c] || '—';

// ---- Background ----
function setBg(code, isDay) {
    const el = $('bg-layer');
    if (!el) return;
    el.className = 'bg-layer';
    let cls = 'bg-default';
    if (code === 0 || code === 1) cls = isDay ? 'bg-sunny' : 'bg-night';
    else if (code === 2 || code === 3) cls = isDay ? 'bg-cloudy' : 'bg-night';
    else if (code >= 45 && code <= 48) cls = 'bg-fog';
    else if ((code >= 51 && code <= 82) || (code >= 80 && code <= 82)) cls = 'bg-rain';
    else if (code >= 71 && code <= 77) cls = 'bg-snow';
    else if (code >= 95) cls = 'bg-storm';
    el.classList.add(cls);
}

// ---- Navigation ----
function showDetail() {
    $('detail-view').classList.remove('hidden');
    $('cities-view').classList.add('hidden');
}
function showCities() {
    $('detail-view').classList.add('hidden');
    $('cities-view').classList.remove('hidden');
    renderCities();
}

// ---- Afficher météo ----
function display(data, cityName) {
    const c = data.current, d = data.daily, h = data.hourly;
    if (!c) return;

    state.currentCity = cityName;
    state.coords = { lat: data.latitude, lon: data.longitude };

    setBg(c.weather_code, c.is_day !== 0);

    // Hero
    $('hero-icon').innerHTML = createWeatherIconSVG(c.weather_code, c.is_day !== 0, 80);
    $('hero-temp').textContent = `${Math.round(c.temperature_2m)}°`;
    $('hero-desc').textContent = desc(c.weather_code);
    if (d) {
        $('hero-hl').textContent = `H:${Math.round(d.temperature_2m_max[0])}°  L:${Math.round(d.temperature_2m_min[0])}°`;
    }

    // Hourly
    renderHourly(h);

    // Daily
    if (d) renderDaily(d);

    // Details
    setText('d-feels', `${Math.round(c.apparent_temperature)}°`);
    setText('d-feels-desc', c.apparent_temperature > c.temperature_2m ? 'Plus chaud' : 'Plus frais');
    setText('d-humidity', `${c.relative_humidity_2m}%`);
    setText('d-dew', c.dew_point_2m != null ? `Rosée: ${Math.round(c.dew_point_2m)}°` : '—');
    setInnerH('d-wind', `${Math.round(c.wind_speed_10m)} <span class="unit">km/h</span>`);
    setText('d-wind-dir', getWindDir(c.wind_direction_10m));
    if (c.uv_index != null) {
        const uv = c.uv_index;
        setText('d-uv', uv.toFixed(1));
        setText('d-uv-desc', uv < 3 ? 'Faible' : uv < 6 ? 'Modéré' : uv < 8 ? 'Élevé' : uv < 11 ? 'Très élevé' : 'Extrême');
    }
    const precip = c.precipitation != null ? c.precipitation : (d ? d.precipitation_sum[0] : 0);
    setInnerH('d-precip', `${precip} <span class="unit">mm</span>`);
    setText('d-precip-desc', precip === 0 ? 'Aucune' : `${Math.round(precip)} mm aujourd'hui`);
    if (c.visibility != null) {
        const v = (c.visibility / 1000).toFixed(1);
        setInnerH('d-vis', `${v} <span class="unit">km</span>`);
        setText('d-vis-desc', v < 1 ? 'Très faible' : v < 4 ? 'Faible' : v < 10 ? 'Modérée' : v < 20 ? 'Bonne' : 'Excellente');
    }
    if (c.pressure_msl != null) {
        setInnerH('d-pressure', `${Math.round(c.pressure_msl)} <span class="unit">hPa</span>`);
        setText('d-pressure-trend', c.pressure_msl > 1013 ? 'Haute' : 'Basse');
    }
    setInnerH('d-clouds', `${c.cloud_cover} <span class="unit">%</span>`);
    setText('d-clouds-desc', c.cloud_cover < 10 ? 'Ciel dégagé' : c.cloud_cover < 30 ? 'Peu nuageux' : c.cloud_cover < 60 ? 'Nuageux' : c.cloud_cover < 85 ? 'Très nuageux' : 'Couvert');
    if (d && d.sunrise && d.sunrise[0]) {
        setText('d-sunrise', fmtTime(d.sunrise[0]));
        setText('d-sunrise-desc', 'Lever');
    }
    if (d && d.sunset && d.sunset[0]) {
        setText('d-sunset', fmtTime(d.sunset[0]));
        setText('d-sunset-desc', 'Coucher');
    }

    // Footer
    const now = new Date();
    $('footer-info').textContent = `Mis à jour ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} • ${cityName}`;
}

function setText(id, val) { const el = $(id); if (el) el.textContent = val; }
function setInnerH(id, val) { const el = $(id); if (el) el.innerHTML = val; }

// ---- Hourly ----
function renderHourly(h) {
    const container = $('hourly-scroll');
    if (!container || !h || !h.time) return;
    const times = h.time, temps = h.temperature_2m, codes = h.weather_code, probs = h.precipitation_probability || [];
    const nowH = new Date().getHours();
    const startIdx = Math.max(0, Math.min(times.length - 1, nowH));

    let html = '';
    for (let i = 0; i < Math.min(24, times.length - startIdx); i++) {
        const idx = startIdx + i;
        const hour = parseInt(times[idx].split('T')[1].split(':')[0]);
        const label = i === 0 ? 'Maintenant' : `${hour}h`;
        const isDay = hour >= 6 && hour < 21;
        const icon = createWeatherIconSVG(codes[idx], isDay, 26);
        html += `<div class="hour-item${i === 0 ? ' now' : ''}">
            <div class="h-time">${label}</div>
            <div class="h-icon">${icon}</div>
            <div class="h-temp">${Math.round(temps[idx])}°</div>
            ${probs[idx] != null ? `<div class="h-rain">${probs[idx]}%</div>` : ''}
        </div>`;
    }
    container.innerHTML = html;
}

// ---- Daily ----
function renderDaily(d) {
    const container = $('daily-list');
    if (!container || !d || !d.time) return;
    let html = '';
    for (let i = 0; i < d.time.length; i++) {
        const icon = createWeatherIconSVG(d.weather_code[i], true, 24);
        const precip = d.precipitation_sum ? Math.round(d.precipitation_sum[i]) : 0;
        html += `<div class="daily-item">
            <div class="d-day">${fmtDay(d.time[i], i)}</div>
            <div class="d-icon">${icon}</div>
            <div class="d-name">${desc(d.weather_code[i])}</div>
            ${precip > 0 ? `<div class="d-precip">${precip}mm</div>` : '<div class="d-precip"></div>'}
            <div class="d-temps">
                <div class="d-high">${Math.round(d.temperature_2m_max[i])}°</div>
                <div class="d-low">${Math.round(d.temperature_2m_min[i])}°</div>
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

// ---- Charger une ville ----
async function loadWeather(cityName) {
    const seq = ++state.reqSeq;
    const condEl = $('hero-desc');
    if (condEl) condEl.textContent = 'Recherche...';

    const cd = await getCoords(cityName);
    if (seq !== state.reqSeq) return;
    if (!cd) { if (condEl) condEl.textContent = 'Ville non trouvée'; return; }

    state.coords = { lat: cd.lat, lon: cd.lon };
    state.currentCity = cd.name;
    if (condEl) condEl.textContent = 'Chargement...';

    try {
        const data = await getWeather(cd.lat, cd.lon);
        if (seq !== state.reqSeq) return;
        display(data, cd.name);
        showDetail();

        // Save city
        if (!state.cities.some(c => norm(c) === norm(cd.name))) {
            state.cities.push(cd.name);
            saveCities();
        }
    } catch (_) {
        if (condEl) condEl.textContent = 'Erreur de connexion';
    }
}

// ---- Géolocalisation ----
async function loadGeolocation() {
    if (!navigator.geolocation) { loadWeather('Paris'); return; }
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
            try {
                const res = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=json&accept-language=fr`,
                    { headers: { 'User-Agent': 'MeteoApp/1.0' } }
                );
                const geo = await res.json();
                const city = geo.address?.city || geo.address?.town || geo.address?.village || 'Ma position';
                const data = await getWeather(pos.coords.latitude, pos.coords.longitude);
                display(data, city);
                showDetail();
            } catch (_) { loadWeather('Paris'); }
        },
        () => loadWeather('Paris'),
        { timeout: 8000, maximumAge: 300000 }
    );
}

// ---- Villes liste ----
function renderCities() {
    const container = $('cities-list');
    if (!container) return;
    if (!state.cities.length) {
        container.innerHTML = '<div class="cities-empty">Ajoutez une ville avec la recherche</div>';
        return;
    }
    container.innerHTML = state.cities.map(city =>
        `<div class="city-card" data-city="${city.replace(/"/g, '&quot;')}">
            ${state.editMode ? `<button class="city-card-edit" data-city="${city.replace(/"/g, '&quot;')}">✕</button>` : ''}
            <div class="city-card-name">${city}</div>
            <div class="city-card-temp">—°</div>
        </div>`
    ).join('');

    container.querySelectorAll('.city-card').forEach(card => {
        card.addEventListener('click', e => {
            if (e.target.classList.contains('city-card-edit')) return;
            loadWeather(card.dataset.city);
        });
    });
    container.querySelectorAll('.city-card-edit').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            state.cities = state.cities.filter(c => norm(c) !== norm(btn.dataset.city));
            saveCities();
            renderCities();
        });
    });
}

// ---- Recherche ----
let searchTimer;
function setupSearch() {
    const input = $('search-input');
    if (!input) return;

    input.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = input.value.trim();
        if (q.length < 2) { hideSuggestions(); return; }
        searchTimer = setTimeout(() => doSearch(q), 300);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            clearTimeout(searchTimer);
            const q = input.value.trim();
            if (q) { hideSuggestions(); loadWeather(q); }
        }
    });
}

async function doSearch(query) {
    const results = await searchCity(query);
    const container = $('suggestions');
    if (!container) return;
    if (!results.length) { container.classList.remove('active'); return; }

    container.innerHTML = results.map(r => {
        const label = `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}${r.country ? ', ' + r.country : ''}`;
        return `<div class="suggestion-item" data-name="${r.name.replace(/"/g, '&quot;')}" data-lat="${r.latitude}" data-lon="${r.longitude}">
            ${label}
        </div>`;
    }).join('');
    container.classList.add('active');

    container.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            const name = item.dataset.name;
            hideSuggestions();
            input.value = '';
            loadWeather(name);
        });
    });
}

function hideSuggestions() {
    const c = $('suggestions');
    if (c) c.classList.remove('active');
    const d = $('suggestions-dropdown');
    if (d) d.classList.remove('active');
}

// ---- Initialisation ----
document.addEventListener('DOMContentLoaded', () => {
    state.cities = loadCities();
    showCities();

    // Navigation
    $('btn-menu')?.addEventListener('click', showCities);
    $('btn-location')?.addEventListener('click', loadGeolocation);
    $('btn-edit-cities')?.addEventListener('click', () => {
        state.editMode = !state.editMode;
        $('cities-list')?.classList.toggle('cities-edit-mode', state.editMode);
        renderCities();
    });

    setupSearch();

    // Charger Paris au démarrage
    loadWeather('Paris');

    // Geoloc silencieuse
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                localStorage.setItem('lastCoords', JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude, timestamp: Date.now() }));
            },
            () => {},
            { timeout: 5000, maximumAge: 300000 }
        );
    }
});
