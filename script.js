// ============================================================
// Météo App — version simplifiée
// ============================================================

// ---- Constantes ----
const SAVED_CITIES_KEY = 'savedCities_v1';
const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';
const WX_API = 'https://api.open-meteo.com/v1/forecast';

// ---- État global ----
let savedCities = [];
let currentCity = 'Paris';
let currentCoords = { lat: 48.8566, lon: 2.3522 };
let citiesEditMode = false;
let weatherRequestSeq = 0;

// ---- Helpers ----
function normalizeCityKey(name) {
  return (name || '').trim().toLowerCase();
}

function $(id) { return document.getElementById(id); }

// ---- LocalStorage ----
function loadSavedCities() {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_CITIES_KEY));
    if (Array.isArray(raw) && raw.length) return raw;
  } catch (_) {}
  return ['Paris', 'Lyon', 'Marseille'];
}

function saveSavedCities() {
  localStorage.setItem(SAVED_CITIES_KEY, JSON.stringify(savedCities));
}

// ---- API ----
async function searchCityCoords(query) {
  const url = `${GEO_API}?name=${encodeURIComponent(query)}&count=5&language=fr&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.results && data.results.length) {
    const r = data.results[0];
    return { name: r.name, lat: r.latitude, lon: r.longitude, country: r.country, admin1: r.admin1 };
  }
  return null;
}

async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,pressure_msl,is_day,precipitation',
    hourly: 'temperature_2m,weather_code,precipitation_probability',
    daily: 'temperature_2m_max,temperature_2m_min,weather_code,precipitation_sum',
    timezone: 'auto',
    forecast_days: 10
  });
  const url = `${WX_API}?${params}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Erreur API météo');
  return res.json();
}

// ---- Vue liste / détail ----
function showCitiesView() {
  $('cities-view').classList.remove('hidden');
  $('detail-view').classList.add('hidden');
  renderCitiesList();
}

function showDetailView() {
  $('cities-view').classList.add('hidden');
  $('detail-view').classList.remove('hidden');
}

// ---- Description WMO ----
function getWeatherDescription(code) {
  const map = {
    0: 'Ciel dégagé', 1: 'Principalement dégagé', 2: 'Partiellement nuageux',
    3: 'Nuageux', 45: 'Brumeux', 48: 'Brouillard givrant',
    51: 'Bruine légère', 53: 'Bruine modérée', 55: 'Bruine dense',
    56: 'Verglas léger', 57: 'Verglas dense',
    61: 'Pluie légère', 63: 'Pluie modérée', 65: 'Pluie forte',
    66: 'Pluie verglaçante légère', 67: 'Pluie verglaçante forte',
    71: 'Neige légère', 73: 'Neige modérée', 75: 'Neige forte',
    77: 'Grésil', 80: 'Averses légères', 81: 'Averses modérées',
    82: 'Averses violentes', 85: 'Averses de neige légères', 86: 'Averses de neige fortes',
    95: 'Orage', 96: 'Orage avec grêle légère', 99: 'Orage avec grêle forte'
  };
  return map[code] || '—';
}

// ---- Affichage détail ----
function renderWeatherDetail(cityData, data) {
  const current = data.current;
  const daily = data.daily;
  const hourly = data.hourly;

  // --- En-tête ---
  document.querySelector('.city').textContent = currentCity;
  document.querySelector('.big-temp').innerHTML = `${Math.round(current.temperature_2m)}°`;

  const conditionText = getWeatherDescription(current.weather_code);
  document.querySelector('.condition').textContent = conditionText;

  // --- Hi/Lo ---
  const hl = document.querySelector('.high-low');
  if (hl && daily) {
    hl.innerHTML = `<span>H:${Math.round(daily.temperature_2m_max[0])}°</span><span>L:${Math.round(daily.temperature_2m_min[0])}°</span>`;
  }

  // --- Icône météo ---
  const hero = document.querySelector('.weather-hero');
  let iconWrap = hero ? hero.querySelector('.weather-icon-container') : null;
  if (!iconWrap && hero) {
    iconWrap = document.createElement('div');
    iconWrap.className = 'weather-icon-container';
    iconWrap.style.cssText = 'display:flex;justify-content:center;margin-bottom:10px';
    const bigTemp = hero.querySelector('.big-temp');
    if (bigTemp) hero.insertBefore(iconWrap, bigTemp);
    else hero.prepend(iconWrap);
  }
  if (iconWrap) {
    iconWrap.innerHTML = createWeatherIconSVG(current.weather_code, current.is_day !== 0, 80);
  }

  // --- Cartes détails ---
  setText('humidity', `${current.relative_humidity_2m}%`);
  setInnerHTML('wind', `${Math.round(current.wind_speed_10m)} <span class="unit">km/h</span>`);

  if (current.pressure_msl != null) {
    setInnerHTML('pressure', `${Math.round(current.pressure_msl)} <span class="unit">hPa</span>`);
  }

  // Précipitations : on prend la somme du jour ou la valeur instantanée
  const precipNow = current.precipitation != null ? current.precipitation : (daily ? daily.precipitation_sum[0] : 0);
  setInnerHTML('precipitation', `${precipNow} <span class="unit">mm</span>`);

  // Qualité de l'air (placeholder)
  setText('air-quality', '—');
  setText('air-quality-desc', 'Données bientôt');

  // --- Alertes (placeholder) ---
  setText('alert-title', 'Aucune alerte');
  setText('alert-desc', '—');

  // --- Horaire ---
  renderHourly(hourly);

  // --- Quotidien ---
  renderDaily(daily);

  // --- Pluie prochaine heure ---
  updateNextHourRain(hourly);

  // --- IA (placeholder) ---
  const iaContent = $('ia-meteo-content');
  if (iaContent) {
    const t = Math.round(current.temperature_2m);
    const h = current.relative_humidity_2m;
    let advice = '';
    if (t > 30) advice = 'Il fait très chaud aujourd\'hui. Pensez à vous hydrater et éviter les efforts aux heures les plus chaudes.';
    else if (t < 5) advice = 'Températures froides aujourd\'hui. Couvrez-vous bien et faites attention au verglas possible.';
    else if (current.weather_code >= 61 && current.weather_code <= 67) advice = 'De la pluie est prévue aujourd\'hui. N\'oubliez pas votre parapluie !';
    else if (current.weather_code >= 71 && current.weather_code <= 77) advice = 'Chutes de neige attendues. Soyez prudent sur les routes et prévoyez des vêtements chauds.';
    else if (current.weather_code >= 95) advice = 'Orages possibles aujourd\'hui. Restez à l\'abri et évitez les activités en extérieur.';
    else advice = `Belle journée avec ${t}°C et ${h}% d'humidité. Profitez-en !`;
    iaContent.innerHTML = `<div style="font-size:14px;line-height:1.5;color:rgba(255,255,255,0.85);padding:8px 0">${advice}</div>`;
  }
}

function setText(id, val) {
  const el = $(id);
  if (el) el.textContent = val;
}

function setInnerHTML(id, val) {
  const el = $(id);
  if (el) el.innerHTML = val;
}

// ---- Horaire ----
function renderHourly(hourly) {
  const container = $('hourly-list');
  if (!container) return;

  const times = hourly.time || [];
  const temps = hourly.temperature_2m || [];
  const codes = hourly.weather_code || [];
  const probs = hourly.precipitation_probability || [];
  let html = '';

  // L'API Open-Meteo retourne les heures déjà dans le fuseau horaire de la ville
  // (grâce à timezone='auto'). On extrait l'heure depuis la chaîne ISO
  // pour éviter tout décalage lié au fuseau du navigateur.
  const currentHour = times[0] ? parseInt(times[0].split('T')[1].split(':')[0]) : 0;

  for (let i = 0; i < Math.min(24, times.length); i++) {
    const h = parseInt(times[i].split('T')[1].split(':')[0]);
    const label = i === 0 ? 'Maintenant' : `${h}h`;
    // isDay = entre 6h et 21h (jour) sinon nuit
    const isDay = h >= 6 && h < 21;
    const icon = createWeatherIconSVG(codes[i], isDay, 28);
      html += `<div class="hourly-item">
        <div class="time">${label}</div>
        <div class="icon">${icon}</div>
        <div class="temp">${Math.round(temps[i] || 0)}°</div>
        ${probs[i] != null ? `<div class="rain">${probs[i]}%</div>` : ''}
      </div>`;
  }
  container.innerHTML = html;
}

// ---- Quotidien ----
function renderDaily(daily) {
  const container = $('daily-list');
  if (!container) return;

  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  const times = daily.time || [];
  const maxs = daily.temperature_2m_max || [];
  const mins = daily.temperature_2m_min || [];
  const codes = daily.weather_code || [];
  const precips = daily.precipitation_sum || [];
  let html = '';

  for (let i = 0; i < Math.min(10, times.length); i++) {
    const date = new Date(times[i] + 'T12:00:00');
    const dayName = i === 0 ? "Aujourd'hui" : i === 1 ? 'Demain' : days[date.getDay()] || '';
    const icon = createWeatherIconSVG(codes[i], true, 28);
    const cond = getWeatherDescription(codes[i]);
    const precip = precips[i] ? `${precips[i]}mm` : '';
    html += `<div class="daily-item">
      <div class="day">${dayName}</div>
      <div class="icon">${icon}</div>
      <div class="condition">${cond}</div>
      <div class="daily-precip">${precip}</div>
      <div class="-temps">
        <span class="temp-high">${Math.round(maxs[i])}°</span>
        <span class="temp-low">${Math.round(mins[i])}°</span>
      </div>
    </div>`;
  }
  container.innerHTML = html;
}

// ---- Pluie prochaine heure ----
function updateNextHourRain(hourly) {
  const probEl = $('next-hour-rain-prob');
  const textEl = $('next-hour-rain-text');
  if (!probEl || !textEl) return;
  const probs = hourly.precipitation_probability || [];
  const nextProb = probs[0] || 0;
  probEl.textContent = `${nextProb}%`;
  if (nextProb > 50) textEl.textContent = 'Risque de pluie';
  else if (nextProb > 20) textEl.textContent = 'Pluie possible';
  else textEl.textContent = 'Pas de pluie prévue';
}

// ---- Chargement météo ----
async function updateWeatherByCoords(lat, lon) {
  const requestId = ++weatherRequestSeq;

  // Reverse geocoding via Nominatim
  let cityName = 'Ma position';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=fr`, {
      headers: { 'User-Agent': 'MeteoApp/1.0' }
    });
    const geo = await res.json();
    if (geo && geo.address) {
      cityName = geo.address.city || geo.address.town || geo.address.village || geo.address.county || 'Ma position';
    }
  } catch (_) {}

  if (requestId !== weatherRequestSeq) return;
  currentCoords = { lat, lon };
  currentCity = cityName;

  // Show loading
  const cityEl = document.querySelector('.city');
  const tempEl = document.querySelector('.big-temp');
  const condEl = document.querySelector('.condition');
  if (cityEl) cityEl.textContent = cityName;
  if (tempEl) tempEl.textContent = '...';
  if (condEl) condEl.textContent = 'Chargement…';

  try {
    const weather = await fetchWeather(lat, lon);
    if (requestId !== weatherRequestSeq) return;
    renderWeatherDetail(null, weather);
    showDetailView();
  } catch (err) {
    console.error(err);
    if (condEl) condEl.textContent = 'Erreur de connexion';
  }
}

async function updateWeather(cityName) {
  const requestId = ++weatherRequestSeq;

  // Show loading immediately
  const cityEl = document.querySelector('.city');
  const tempEl = document.querySelector('.big-temp');
  const condEl = document.querySelector('.condition');
  if (cityEl) cityEl.textContent = cityName;
  if (tempEl) tempEl.textContent = '...';
  if (condEl) condEl.textContent = 'Recherche…';

  const cityData = await searchCityCoords(cityName);
  if (requestId !== weatherRequestSeq) return;

  if (!cityData) {
    if (condEl) condEl.textContent = 'Ville non trouvée';
    return;
  }

  currentCity = cityData.name;
  currentCoords = { lat: cityData.lat, lon: cityData.lon };
  if (cityEl) cityEl.textContent = currentCity;
  if (condEl) condEl.textContent = 'Chargement…';

  try {
    const weather = await fetchWeather(cityData.lat, cityData.lon);
    if (requestId !== weatherRequestSeq) return;
    renderWeatherDetail(cityData, weather);
    showDetailView();
  } catch (err) {
    console.error(err);
    if (condEl) condEl.textContent = 'Erreur de connexion';
  }
}

// ---- Liste des villes ----
function renderCitiesList() {
  const container = $('cities-list');
  if (!container) return;

  if (savedCities.length === 0) {
    container.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.5)">Ajoutez une ville avec la recherche</div>';
    return;
  }

  let html = '';
  for (const city of savedCities) {
    html += `<div class="city-card" data-city="${city.replace(/"/g, '&quot;')}">
      ${citiesEditMode ? `<button class="city-card-delete" data-city="${city.replace(/"/g, '&quot;')}">✕</button>` : ''}
      <div class="city-card-name">${city}</div>
      <div class="city-card-temp">--°</div>
    </div>`;
  }
  container.innerHTML = html;

  // Click sur une carte → charger la météo
  container.querySelectorAll('.city-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('city-card-delete')) return;
      updateWeather(card.dataset.city);
    });
  });

  // Boutons supprimer
  container.querySelectorAll('.city-card-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const city = btn.dataset.city;
      savedCities = savedCities.filter(c => normalizeCityKey(c) !== normalizeCityKey(city));
      saveSavedCities();
      renderCitiesList();
    });
  });
}

// ---- Recherche ----
function setupSearchListeners() {
  const inputs = ['city-input', 'city-input-2'];

  for (const id of inputs) {
    const input = $(id);
    if (!input) continue;

    const doSearch = async () => {
      const query = input.value.trim();
      if (query.length < 2) { hideSuggestions(); return; }

      const url = `${GEO_API}?name=${encodeURIComponent(query)}&count=6&language=fr&format=json`;
      try {
        const res = await fetch(url);
        const data = await res.json();
        showSuggestions(data.results || []);
      } catch (_) {
        hideSuggestions();
      }
    };

    let timer;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(doSearch, 300);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        clearTimeout(timer);
        const query = input.value.trim();
        if (query) {
          hideSuggestions();
          updateWeather(query);
        }
      }
    });

    input.addEventListener('focus', () => {
      if (input.value.trim().length >= 2) doSearch();
    });
  }

  // Fermer les suggestions au clic extérieur
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-container')) hideSuggestions();
  });
}

function showSuggestions(results) {
  const container = $('search-suggestions');
  if (!container) return;

  if (!results || results.length === 0) {
    container.classList.add('hidden');
    return;
  }

  let html = '';
  for (const r of results) {
    const label = `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}${r.country ? ', ' + r.country : ''}`;
    html += `<div class="suggestion-item" data-lat="${r.latitude}" data-lon="${r.longitude}" data-name="${r.name.replace(/"/g, '&quot;')}">${label}</div>`;
  }
  container.innerHTML = html;
  container.classList.remove('hidden');

  container.querySelectorAll('.suggestion-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.name;
      currentCoords = { lat: parseFloat(item.dataset.lat), lon: parseFloat(item.dataset.lon) };

      // Ajouter aux villes sauvegardées si nouveau
      if (!savedCities.some(c => normalizeCityKey(c) === normalizeCityKey(name))) {
        savedCities.push(name);
        saveSavedCities();
      }

      hideSuggestions();
      // Vider les champs de recherche
      ['city-input', 'city-input-2'].forEach(id => { const el = $(id); if (el) el.value = ''; });
      updateWeather(name);
    });
  });
}

function hideSuggestions() {
  const container = $('search-suggestions');
  if (container) container.classList.add('hidden');
}

// ---- Initialisation ----
document.addEventListener('DOMContentLoaded', () => {
  // Charger les villes sauvegardées
  savedCities = loadSavedCities();

  // Afficher la vue liste
  showCitiesView();

  // Recherche
  setupSearchListeners();

  // Bouton retour liste
  const backBtn = $('back-to-cities');
  if (backBtn) backBtn.addEventListener('click', showCitiesView);

  // Bouton fermer (✕)
  const closeBtn = $('cities-close');
  if (closeBtn) closeBtn.addEventListener('click', showCitiesView);

  // Mode édition (crayon)
  const editBtn = $('cities-edit');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      citiesEditMode = !citiesEditMode;
      $('cities-list')?.classList.toggle('cities-edit-mode', citiesEditMode);
      renderCitiesList();
    });
  }

  // Charger Paris au démarrage
  updateWeather('Paris');

  // Géolocalisation en arrière-plan
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        try {
          localStorage.setItem('lastCoords', JSON.stringify({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            timestamp: Date.now()
          }));
        } catch (_) {}
        updateWeatherByCoords(pos.coords.latitude, pos.coords.longitude);
      },
      () => {},
      { timeout: 5000, maximumAge: 300000 }
    );
  }
});
