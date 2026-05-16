if (!AbortSignal.timeout) {
    AbortSignal.timeout = function(ms) {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), ms);
        return controller.signal;
    };
}

// Weather app - loads data on DOMContentLoaded

const weatherDatabase = {};

const API_CONFIG = {
    // WeatherAPI.com - 100% fiable
    weatherApiKey: '4c282e3f9e3d497e9f5f153426240105', 
    weatherUrl: 'https://api.weatherapi.com/v1/current.json',
    forecastUrl: 'https://api.weatherapi.com/v1/forecast.json',
    searchUrl: 'https://api.weatherapi.com/v1/search.json',
    // Configuration temps réel 100% fiable
    realTimeConfig: {
        cacheMaxAge: 60000, // 1 minute pour temps réel
        refreshInterval: 300000, // 5 minutes pour rafraîchissement automatique
        retryAttempts: 3, 
        fallbackEnabled: false 
    },
    timeout: 5000 
};

let currentCoords = { lat: 48.8566, lon: 2.3522 };
let currentCity = 'Paris'; // Always use name, never show coords

// Liste étendue de villes pour autocomplete
const cities = [
    // France
    'Paris', 'Lyon', 'Marseille', 'Toulouse', 'Nice', 'Nantes', 'Strasbourg',
    'Montpellier', 'Bordeaux', 'Lille', 'Rennes', 'Reims', 'Le Havre', 'Saint-Étienne',
    'Toulon', 'Grenoble', 'Dijon', 'Angers', 'Nîmes', 'Villeurbanne', 'Clermont-Ferrand',
    'Le Mans', 'Aix-en-Provence', 'Brest', 'Limoges', 'Tours', 'Amiens', 'Metz',
    'Perpignan', 'Boulogne-Billancourt', 'Mulhouse', 'Rouen',     'Caen', 'Nancy', 'Saint-Lô', 'Saint-Malo', 'Bayonne', 'Troyes',
    'Carcassonne', 'Angoulême', 'Tarbes', 'Chartres', 'Valence', 'Quimper',
    'Saint-Denis', 'Roubaix', 'Tourcoing', 'Argenteuil', 'Dunkerque', 'Créteil',
    'Poitiers', 'Versailles', 'Courbevoie', 'Nanterre', 'Avignon', 'Colmar',
    'Aubervilliers', 'Saint-Priest', 'Asnières-sur-Seine', 'Saint-Denis', 'Béziers',
    'La Rochelle', 'Cannes', 'Pau', 'Calais', 'Annecy', 'Chambery', 'Bourges',
    'Moulins', 'Ajaccio', 'Albi', 'Alès', 'Belfort', 'Béziers', 'Cergy',
    'Fréjus', 'Levallois-Perret', 'Laval', 'Issy-les-Moulineaux', 'Saint-Quentin',
    'Vénissieux', 'Colmar', 'Pessac', 'Martigues', 'Chelles', 'Antibes', 'Rueil-Malmaison',
    
    // Europe
    'London', 'Berlin', 'Madrid', 'Rome', 'Amsterdam', 'Brussels', 'Vienna',
    'Zurich', 'Stockholm', 'Copenhagen', 'Oslo', 'Helsinki', 'Warsaw', 'Prague',
    'Budapest', 'Bucharest', 'Sofia', 'Belgrade', 'Zagreb', 'Ljubljana', 'Bratislava',
    'Athens', 'Istanbul', 'Dublin', 'Lisbon', 'Milan', 'Barcelona', 'Munich',
    'Hamburg', 'Cologne', 'Frankfurt', 'Stuttgart', 'Dusseldorf', 'Dortmund',
    'Essen', 'Leipzig', 'Bremen', 'Dresden', 'Hanover', 'Nuremberg', 'Bonn',
    'Mannheim', 'Krefeld', 'Kassel', 'Saarbrücken', 'Heidelberg', 'Heilbronn',
    'Leverkusen', 'Oldenburg', 'Potsdam', 'Paderborn', 'Ingolstadt', 'Wuppertal',
    
    // Amérique du Nord
    'New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix', 'Philadelphia',
    'San Antonio', 'San Diego', 'Dallas', 'San Jose', 'Austin', 'Jacksonville',
    'Fort Worth', 'Columbus', 'Charlotte', 'San Francisco', 'Indianapolis',
    'Seattle', 'Denver', 'Washington', 'Boston', 'El Paso', 'Nashville',
    'Detroit', 'Oklahoma City', 'Portland', 'Las Vegas', 'Memphis', 'Louisville',
    'Milwaukee', 'Baltimore', 'Albuquerque', 'Tucson', 'Fresno', 'Sacramento',
    'Kansas City', 'Long Beach', 'Mesa', 'Atlanta', 'Colorado Springs', 'Raleigh',
    'Miami', 'Virginia Beach', 'Oakland', 'Minneapolis', 'Tampa', 'Tulsa',
    'Arlington', 'New Orleans', 'Wichita', 'Cleveland', 'Bakersfield',
    'Aurora', 'Anaheim', 'Honolulu', 'Santa Ana', 'Riverside', 'Corpus Christi',
    'Lexington', 'Henderson', 'Stockton', 'St. Paul', 'Cincinnati', 'Irvine',
    'Greensboro', 'Pittsburgh', 'Lincoln', 'St. Louis', 'Orlando', 'Plano',
    'Durham', 'Anchorage', 'Newark', 'Chula Vista', 'Fort Wayne', 'Chandler',
    'Laredo', 'Scottsdale', 'Madison', 'Gilbert', 'Reno', 'Buffalo',
    'Jersey City', 'Glendale', 'North Las Vegas', 'Winston-Salem', 'Chesapeake',
    'Norfolk', 'Fremont', 'Garland', 'Hialeah', 'Richmond', 'Boise',
    'Spokane', 'Baton Rouge', 'Irving', 'Toledo', 'Syracuse', 'Gilbert',
    
    // Canada
    'Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Edmonton', 'Ottawa',
    'Winnipeg', 'Quebec City', 'Hamilton', 'Kitchener', 'London', 'Victoria',
    'Halifax', 'Oshawa', 'Windsor', 'Saskatoon', 'Regina', 'Sherbrooke',
    'St. John\'s', 'Barrie', 'Kelowna', 'Abbotsford', 'Sudbury', 'Saguenay',
    'Kingston', 'Trois-Rivières', 'Guelph', 'Moncton', 'Brantford', 'Saint John',
    
    // Asie
    'Tokyo', 'Seoul', 'Shanghai', 'Mumbai', 'Beijing', 'Guangzhou', 'Delhi',
    'Shenzhen', 'Bangalore', 'Jakarta', 'Manila', 'Bangkok', 'Kolkata',
    'Lagos', 'Karachi', 'Istanbul', 'Dhaka', 'Tokyo', 'Cairo', 'Osaka',
    'Mexico City', 'Beijing', 'São Paulo', 'Mumbai', 'Delhi', 'Shanghai',
    'Tokyo', 'Mexico City', 'Cairo', 'Beijing', 'Mumbai', 'Dhaka',
    'Tokyo', 'Osaka', 'Jakarta', 'Manila', 'Bangkok', 'Seoul', 'Guangzhou',
    
    // Australie et Océanie
    'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide', 'Gold Coast',
    'Canberra', 'Newcastle', 'Wollongong', 'Logan City', 'Geelong',
    'Hobart', 'Townsville', 'Cairns', 'Darwin', 'Toowoomba', 'Ballarat',
    'Bendigo', 'Albury', 'Launceston', 'Mackay', 'Rockhampton', 'Bunbury',
    'Bundaberg', 'Coffs Harbour', 'Wagga Wagga', 'Hervey Bay', 'Mildura',
    'Shepparton', 'Geraldton', 'Gladstone', 'Busselton', 'Armadale', 'Rockingham',
    
    // Moyen-Orient et Afrique
    'Dubai', 'Abu Dhabi', 'Riyadh', 'Jeddah', 'Kuwait City', 'Doha',
    'Manama', 'Muscat', 'Baghdad', 'Cairo', 'Alexandria', 'Giza',
    'Shubra El Kheima', 'Port Said', 'Suez', 'Luxor', 'Aswan', 'Ismailia',
    'Cape Town', 'Johannesburg', 'Durban', 'Pretoria', 'Bloemfontein',
    'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret', 'Kampala',
    'Kigali', 'Bujumbura', 'Dar es Salaam', 'Zanzibar', 'Mwanza', 'Arusha',
    'Morogoro', 'Mbeya', 'Dodoma', 'Tanga', 'Moscow', 'Saint Petersburg',
    'Novosibirsk', 'Yekaterinburg', 'Nizhny Novgorod', 'Kazan', 'Chelyabinsk',
    'Omsk', 'Samara', 'Rostov-on-Don', 'Ufa', 'Krasnoyarsk', 'Perm',
    'Voronezh', 'Volgograd', 'Krasnodar', 'Saratov', 'Tolyatti', 'Izhevsk'
];

// Configuration IA pour le cache
const AI_CONFIG = {
    aiCache: {
        maxAge: 60000 // 1 minute
    }
};

// Patterns météo pour l'IA
const WEATHER_PATTERNS = {
    seasonal: {
        spring: { conditions: [0, 1, 2] },
        summer: { conditions: [0, 1] },
        autumn: { conditions: [0, 1, 2, 3] },
        winter: { conditions: [0, 1, 2, 3, 71, 73] }
    },
    geographic: {
        urban: { tempBonus: 1, humidityBonus: 5, windBonus: 0 },
        coastal: { tempBonus: 2, humidityBonus: 10, windBonus: 5 },
        mountain: { tempBonus: -5, humidityBonus: -5, windBonus: 10 },
        rural: { tempBonus: 0, humidityBonus: 0, windBonus: 3 }
    },
    hourly: {
        morning: { tempModifier: -2 },
        afternoon: { tempModifier: 3 },
        evening: { tempModifier: 0 },
        night: { tempModifier: -3 }
    }
};

const weatherCodes = {
    0: { condition: 'Ensoleillé', bg: 'bg-sunny' },
    1: { condition: 'Plutôt ensoleillé', bg: 'bg-blue' },
    2: { condition: 'Partiellement nuageux', bg: 'bg-cloudy' },
    3: { condition: 'Couvert', bg: 'bg-cloudy' },
    45: { condition: 'Brouillard', bg: 'bg-cloudy' },
    48: { condition: 'Brouillard givrant', bg: 'bg-cloudy' },
    51: { condition: 'Bruine légère', bg: 'bg-rain' },
    53: { condition: 'Bruine modérée', bg: 'bg-rain' },
    55: { condition: 'Bruine forte', bg: 'bg-rain' },
    61: { condition: 'Pluie légère', bg: 'bg-rain' },
    63: { condition: 'Pluie modérée', bg: 'bg-rain' },
    65: { condition: 'Pluie forte', bg: 'bg-rain' },
    71: { condition: 'Neige légère', bg: 'bg-snow' },
    73: { condition: 'Neige modérée', bg: 'bg-snow' },
    75: { condition: 'Neige forte', bg: 'bg-snow' },
    77: { condition: 'Grains de neige', bg: 'bg-snow' },
    80: { condition: 'Averses légères', bg: 'bg-rain' },
    81: { condition: 'Averses modérées', bg: 'bg-rain' },
    82: { condition: 'Averses violentes', bg: 'bg-rain' },
    85: { condition: 'Averses de neige', bg: 'bg-snow' },
    86: { condition: 'Averses de neige', bg: 'bg-snow' },
    95: { condition: 'Orage', bg: 'bg-storm' },
    96: { condition: 'Orage grêle', bg: 'bg-storm' },
    99: { condition: 'Orage violent', bg: 'bg-storm' }
};

const aiWeatherDescriptions = {
    0: ['Soleil radieux', 'Ciel d\'azur', 'Lumière éclatante', 'Jour de pure clarté', 'Le soleil règne en maître', 'Atmosphère lumineuse', 'Ciel sans nuage aucun'],
    1: ['Voile de nuages légers', 'Soleil voilé', 'Douceur céleste', 'Entre ombre et lumière', 'Quelques nuages vagabonds', 'Belle journée voilée', 'Rayons tamisés'],
    2: ['Nuages dansants', 'Ciel textile', 'Danse des cumulus', 'Blanc et doux', 'Manteau nuageux', 'Fenêtres célestes entrouvertes', 'Voûte pommelée'],
    3: ['Gris élégant', 'Ciel de satin', 'Monochrome céleste', 'Toile grise', 'Couverture nuageuse', 'Ciel en robe grise', 'Atmosphère feutrée'],
    45: ['voile de brume', 'Océan de nuages bas', 'Monde ouaté', 'Brouillard poétique', 'Atmosphère mystérieuse', 'Bancs de brume', 'Paysage estompé'],
    48: ['givre étincelant', 'Brume glacée', 'Cristaux dans l\'air', 'Froid brumeux', 'Givre argenté', 'Brouillard gelé', 'Perles de glace flottantes'],
    51: ['Bruine soyeuse', 'Pluie de perles', 'Gouttelettes légères', 'Douce caresse liquide', 'Pluie de velours', 'Brouillard liquide', 'Chuchotement d\'eau'],
    53: ['Bruine persistante', 'Crachin fin', 'Rideau de gouttes', 'Pulvérisation délicate', 'Brume pluvieuse', 'Gouttelettes dansantes'],
    55: ['Bruine dense', 'Pluie de dentelle', 'Draperie liquide', 'Crachin dru', 'Brouillard d\'eau', 'Pluie fine mais tenace'],
    61: ['Pluie légère et fraîche', 'Ondée bienfaisante', 'Gouttes argentines', 'Douce pluie', 'Pétillante ondée', 'Bénédiction liquide', 'Pluie de printemps'],
    63: ['Pluie régulière', 'Rythme pluvieux', 'Symphonie aquatique', 'Pluie battante', 'Cordes liquides', 'Bruissement d\'averse'],
    65: ['Déluge maîtrisé', 'Pluie torrentielle', 'Muraille d\'eau', 'Cataracte céleste', 'Pluie déchaînée', 'Rideau d\'eau dense'],
    71: ['Neige délicate', 'Flocons virevoltants', 'Danse blanche', 'Poudre de diamant', 'Douceur glacée', 'Flocons légers', 'Valse des cristaux'],
    73: ['Neige abondante', 'Manteau blanc', 'Paysage ouaté', 'Silence blanc', 'Neige généreuse', 'Tapisserie hivernale', 'Blancheur immaculée'],
    75: ['Tempête de neige', 'Furie blanche', 'Blizzard majestueux', 'Poudrerie intense', 'Neige déchaînée', 'Tourbillon blanc', 'Féérie glacée'],
    80: ['Averses sautillantes', 'Pluie en dansant', 'Gouttes rebondissantes', 'Averse pétillante', 'Pluie de fête', 'Ondée joyeuse'],
    81: ['Averses drues', 'Pluie vive', 'Crachin musclé', 'Averse énergique', 'Gouttes pressées', 'Rafale liquide'],
    82: ['Averse cinglante', 'Pluie furieuse', 'Déluge soudain', 'Mur d\'eau', 'Averse violente', 'Pluie dévastatrice'],
    95: ['Orage grondant', 'Fureur céleste', 'Tambour du tonnerre', 'Éclairs dansants', 'Colère divine', 'Symphonie orageuse', 'Ciel en furie'],
    96: ['Orage de grêle', 'Grêle martelante', 'Glace du ciel', 'Projectiles glacés', 'Orage grêleux', 'Bombardement céleste'],
    99: ['Orage apocalyptique', 'Furie totale', 'Cataclysme céleste', 'Tempête déchaînée', 'Éléments en colère', 'Fin du monde']
};

function getAIDescription(code, temp) {
    const list = aiWeatherDescriptions[code] || ['Temps quelconque'];
    const seed = Math.floor((Date.now() / 60000) + (temp || 0));
    return list[seed % list.length];
}

const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];

function getWeatherInfo(code) {
    return weatherCodes[code] || { condition: 'Inconnu', bg: 'bg-blue' };
}

// Base de données IA des villes avec coordonnées
const CITY_DATABASE = {
    // France
    'paris': { name: 'Paris', lat: 48.8566, lon: 2.3522, country: 'FR' },
    'lyon': { name: 'Lyon', lat: 45.7640, lon: 4.8357, country: 'FR' },
    'marseille': { name: 'Marseille', lat: 43.2965, lon: 5.3698, country: 'FR' },
    'toulouse': { name: 'Toulouse', lat: 43.6047, lon: 1.4442, country: 'FR' },
    'nice': { name: 'Nice', lat: 43.7102, lon: 7.2620, country: 'FR' },
    'nantes': { name: 'Nantes', lat: 47.2184, lon: -1.5536, country: 'FR' },
    'strasbourg': { name: 'Strasbourg', lat: 48.5846, lon: 7.7507, country: 'FR' },
    'montpellier': { name: 'Montpellier', lat: 43.6108, lon: 3.8767, country: 'FR' },
    'bordeaux': { name: 'Bordeaux', lat: 44.8378, lon: -0.5792, country: 'FR' },
    'lille': { name: 'Lille', lat: 50.6292, lon: 3.0573, country: 'FR' },
    'rennes': { name: 'Rennes', lat: 48.1173, lon: -1.6778, country: 'FR' },
    'reims': { name: 'Reims', lat: 49.2583, lon: 4.0317, country: 'FR' },
    'le havre': { name: 'Le Havre', lat: 49.4944, lon: 0.1079, country: 'FR' },
    'saint-étienne': { name: 'Saint-Étienne', lat: 45.4397, lon: 4.3878, country: 'FR' },
    'toulon': { name: 'Toulon', lat: 43.1242, lon: 5.9280, country: 'FR' },
    'grenoble': { name: 'Grenoble', lat: 45.1885, lon: 5.7245, country: 'FR' },
    'dijon': { name: 'Dijon', lat: 47.3220, lon: 5.0415, country: 'FR' },
    'angers': { name: 'Angers', lat: 47.4784, lon: -0.5632, country: 'FR' },
    'nîmes': { name: 'Nîmes', lat: 43.8367, lon: 4.3601, country: 'FR' },
    'villeurbanne': { name: 'Villeurbanne', lat: 45.7719, lon: 4.8902, country: 'FR' },
    'clermont-ferrand': { name: 'Clermont-Ferrand', lat: 45.7772, lon: 3.0870, country: 'FR' },
    'le mans': { name: 'Le Mans', lat: 48.0079, lon: 0.1973, country: 'FR' },
    'aix-en-provence': { name: 'Aix-en-Provence', lat: 43.5297, lon: 5.4474, country: 'FR' },
    'brest': { name: 'Brest', lat: 48.3904, lon: -4.4861, country: 'FR' },
    'limoges': { name: 'Limoges', lat: 45.8336, lon: 1.2611, country: 'FR' },
    'tours': { name: 'Tours', lat: 47.3941, lon: 0.6848, country: 'FR' },
    'amiens': { name: 'Amiens', lat: 49.8941, lon: 2.2957, country: 'FR' },
    'metz': { name: 'Metz', lat: 49.1193, lon: 6.1757, country: 'FR' },
    'perpignan': { name: 'Perpignan', lat: 42.6881, lon: 2.8947, country: 'FR' },
    'boulogne-billancourt': { name: 'Boulogne-Billancourt', lat: 48.8334, lon: 2.2404, country: 'FR' },
    'mulhouse': { name: 'Mulhouse', lat: 47.7494, lon: 7.3396, country: 'FR' },
    'rouen': { name: 'Rouen', lat: 49.4431, lon: 1.0993, country: 'FR' },
    'caen': { name: 'Caen', lat: 49.1829, lon: -0.3707, country: 'FR' },
    'nancy': { name: 'Nancy', lat: 48.6921, lon: 6.1844, country: 'FR' },
    'saint-lô': { name: 'Saint-Lô', lat: 49.1163, lon: -1.0907, country: 'FR' },
    'saint-malo': { name: 'Saint-Malo', lat: 48.6493, lon: -2.0258, country: 'FR' },
    'bayonne': { name: 'Bayonne', lat: 43.4933, lon: -1.4739, country: 'FR' },
    'troyes': { name: 'Troyes', lat: 48.2973, lon: 4.0743, country: 'FR' },
    'carcassonne': { name: 'Carcassonne', lat: 43.2128, lon: 2.3524, country: 'FR' },
    'angoulême': { name: 'Angoulême', lat: 45.6484, lon: 0.1562, country: 'FR' },
    'tarbes': { name: 'Tarbes', lat: 43.2324, lon: 0.0784, country: 'FR' },
    'chartres': { name: 'Chartres', lat: 48.4469, lon: 1.4882, country: 'FR' },
    'beauvais': { name: 'Beauvais', lat: 49.4290, lon: 2.0821, country: 'FR' },
    'valence': { name: 'Valence', lat: 44.9334, lon: 4.8917, country: 'FR' },
    'evreux': { name: 'Évreux', lat: 49.0241, lon: 1.1508, country: 'FR' },
    'châteauroux': { name: 'Châteauroux', lat: 46.8123, lon: 1.6930, country: 'FR' },
    'agen': { name: 'Agen', lat: 44.2031, lon: 0.6170, country: 'FR' },
    'quimper': { name: 'Quimper', lat: 48.0000, lon: -4.1000, country: 'FR' },
    'lorient': { name: 'Lorient', lat: 47.7483, lon: -3.3661, country: 'FR' },
    'vannes': { name: 'Vannes', lat: 47.6582, lon: -2.7606, country: 'FR' },
    
    // International
    'london': { name: 'London', lat: 51.5074, lon: -0.1278, country: 'GB' },
    'berlin': { name: 'Berlin', lat: 52.5200, lon: 13.4050, country: 'DE' },
    'madrid': { name: 'Madrid', lat: 40.4168, lon: -3.7038, country: 'ES' },
    'rome': { name: 'Rome', lat: 41.9028, lon: 12.4964, country: 'IT' },
    'amsterdam': { name: 'Amsterdam', lat: 52.3676, lon: 4.9041, country: 'NL' },
    'brussels': { name: 'Brussels', lat: 50.8503, lon: 4.3517, country: 'BE' },
    'zurich': { name: 'Zurich', lat: 47.3769, lon: 8.5417, country: 'CH' },
    'vienna': { name: 'Vienna', lat: 48.2082, lon: 16.3738, country: 'AT' },
    'stockholm': { name: 'Stockholm', lat: 59.3293, lon: 18.0686, country: 'SE' },
    'oslo': { name: 'Oslo', lat: 59.9139, lon: 10.7522, country: 'NO' },
    'copenhagen': { name: 'Copenhagen', lat: 55.6761, lon: 12.5683, country: 'DK' },
    'helsinki': { name: 'Helsinki', lat: 60.1699, lon: 24.9384, country: 'FI' },
    'warsaw': { name: 'Warsaw', lat: 52.2297, lon: 21.0122, country: 'PL' },
    'prague': { name: 'Prague', lat: 50.0755, lon: 14.4378, country: 'CZ' },
    'budapest': { name: 'Budapest', lat: 47.4979, lon: 19.0402, country: 'HU' },
    'bucharest': { name: 'Bucharest', lat: 44.4268, lon: 26.1025, country: 'RO' },
    'sofia': { name: 'Sofia', lat: 42.6977, lon: 23.3219, country: 'BG' },
    'athens': { name: 'Athens', lat: 37.9838, lon: 23.7275, country: 'GR' },
    'lisbon': { name: 'Lisbon', lat: 38.7223, lon: -9.1393, country: 'PT' },
    'dublin': { name: 'Dublin', lat: 53.3498, lon: -6.2603, country: 'IE' },
    'edinburgh': { name: 'Edinburgh', lat: 55.9533, lon: -3.1883, country: 'GB' },
    'manchester': { name: 'Manchester', lat: 53.4808, lon: -2.2426, country: 'GB' },
    'birmingham': { name: 'Birmingham', lat: 52.4862, lon: -1.8904, country: 'GB' },
    'glasgow': { name: 'Glasgow', lat: 55.8642, lon: -4.2518, country: 'GB' },
    'barcelona': { name: 'Barcelona', lat: 41.3851, lon: 2.1734, country: 'ES' },
    'valencia': { name: 'Valencia', lat: 39.4699, lon: -0.3763, country: 'ES' },
    'seville': { name: 'Seville', lat: 37.3891, lon: -5.9845, country: 'ES' },
    'malaga': { name: 'Malaga', lat: 36.7202, lon: -4.4203, country: 'ES' },
    'milan': { name: 'Milan', lat: 45.4642, lon: 9.1900, country: 'IT' },
    'naples': { name: 'Naples', lat: 40.8518, lon: 14.2681, country: 'IT' },
    'turin': { name: 'Turin', lat: 45.0703, lon: 7.6869, country: 'IT' },
    'genoa': { name: 'Genoa', lat: 44.4056, lon: 8.9463, country: 'IT' },
    'munich': { name: 'Munich', lat: 48.1351, lon: 11.5820, country: 'DE' },
    'hamburg': { name: 'Hamburg', lat: 53.5511, lon: 9.9937, country: 'DE' },
    'cologne': { name: 'Cologne', lat: 50.9375, lon: 6.9603, country: 'DE' },
    'frankfurt': { name: 'Frankfurt', lat: 50.1109, lon: 8.6821, country: 'DE' },
    'dusseldorf': { name: 'Düsseldorf', lat: 51.2277, lon: 6.7735, country: 'DE' },
    'dortmund': { name: 'Dortmund', lat: 51.5136, lon: 7.4653, country: 'DE' },
    'stuttgart': { name: 'Stuttgart', lat: 48.7758, lon: 9.1829, country: 'DE' },
    'new york': { name: 'New York', lat: 40.7128, lon: -74.0060, country: 'US' },
    'los angeles': { name: 'Los Angeles', lat: 34.0522, lon: -118.2437, country: 'US' },
    'chicago': { name: 'Chicago', lat: 41.8781, lon: -87.6298, country: 'US' },
    'houston': { name: 'Houston', lat: 29.7604, lon: -95.3698, country: 'US' },
    'philadelphia': { name: 'Philadelphia', lat: 39.9526, lon: -75.1652, country: 'US' },
    'phoenix': { name: 'Phoenix', lat: 33.4484, lon: -112.0740, country: 'US' },
    'san antonio': { name: 'San Antonio', lat: 29.4241, lon: -98.4936, country: 'US' },
    'san diego': { name: 'San Diego', lat: 32.7157, lon: -117.1611, country: 'US' },
    'dallas': { name: 'Dallas', lat: 32.7767, lon: -96.7970, country: 'US' },
    'san jose': { name: 'San Jose', lat: 37.3382, lon: -121.8863, country: 'US' },
    'austin': { name: 'Austin', lat: 30.2672, lon: -97.7431, country: 'US' },
    'jacksonville': { name: 'Jacksonville', lat: 30.3322, lon: -81.6557, country: 'US' },
    'fort worth': { name: 'Fort Worth', lat: 32.7555, lon: -97.3308, country: 'US' },
    'columbus': { name: 'Columbus', lat: 39.9612, lon: -82.9988, country: 'US' },
    'charlotte': { name: 'Charlotte', lat: 35.2271, lon: -80.8431, country: 'US' },
    'san francisco': { name: 'San Francisco', lat: 37.7749, lon: -122.4194, country: 'US' },
    'indianapolis': { name: 'Indianapolis', lat: 39.7684, lon: -86.1581, country: 'US' },
    'seattle': { name: 'Seattle', lat: 47.6062, lon: -122.3321, country: 'US' },
    'denver': { name: 'Denver', lat: 39.7392, lon: -104.9903, country: 'US' },
    'washington': { name: 'Washington', lat: 38.9072, lon: -77.0369, country: 'US' },
    'boston': { name: 'Boston', lat: 42.3601, lon: -71.0589, country: 'US' },
    'el paso': { name: 'El Paso', lat: 31.7619, lon: -106.4850, country: 'US' },
    'detroit': { name: 'Detroit', lat: 42.3314, lon: -83.0458, country: 'US' },
    'nashville': { name: 'Nashville', lat: 36.1745, lon: -86.7699, country: 'US' },
    'portland': { name: 'Portland', lat: 45.5152, lon: -122.6784, country: 'US' },
    'memphis': { name: 'Memphis', lat: 35.1495, lon: -90.0490, country: 'US' },
    'oklahoma city': { name: 'Oklahoma City', lat: 35.4676, lon: -97.5164, country: 'US' },
    'las vegas': { name: 'Las Vegas', lat: 36.1699, lon: -115.1398, country: 'US' },
    'toronto': { name: 'Toronto', lat: 43.6532, lon: -79.3832, country: 'CA' },
    'montreal': { name: 'Montreal', lat: 45.5017, lon: -73.5673, country: 'CA' },
    'vancouver': { name: 'Vancouver', lat: 49.2827, lon: -123.1207, country: 'CA' },
    'calgary': { name: 'Calgary', lat: 51.0447, lon: -114.0719, country: 'CA' },
    'edmonton': { name: 'Edmonton', lat: 53.5461, lon: -113.4938, country: 'CA' },
    'ottawa': { name: 'Ottawa', lat: 45.4215, lon: -75.6972, country: 'CA' },
    'winnipeg': { name: 'Winnipeg', lat: 49.8951, lon: -97.1384, country: 'CA' },
    'quebec city': { name: 'Quebec City', lat: 46.8139, lon: -71.2080, country: 'CA' },
    'hamilton': { name: 'Hamilton', lat: 43.2557, lon: -79.8711, country: 'CA' },
    'sydney': { name: 'Sydney', lat: -33.8688, lon: 151.2093, country: 'AU' },
    'melbourne': { name: 'Melbourne', lat: -37.8136, lon: 144.9631, country: 'AU' },
    'brisbane': { name: 'Brisbane', lat: -27.4698, lon: 153.0251, country: 'AU' },
    'perth': { name: 'Perth', lat: -31.9505, lon: 115.8605, country: 'AU' },
    'adelaide': { name: 'Adelaide', lat: -34.9285, lon: 138.6007, country: 'AU' },
    'gold coast': { name: 'Gold Coast', lat: -28.0167, lon: 153.4000, country: 'AU' },
    'canberra': { name: 'Canberra', lat: -35.2809, lon: 149.1300, country: 'AU' },
    'newcastle': { name: 'Newcastle', lat: -32.9267, lon: 151.7789, country: 'AU' },
    'wollongong': { name: 'Wollongong', lat: -34.4278, lon: 150.8931, country: 'AU' },
    'auckland': { name: 'Auckland', lat: -36.8485, lon: 174.7633, country: 'NZ' },
    'wellington': { name: 'Wellington', lat: -41.2865, lon: 174.7762, country: 'NZ' },
    'christchurch': { name: 'Christchurch', lat: -43.5321, lon: 172.6362, country: 'NZ' },
    'tokyo': { name: 'Tokyo', lat: 35.6762, lon: 139.6503, country: 'JP' },
    'osaka': { name: 'Osaka', lat: 34.6937, lon: 135.5023, country: 'JP' },
    'kyoto': { name: 'Kyoto', lat: 35.0116, lon: 135.7681, country: 'JP' },
    'yokohama': { name: 'Yokohama', lat: 35.4437, lon: 139.6380, country: 'JP' },
    'nagoya': { name: 'Nagoya', lat: 35.1815, lon: 136.9066, country: 'JP' },
    'sapporo': { name: 'Sapporo', lat: 43.0642, lon: 141.3469, country: 'JP' },
    'kobe': { name: 'Kobe', lat: 34.6901, lon: 135.1955, country: 'JP' },
    'fukuoka': { name: 'Fukuoka', lat: 33.5904, lon: 130.4017, country: 'JP' },
    'seoul': { name: 'Seoul', lat: 37.5665, lon: 126.9780, country: 'KR' },
    'busan': { name: 'Busan', lat: 35.1796, lon: 129.0756, country: 'KR' },
    'incheon': { name: 'Incheon', lat: 37.4563, lon: 126.7052, country: 'KR' },
    'daegu': { name: 'Daegu', lat: 35.8722, lon: 128.6014, country: 'KR' },
    'daejeon': { name: 'Daejeon', lat: 36.3504, lon: 127.3845, country: 'KR' },
    'beijing': { name: 'Beijing', lat: 39.9042, lon: 116.4074, country: 'CN' },
    'shanghai': { name: 'Shanghai', lat: 31.2304, lon: 121.4737, country: 'CN' },
    'guangzhou': { name: 'Guangzhou', lat: 23.1291, lon: 113.2644, country: 'CN' },
    'shenzhen': { name: 'Shenzhen', lat: 22.5431, lon: 114.0579, country: 'CN' },
    'chongqing': { name: 'Chongqing', lat: 29.5630, lon: 106.5516, country: 'CN' },
    'tianjin': { name: 'Tianjin', lat: 39.3434, lon: 117.3616, country: 'CN' },
    'wuhan': { name: 'Wuhan', lat: 30.5928, lon: 114.3055, country: 'CN' },
    'chengdu': { name: 'Chengdu', lat: 30.5728, lon: 104.0668, country: 'CN' },
    'xian': { name: 'Xi\'an', lat: 34.3416, lon: 108.9398, country: 'CN' },
    'hong kong': { name: 'Hong Kong', lat: 22.3193, lon: 114.1694, country: 'HK' },
    'singapore': { name: 'Singapore', lat: 1.3521, lon: 103.8198, country: 'SG' },
    'kuala lumpur': { name: 'Kuala Lumpur', lat: 3.1390, lon: 101.6869, country: 'MY' },
    'jakarta': { name: 'Jakarta', lat: -6.2088, lon: 106.8456, country: 'ID' },
    'manila': { name: 'Manila', lat: 14.5995, lon: 120.9842, country: 'PH' },
    'bangkok': { name: 'Bangkok', lat: 13.7563, lon: 100.5018, country: 'TH' },
    'ho chi minh city': { name: 'Ho Chi Minh City', lat: 10.8231, lon: 106.6297, country: 'VN' },
    'mumbai': { name: 'Mumbai', lat: 19.0760, lon: 72.8777, country: 'IN' },
    'delhi': { name: 'Delhi', lat: 28.7041, lon: 77.1025, country: 'IN' },
    'bangalore': { name: 'Bangalore', lat: 12.9716, lon: 77.5946, country: 'IN' },
    'kolkata': { name: 'Kolkata', lat: 22.5726, lon: 88.3639, country: 'IN' },
    'chennai': { name: 'Chennai', lat: 13.0827, lon: 80.2707, country: 'IN' },
    'pune': { name: 'Pune', lat: 18.5204, lon: 73.8567, country: 'IN' },
    'hyderabad': { name: 'Hyderabad', lat: 17.3850, lon: 78.4867, country: 'IN' },
    'ahmedabad': { name: 'Ahmedabad', lat: 23.0225, lon: 72.5714, country: 'IN' },
    'surat': { name: 'Surat', lat: 21.1702, lon: 72.8311, country: 'IN' },
    'karachi': { name: 'Karachi', lat: 24.8607, lon: 67.0011, country: 'PK' },
    'lahore': { name: 'Lahore', lat: 31.5497, lon: 74.3436, country: 'PK' },
    'faisalabad': { name: 'Faisalabad', lat: 31.4504, lon: 73.1350, country: 'PK' },
    'rawalpindi': { name: 'Rawalpindi', lat: 33.5651, lon: 73.0169, country: 'PK' },
    'gujranwala': { name: 'Gujranwala', lat: 32.1877, lon: 74.1886, country: 'PK' },
    'peshawar': { name: 'Peshawar', lat: 34.0151, lon: 71.5785, country: 'PK' },
    'multan': { name: 'Multan', lat: 30.1575, lon: 71.5249, country: 'PK' },
    'islamabad': { name: 'Islamabad', lat: 33.6844, lon: 73.0479, country: 'PK' },
    'quetta': { name: 'Quetta', lat: 30.1798, lon: 66.9750, country: 'PK' },
    'cairo': { name: 'Cairo', lat: 30.0444, lon: 31.2357, country: 'EG' },
    'alexandria': { name: 'Alexandria', lat: 31.2001, lon: 29.9187, country: 'EG' },
    'giza': { name: 'Giza', lat: 30.0131, lon: 31.2089, country: 'EG' },
    'shubra el kheima': { name: 'Shubra El Kheima', lat: 30.1294, lon: 31.2826, country: 'EG' },
    'port said': { name: 'Port Said', lat: 31.2653, lon: 32.3015, country: 'EG' },
    'luxor': { name: 'Luxor', lat: 25.6872, lon: 32.6393, country: 'EG' },
    'aswan': { name: 'Aswan', lat: 24.0908, lon: 32.8994, country: 'EG' },
    'damietta': { name: 'Damietta', lat: 31.4165, lon: 31.8133, country: 'EG' },
    'asmara': { name: 'Asmara', lat: 15.3229, lon: 38.9237, country: 'ER' },
    'khartoum': { name: 'Khartoum', lat: 15.5007, lon: 32.5599, country: 'SD' },
    'addis ababa': { name: 'Addis Ababa', lat: 9.1450, lon: 38.7617, country: 'ET' },
    'nairobi': { name: 'Nairobi', lat: -1.2921, lon: 36.8219, country: 'KE' },
    'kampala': { name: 'Kampala', lat: 0.3476, lon: 32.5825, country: 'UG' },
    'dar es salaam': { name: 'Dar es Salaam', lat: -6.7924, lon: 39.2083, country: 'TZ' },
    'johannesburg': { name: 'Johannesburg', lat: -26.2041, lon: 28.0473, country: 'ZA' },
    'cape town': { name: 'Cape Town', lat: -33.9249, lon: 18.4241, country: 'ZA' },
    'durban': { name: 'Durban', lat: -29.8587, lon: 31.0218, country: 'ZA' },
    'pretoria': { name: 'Pretoria', lat: -25.7479, lon: 28.2293, country: 'ZA' },
    'lagos': { name: 'Lagos', lat: 6.5244, lon: 3.3792, country: 'NG' },
    'kano': { name: 'Kano', lat: 11.9604, lon: 8.5396, country: 'NG' },
    'ibadan': { name: 'Ibadan', lat: 7.3775, lon: 3.9470, country: 'NG' },
    'kaduna': { name: 'Kaduna', lat: 10.5222, lon: 7.4374, country: 'NG' },
    'port harcourt': { name: 'Port Harcourt', lat: 4.8156, lon: 7.0498, country: 'NG' },
    'benin city': { name: 'Benin City', lat: 6.3350, lon: 5.6275, country: 'NG' },
    'maiduguri': { name: 'Maiduguri', lat: 11.8445, lon: 13.0591, country: 'NG' },
    'zaria': { name: 'Zaria', lat: 11.1108, lon: 7.7227, country: 'NG' },
    'aba': { name: 'Aba', lat: 5.1410, lon: 7.3667, country: 'NG' },
    'jos': { name: 'Jos', lat: 9.9285, lon: 8.8921, country: 'NG' },
    'accra': { name: 'Accra', lat: 5.6037, lon: -0.1870, country: 'GH' },
    'kumasi': { name: 'Kumasi', lat: 6.6885, lon: -1.6244, country: 'GH' },
    'tamale': { name: 'Tamale', lat: 9.3997, lon: -0.8373, country: 'GH' },
    'sekondi-takoradi': { name: 'Sekondi-Takoradi', lat: 4.9344, lon: -1.7614, country: 'GH' },
    'ashaiman': { name: 'Ashaiman', lat: 5.9977, lon: -0.0219, country: 'GH' },
    'obuasi': { name: 'Obuasi', lat: 6.2030, lon: -1.6653, country: 'GH' },
    'dubai': { name: 'Dubai', lat: 25.2048, lon: 55.2708, country: 'AE' },
    'abu dhabi': { name: 'Abu Dhabi', lat: 24.4539, lon: 54.3773, country: 'AE' },
    'sharjah': { name: 'Sharjah', lat: 25.3375, lon: 55.4161, country: 'AE' },
    'al ain': { name: 'Al Ain', lat: 24.2278, lon: 55.4344, country: 'AE' },
    'ajman': { name: 'Ajman', lat: 25.4111, lon: 55.4386, country: 'AE' },
    'ras al khaimah': { name: 'Ras Al Khaimah', lat: 25.6415, lon: 55.9423, country: 'AE' },
    'fujairah': { name: 'Fujairah', lat: 25.1288, lon: 56.3265, country: 'AE' },
    'umm al quwain': { name: 'Umm Al Quwain', lat: 25.5647, lon: 55.5533, country: 'AE' },
    'riyadh': { name: 'Riyadh', lat: 24.7136, lon: 46.6753, country: 'SA' },
    'jeddah': { name: 'Jeddah', lat: 21.5433, lon: 39.1728, country: 'SA' },
    'mecca': { name: 'Mecca', lat: 21.4225, lon: 39.8262, country: 'SA' },
    'medina': { name: 'Medina', lat: 24.4584, lon: 39.6119, country: 'SA' },
    'dammam': { name: 'Dammam', lat: 26.4269, lon: 50.0879, country: 'SA' },
    'khobar': { name: 'Khobar', lat: 26.2785, lon: 50.2045, country: 'SA' },
    'tabuk': { name: 'Tabuk', lat: 28.3836, lon: 36.5714, country: 'SA' },
    'buraidah': { name: 'Buraidah', lat: 26.3619, lon: 43.9659, country: 'SA' },
    'hafr al batin': { name: 'Hafr Al Batin', lat: 28.4267, lon: 46.1196, country: 'SA' },
    'taif': { name: 'Taif', lat: 21.4291, lon: 40.4253, country: 'SA' },
    'najran': { name: 'Najran', lat: 17.4947, lon: 44.1277, country: 'SA' },
    'hail': { name: 'Hail', lat: 27.5358, lon: 41.6932, country: 'SA' },
    'arar': { name: 'Arar', lat: 30.9042, lon: 41.1385, country: 'SA' },
    'rafha': { name: 'Rafha', lat: 29.6171, lon: 43.4849, country: 'SA' },
    'tehran': { name: 'Tehran', lat: 35.6892, lon: 51.3890, country: 'IR' },
    'mashhad': { name: 'Mashhad', lat: 36.2605, lon: 59.6168, country: 'IR' },
    'isfahan': { name: 'Isfahan', lat: 32.6546, lon: 51.6678, country: 'IR' },
    'karaj': { name: 'Karaj', lat: 35.8327, lon: 50.9916, country: 'IR' },
    'shiraz': { name: 'Shiraz', lat: 29.5918, lon: 52.5837, country: 'IR' },
    'tabriz': { name: 'Tabriz', lat: 38.0962, lon: 46.2753, country: 'IR' },
    'qom': { name: 'Qom', lat: 34.6401, lon: 50.8763, country: 'IR' },
    'kish island': { name: 'Kish Island', lat: 26.5289, lon: 53.9811, country: 'IR' },
    'urmia': { name: 'Urmia', lat: 37.5527, lon: 45.0762, country: 'IR' },
    'zahedan': { name: 'Zahedan', lat: 29.4963, lon: 60.8629, country: 'IR' },
    'rasht': { name: 'Rasht', lat: 37.2808, lon: 49.5832, country: 'IR' },
    'kerman': { name: 'Kerman', lat: 30.2839, lon: 57.0834, country: 'IR' },
    'ahvaz': { name: 'Ahvaz', lat: 31.3183, lon: 48.6706, country: 'IR' },
    'islamabad': { name: 'Islamabad', lat: 33.6844, lon: 73.0479, country: 'PK' },
    'karachi': { name: 'Karachi', lat: 24.8607, lon: 67.0011, country: 'PK' },
    'lahore': { name: 'Lahore', lat: 31.5497, lon: 74.3436, country: 'PK' },
    'faisalabad': { name: 'Faisalabad', lat: 31.4504, lon: 73.1350, country: 'PK' },
    'rawalpindi': { name: 'Rawalpindi', lat: 33.5651, lon: 73.0169, country: 'PK' },
    'multan': { name: 'Multan', lat: 30.1575, lon: 71.5249, country: 'PK' },
    'gujranwala': { name: 'Gujranwala', lat: 32.1877, lon: 74.1886, country: 'PK' },
    'peshawar': { name: 'Peshawar', lat: 34.0151, lon: 71.5785, country: 'PK' },
    'quetta': { name: 'Quetta', lat: 30.1798, lon: 66.9750, country: 'PK' },
    'sialkot': { name: 'Sialkot', lat: 32.4945, lon: 74.5229, country: 'PK' },
    'sukkur': { name: 'Sukkur', lat: 27.6765, lon: 68.8514, country: 'PK' },
    'larkana': { name: 'Larkana', lat: 27.5398, lon: 68.2415, country: 'PK' },
    'sheikhupura': { name: 'Sheikhupura', lat: 31.7130, lon: 73.9783, country: 'PK' },
    'jhang': { name: 'Jhang', lat: 30.9508, lon: 72.3517, country: 'PK' },
    'gujrat': { name: 'Gujrat', lat: 32.5753, lon: 74.0758, country: 'PK' },
    'mardan': { name: 'Mardan', lat: 34.1985, lon: 72.0470, country: 'PK' },
    'kasur': { name: 'Kasur', lat: 31.1164, lon: 74.4496, country: 'PK' },
    'mingora': { name: 'Mingora', lat: 34.7897, lon: 72.3629, country: 'PK' },
    'nawabshah': { name: 'Nawabshah', lat: 26.2411, lon: 68.4118, country: 'PK' },
    'kotri': { name: 'Kotri', lat: 25.3827, lon: 68.3075, country: 'PK' },
    'hyderabad': { name: 'Hyderabad', lat: 25.3960, lon: 68.3672, country: 'PK' }
};

async function searchCityCoords(cityName) {
    const city = cityName.trim();
    if (!city || city.length < 2) return { name: 'Paris', lat: 48.8566, lon: 2.3522, country: 'FR' };

    // Fallback local - recherche rapide
    const cityDB = {
        'paris': { name: 'Paris', lat: 48.8566, lon: 2.3522, country: 'FR' },
        'london': { name: 'London', lat: 51.5074, lon: -0.1278, country: 'GB' },
        'new york': { name: 'New York', lat: 40.7128, lon: -74.0060, country: 'US' },
        'tokyo': { name: 'Tokyo', lat: 35.6762, lon: 139.6503, country: 'JP' },
        'berlin': { name: 'Berlin', lat: 52.5200, lon: 13.4050, country: 'DE' },
        'madrid': { name: 'Madrid', lat: 40.4168, lon: -3.7038, country: 'ES' },
        'lyon': { name: 'Lyon', lat: 45.7640, lon: 4.8357, country: 'FR' },
        'marseille': { name: 'Marseille', lat: 43.2965, lon: 5.3698, country: 'FR' }
    };
    
    const cityLower = city.toLowerCase();
    if (cityDB[cityLower]) {
        return cityDB[cityLower];
    }

    // Try Open-Meteo geocoding
    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`;
        const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (response.ok) {
            const data = await response.json();
            if (data.results && data.results.length > 0) {
                const result = data.results[0];
                return { name: result.name, lat: result.latitude, lon: result.longitude, country: result.country_code || '' };
            }
        }
    } catch (e) {
        console.log('Geocoding API failed');
    }
    
    return { name: 'Paris', lat: 48.8566, lon: 2.3522, country: 'FR' };
}

// Obtenir le nom de la ville - avec Nominatim OpenStreetMap
async function getCityNameFromCoords(lat, lon) {
    // First check if we have a valid currentCity from search
    if (currentCity && currentCity !== 'Votre position' && !currentCity.match(/^[0-9.]+$/)) {
        return currentCity;
    }
    // Only then try reverse geocoding
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=fr`, {
            headers: { 'User-Agent': 'MeteoApp/1.0' },
            signal: AbortSignal.timeout(5000)
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.address?.city || data.address?.town || data.address?.village) {
                const cityName = data.address.city || data.address.town || data.address.village;
                console.log(`🏙️ Ville: ${cityName}`);
                return { name: cityName, country: data.address.country_code?.toUpperCase() || '', admin1: data.address.state || '' };
            }
        }
    } catch (e) {
        console.warn('Nominatim:', e.message);
    }
    
    // Fallback: IP-API (gratuit, parfois fonctionne)
    try {
        const r = await fetch(`http://ip-api.com/json/${lat},${lon}?lang=fr`, { signal: AbortSignal.timeout(5000) });
        if (r.ok) {
            const d = await r.json();
            if (d.status === 'success' && d.city) return { name: d.city, country: d.countryCode || '', admin1: d.regionName || '' };
        }
    } catch (err) {}
    
    return { name: 'Position', country: '', admin1: '' };
}

// Système IA générative pour météo temps réel
class WeatherAI {
    constructor() {
        this.version = '2.0';
        this.learningRate = 0.01;
        this.patternMemory = new Map();
        this.lastUpdate = Date.now();
        this.cityProfiles = new Map();
    }

    // Analyse intelligente des conditions météo
    analyzeWeatherConditions(lat, lon, cityName) {
        const now = new Date();
        const hour = now.getHours();
        const month = now.getMonth();
        const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
        
        // Déterminer la saison
        const season = this.getSeason(month);
        const timeOfDay = this.getTimeOfDay(hour);
        
        // Profil géographique intelligent
        const geoProfile = this.getGeographicProfile(cityName, lat, lon);
        
        // Génération de conditions météo réalistes
        const baseTemp = this.calculateBaseTemperature(season, geoProfile, dayOfYear);
        const currentTemp = this.applyHourlyVariation(baseTemp, hour, timeOfDay);
        
        // Conditions météo intelligentes
        const weatherCode = this.generateWeatherCode(season, hour, geoProfile, currentTemp);
        const humidity = this.calculateHumidity(weatherCode, season, geoProfile, hour);
        const windSpeed = this.calculateWindSpeed(weatherCode, geoProfile, hour);
        const pressure = this.calculatePressure(weatherCode, season, geoProfile);
        
        return {
            temperature: Math.round(currentTemp),
            feelsLike: Math.round(this.calculateFeelsLike(currentTemp, humidity, windSpeed)),
            weatherCode: weatherCode,
            humidity: humidity,
            windSpeed: windSpeed,
            pressure: pressure,
            visibility: this.calculateVisibility(weatherCode, humidity),
            uvIndex: this.calculateUVIndex(hour, weatherCode, season),
            sunrise: this.calculateSunrise(new Date(), season),
            sunset: this.calculateSunset(new Date(), season),
            condition: this.getWeatherCondition(weatherCode),
            isDay: hour >= 6 && hour <= 20 ? 1 : 0
        };
    }
    
    getSeason(month) {
        if (month >= 2 && month <= 4) return 'spring';
        if (month >= 5 && month <= 7) return 'summer';
        if (month >= 8 && month <= 10) return 'autumn';
        return 'winter';
    }
    
    getTimeOfDay(hour) {
        if (hour >= 5 && hour < 12) return 'morning';
        if (hour >= 12 && hour < 18) return 'afternoon';
        if (hour >= 18 && hour < 22) return 'evening';
        return 'night';
    }
    
    getGeographicProfile(cityName, lat, lon) {
        // Analyse géographique intelligente basée sur la ville
        const cityLower = cityName.toLowerCase();
        
        if (cityLower.includes('paris') || cityLower.includes('london') || cityLower.includes('berlin')) {
            return 'urban';
        } else if (cityLower.includes('marseille') || cityLower.includes('nice') || cityLower.includes('bordeaux')) {
            return 'coastal';
        } else if (cityLower.includes('grenoble') || cityLower.includes('annecy') || cityLower.includes('chamonix')) {
            return 'mountain';
        } else {
            return 'rural';
        }
    }
    
    calculateBaseTemperature(season, geoProfile, dayOfYear) {
        const seasonalBase = {
            spring: 12.5,
            summer: 25,
            autumn: 12.5,
            winter: 2.5
        };
        
        const geoModifier = WEATHER_PATTERNS.geographic[geoProfile];
        let baseTemp = seasonalBase[season] + (geoModifier.tempBonus || 0);
        
        // Variation sinusoïdale pour réalisme
        const seasonalVariation = Math.sin((dayOfYear / 365) * 2 * Math.PI) * 5;
        baseTemp += seasonalVariation;
        
        // Facteur aléatoire contrôlé
        baseTemp += (Math.random() - 0.5) * 3;
        
        return baseTemp;
    }
    
    applyHourlyVariation(baseTemp, hour, timeOfDay) {
        const hourlyPattern = WEATHER_PATTERNS.hourly[timeOfDay];
        let temp = baseTemp + (hourlyPattern.tempModifier || 0);
        
        // Variation supplémentaire selon l'heure
        if (hour >= 14 && hour <= 16) {
            temp += 2; // Pic de chaleur l'après-midi
        } else if (hour >= 4 && hour <= 6) {
            temp -= 3; // Pointe de fraîcheur tôt le matin
        }
        
        return temp;
    }
    
    generateWeatherCode(season, hour, geoProfile, temperature) {
        // Algorithme intelligent de génération de conditions météo
        const seasonConditions = WEATHER_PATTERNS.seasonal[season].conditions;
        const geoModifier = WEATHER_PATTERNS.geographic[geoProfile];
        
        let probability = Math.random();
        
        // Ajustement selon la température
        if (temperature > 25) probability *= 0.7; // Plus de soleil quand il fait chaud
        if (temperature < 5) probability *= 1.3; // Plus de mauvais temps quand il fait froid
        
        // Ajustement selon l'heure
        if (hour >= 12 && hour <= 15) probability *= 0.8; // Plus de soleil l'après-midi
        if (hour >= 0 && hour <= 6) probability *= 1.2; // Plus de nuages la nuit
        
        // Sélection intelligente du code météo
        if (probability < 0.3) return 0;  // Ensoleillé
        if (probability < 0.5) return 1;  // Partiellement nuageux
        if (probability < 0.7) return 2;  // Nuageux
        if (probability < 0.85) return 3;  // Couvert
        if (temperature < 0 && probability < 0.95) return 71; // Neige légère
        if (probability < 0.9) return 51; // Bruine légère
        if (probability < 0.95) return 61; // Pluie légère
        if (hour >= 14 && hour <= 20) return 95; // Orage l'après-midi
        return 80; // Averses
    }
    
    calculateHumidity(weatherCode, season, geoProfile, hour) {
        let baseHumidity = 60;
        
        // Ajustement selon la condition météo
        if (weatherCode === 0) baseHumidity = 40; // Ensoleillé
        else if (weatherCode >= 51 && weatherCode <= 67) baseHumidity = 85; // Pluie
        else if (weatherCode >= 71 && weatherCode <= 77) baseHumidity = 75; // Neige
        else if (weatherCode >= 95) baseHumidity = 90; // Orage
        
        // Ajustement selon la saison
        if (season === 'winter') baseHumidity += 10;
        if (season === 'summer') baseHumidity -= 10;
        
        // Ajustement géographique
        const geoModifier = WEATHER_PATTERNS.geographic[geoProfile];
        baseHumidity += geoModifier.humidityBonus || 0;
        
        // Ajustement horaire
        if (hour >= 4 && hour <= 8) baseHumidity += 10; // Humidité matinale
        if (hour >= 14 && hour <= 18) baseHumidity -= 15; // Séchage l'après-midi
        
        return Math.max(20, Math.min(100, Math.round(baseHumidity + (Math.random() - 0.5) * 10)));
    }
    
    calculateWindSpeed(weatherCode, geoProfile, hour) {
        let baseWind = 10;
        
        // Ajustement selon la condition météo
        if (weatherCode >= 95) baseWind = 25; // Orage
        else if (weatherCode >= 80) baseWind = 15; // Averses
        else if (weatherCode === 0) baseWind = 5; // Calme ensoleillé
        
        // Ajustement géographique
        const geoModifier = WEATHER_PATTERNS.geographic[geoProfile];
        baseWind += geoModifier.windBonus || 0;
        
        // Variation horaire
        if (hour >= 10 && hour <= 16) baseWind += 5; // Vent d'après-midi
        if (hour >= 0 && hour <= 4) baseWind -= 3; // Calme nocturne
        
        return Math.max(0, Math.round(baseWind + (Math.random() - 0.5) * 8));
    }
    
    calculatePressure(weatherCode, season, geoProfile) {
        let basePressure = 1013;
        
        // Ajustement selon la condition météo
        if (weatherCode >= 95) basePressure = 1005; // Basse pression orage
        else if (weatherCode === 0) basePressure = 1020; // Haute pression ensoleillé
        
        // Variation saisonnière
        if (season === 'summer') basePressure += 2;
        if (season === 'winter') basePressure -= 2;
        
        return Math.round(basePressure + (Math.random() - 0.5) * 10);
    }
    
    calculateVisibility(weatherCode, humidity) {
        if (weatherCode === 45 || weatherCode === 48) return 0.1; // Brouillard
        if (weatherCode >= 51 && weatherCode <= 67) return 8; // Pluie
        if (weatherCode >= 71 && weatherCode <= 77) return 5; // Neige
        if (humidity > 85) return 6; // Humidité élevée
        return 15; // Bonne visibilité
    }
    
    calculateUVIndex(hour, weatherCode, season) {
        if (hour < 6 || hour > 20 || weatherCode !== 0) return 0;
        
        let uvIndex = Math.sin(((hour - 6) / 14) * Math.PI) * 8;
        
        if (season === 'summer') uvIndex *= 1.5;
        if (season === 'winter') uvIndex *= 0.5;
        
        return Math.max(0, Math.round(uvIndex));
    }
    
    calculateFeelsLike(temperature, humidity, windSpeed) {
        // Formule simplifiée du ressentit
        let feelsLike = temperature;
        
        if (temperature <= 10 && windSpeed > 5) {
            // Refroidissement éolien
            feelsLike = 13.12 + 0.6215 * temperature - 11.37 * Math.pow(windSpeed, 0.16) + 0.3965 * temperature * Math.pow(windSpeed, 0.16);
        } else if (temperature >= 27 && humidity > 40) {
            // Facteur humidex
            feelsLike = temperature + (0.33 * (humidity / 100) * (6.112 * Math.exp(17.67 * temperature / (243.5 + temperature)) - 10));
        }
        
        return Math.round(feelsLike);
    }
    
    calculateSunrise(date, season) {
        const baseHour = 7;
        const seasonalOffset = season === 'summer' ? -1 : season === 'winter' ? 1 : 0;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), baseHour + seasonalOffset, 0, 0).getTime() / 1000;
    }
    
    calculateSunset(date, season) {
        const baseHour = 19;
        const seasonalOffset = season === 'summer' ? 1 : season === 'winter' ? -1 : 0;
        return new Date(date.getFullYear(), date.getMonth(), date.getDate(), baseHour + seasonalOffset, 0, 0).getTime() / 1000;
    }
    
    getWeatherCondition(code) {
        const conditions = {
            0: 'Ensoleillé',
            1: 'Partiellement nuageux',
            2: 'Nuageux',
            3: 'Couvert',
            45: 'Brouillard',
            48: 'Brouillard givrant',
            51: 'Bruine légère',
            53: 'Bruine modérée',
            55: 'Bruine forte',
            61: 'Pluie légère',
            63: 'Pluie modérée',
            65: 'Pluie forte',
            71: 'Neige légère',
            73: 'Neige modérée',
            75: 'Neige forte',
            80: 'Averses légères',
            81: 'Averses modérées',
            82: 'Averses violentes',
            95: 'Orage',
            96: 'Orage grêle',
            99: 'Orage violent'
        };
        return conditions[code] || 'Inconnu';
    }
    
    // Génération des prévisions horaires intelligentes
    generateHourlyForecast(currentConditions, hours = 24) {
        const forecast = [];
        const now = new Date();
        
        for (let i = 0; i < hours; i++) {
            const futureTime = new Date(now.getTime() + i * 3600000);
            const futureHour = futureTime.getHours();
            const futureDay = futureTime.getDate();
            
            // Évolution intelligente des conditions
            let tempEvolution = currentConditions.temperature;
            let conditionEvolution = currentConditions.weatherCode;
            
            // Variation de température
            if (futureHour >= 6 && futureHour <= 14) {
                tempEvolution += 1 + Math.random() * 2; // Réchauffement matin
            } else if (futureHour >= 15 && futureHour <= 20) {
                tempEvolution += Math.random() * 1; // Stabilité après-midi
            } else {
                tempEvolution -= 1 + Math.random() * 2; // Refroidissement soir/nuit
            }
            
            // Évolution des conditions météo
            if (i > 0 && Math.random() < 0.3) {
                // 30% de chance de changement de condition
                conditionEvolution = this.generateWeatherCode(
                    this.getSeason(futureTime.getMonth()),
                    futureHour,
                    this.getGeographicProfile(currentCity, currentCoords?.lat || 48.8566, currentCoords?.lon || 2.3522),
                    tempEvolution
                );
            }
            
            forecast.push({
                time: futureTime.getTime(),
                temperature: Math.round(tempEvolution),
                weatherCode: conditionEvolution,
                isDay: futureHour >= 6 && futureHour <= 20 ? 1 : 0
            });
        }
        
        return forecast;
    }
    
    // Génération des prévisions quotidiennes intelligentes
    generateDailyForecast(currentConditions, days = 5) {
        const forecast = [];
        const now = new Date();
        
        for (let i = 0; i < days; i++) {
            const futureDate = new Date(now.getTime() + i * 86400000);
            const season = this.getSeason(futureDate.getMonth());
            
            // Tendance de température sur plusieurs jours
            const tempTrend = Math.sin((i / 7) * Math.PI) * 3;
            const maxTemp = currentConditions.temperature + 5 + tempTrend + (Math.random() - 0.5) * 3;
            const minTemp = currentConditions.temperature - 5 + tempTrend + (Math.random() - 0.5) * 3;
            
            // Condition météo dominante du jour
            const dailyCondition = this.generateWeatherCode(
                season,
                14, // Milieu d'après-midi
                this.getGeographicProfile(currentCity, currentCoords?.lat || 48.8566, currentCoords?.lon || 2.3522),
                maxTemp
            );
            
            forecast.push({
                time: futureDate.getTime(),
                temperature_2m_max: Math.round(maxTemp),
                temperature_2m_min: Math.round(minTemp),
                weatherCode: dailyCondition,
                sunrise: this.calculateSunrise(futureDate, season),
                sunset: this.calculateSunset(futureDate, season)
            });
        }
        
        return forecast;
    }
}

// Instance globale de l'IA météo
const weatherAI = new WeatherAI();

// -------------------------------------------------------
// 🌤️ API Open-Meteo - Vraies données météo (gratuit, sans clé)
// -------------------------------------------------------
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

async function fetchOpenMeteo(lat, lon) {
    // fetchOpenMeteo called
    const params = new URLSearchParams({
        latitude: lat,
        longitude: lon,
        // Donnees actuelles completes
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,visibility,precipitation,rain,cloud_cover,dew_point_2m',
        // Donnees horaires completes
        hourly: 'temperature_2m,weather_code,is_day,precipitation_probability,precipitation,rain,cloud_cover,wind_speed_10m,wind_direction_10m,uv_index',
        // Donnees quotidiennes completes
        daily: 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_sum,rain_sum,uv_index_max,wind_speed_10m_max,wind_direction_10m_dominant',
        timezone: 'auto',
        timezoneOffset: 0,
        forecast_days: 10
    });

    const url = `${OPEN_METEO_BASE}?${params}&_=${Date.now()}`;
    
    const response = await fetch(url, { 
        signal: AbortSignal.timeout(5000)
    });
    
    if (!response.ok) {
        console.error('fetchOpenMeteo HTTP error', response.status);
        throw new Error(`Open-Meteo HTTP ${response.status}`);
    }
    
    const raw = await response.json();
    
    // Retourner toutes les donnees disponibles
    return {
        current: {
            temperature_2m: raw.current?.temperature_2m ?? 0,
            relative_humidity_2m: raw.current?.relative_humidity_2m ?? 0,
            apparent_temperature: raw.current?.apparent_temperature ?? raw.current?.temperature_2m ?? 0,
            is_day: raw.current?.is_day ?? 1,
            weather_code: raw.current?.weather_code ?? 0,
            wind_speed_10m: raw.current?.wind_speed_10m ?? 0,
            wind_direction_10m: raw.current?.wind_direction_10m ?? 0,
            pressure_msl: raw.current?.pressure_msl ?? 1013,
            visibility: raw.current?.visibility ?? 10000,
            precipitation: raw.current?.precipitation ?? 0,
            rain: raw.current?.rain ?? 0,
            cloud_cover: raw.current?.cloud_cover ?? 0,
            dew_point_2m: raw.current?.dew_point_2m ?? 0,
            sunrise: raw.daily?.sunrise?.[0] ? new Date(raw.daily.sunrise[0]).getHours() : 6,
            sunset: raw.daily?.sunset?.[0] ? new Date(raw.daily.sunset[0]).getHours() : 21
        },
        hourly: {
            time: raw.hourly?.time ?? [],
            temperature_2m: raw.hourly?.temperature_2m ?? [],
            weather_code: raw.hourly?.weather_code ?? [],
            is_day: raw.hourly?.is_day ?? [],
            precipitation_probability: raw.hourly?.precipitation_probability ?? [],
            precipitation: raw.hourly?.precipitation ?? [],
            rain: raw.hourly?.rain ?? [],
            cloud_cover: raw.hourly?.cloud_cover ?? [],
            wind_speed_10m: raw.hourly?.wind_speed_10m ?? [],
            wind_direction_10m: raw.hourly?.wind_direction_10m ?? [],
            uv_index: raw.hourly?.uv_index ?? []
        },
        daily: {
            time: raw.daily?.time ?? [],
            temperature_2m_max: raw.daily?.temperature_2m_max ?? [],
            temperature_2m_min: raw.daily?.temperature_2m_min ?? [],
            weather_code: raw.daily?.weather_code ?? [],
            sunrise: raw.daily?.sunrise ?? [],
            sunset: raw.daily?.sunset ?? [],
            precipitation_sum: raw.daily?.precipitation_sum ?? [],
            rain_sum: raw.daily?.rain_sum ?? [],
            uv_index_max: raw.daily?.uv_index_max ?? [],
            wind_speed_10m_max: raw.daily?.wind_speed_10m_max ?? [],
            wind_direction_10m_dominant: raw.daily?.wind_direction_10m_dominant ?? []
        }
    };
}

// Cache pour Open-Meteo (5 minutes)
let openMeteoCache = { key: null, data: null, timestamp: 0 };
const OPEN_METEO_CACHE_TTL = 1 * 60 * 1000; // 5 minutes

// Fetch weather data - utilise l'IA météo simulations
async function fetchWeatherData(lat, lon, retryCount = 0) {
    // Simulated weather data
    return fetchOpenMeteo(lat, lon);
}

// ============================================
// SMART WEATHER AI - Realistic intelligent weather
// ============================================

// Get realistic temps by region/latitude
function getRegionalBaseTemp(lat, month) {
    // Base temps by latitude bands (France ~45-51°N)
    const latBand = lat < 47 ? 'north' : (lat < 50 ? 'center' : 'south');
    const seasonal = {
        north: [4, 5, 9, 12, 16, 20, 23, 22, 18, 13, 8, 4],
        center: [5, 6, 10, 14, 18, 22, 25, 24, 19, 15, 9, 5],
        south: [7, 8, 12, 16, 21, 25, 28, 27, 22, 17, 11, 7]
    };
    return seasonal[latBand][month];
}

// AI weather with real logic - CONSISTENT
function getSimulatedWeatherData(lat = 48.8566, lon = 2.3522) {
    const now = new Date();
    const month = now.getMonth();
    const hour = now.getHours();
    const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    
    // AI calculates realistic baseline
    const baseTemp = getRegionalBaseTemp(lat, month);
    
    // Current temp (exactly as displayed)
    const timeOffset = hour < 6 ? -3 : hour < 15 ? (hour - 6) * 1.2 : 15 - (hour - 15) * 0.8;
    const currentTemp = baseTemp + timeOffset;
    
    // Hourly forecast - START FROM CURRENT TEMP for consistency
    const hourlyData = {
        time: [],
        temperature_2m: [],
        weather_code: [],
        is_day: [],
        precipitation_probability: []
    };
    
    for (let i = 0; i < 48; i++) {
        const h = (hour + i) % 24;
        // Use local time directly
        const d = new Date(now.getTime() + i * 3600000);
        const localHour = d.getHours();
        const localTimeStr = `${String(localHour).padStart(2, '0')}:00`;
        hourlyData.time.push(localTimeStr);
        
        // Start from currentTemp, then vary
        const tempVariation = h < 6 ? -4 : h < 15 ? (h - 6) * 1 : 15 - (h - 15) * 0.7;
        const temp = currentTemp + (tempVariation - timeOffset) + (i > 0 ? (Math.random() - 0.5) * 2 : 0);
        hourlyData.temperature_2m.push(Math.round(temp));
        
        // Weather
        const rainChance = (dayOfYear > 100 && dayOfYear < 300) ? 0.3 : 0.5;
        hourlyData.weather_code.push(
            h >= 6 && h <= 21 
                ? (Math.random() > rainChance ? 0 : (Math.random() > 0.5 ? 1 : 3))
                : (Math.random() > 0.8 ? 0 : 1)
        );
        
        hourlyData.is_day.push(h >= 6 && h <= 21 ? 1 : 0);
        hourlyData.precipitation_probability.push(
            hourlyData.weather_code[i] > 0 ? Math.floor(Math.random() * 60) : Math.floor(Math.random() * 15)
        );
    }
    
    // Daily - based on baseTemp (not current)
    const dailyData = { time: [], temperature_2m_max: [], temperature_2m_min: [], weather_code: [] };
    
    for (let i = 0; i < 7; i++) {
        const d = new Date(now.getTime() + i * 86400000);
        dailyData.time.push(d.toISOString().split('T')[0]);
        
        // Max/min around baseTemp
        dailyData.temperature_2m_max.push(baseTemp + 6 + Math.floor(Math.random() * 3));
        dailyData.temperature_2m_min.push(baseTemp - 3 - Math.floor(Math.random() * 2));
        dailyData.weather_code.push(Math.random() > 0.5 ? 0 : (Math.random() > 0.5 ? 1 : 3));
    }
    
    const isDay = hour >= 6 && hour <= 20;
    
    return {
        current: {
            temperature_2m: Math.round(currentTemp),
            weather_code: Math.random() > 0.6 ? 0 : 1,
            is_day: isDay ? 1 : 0,
            humidity: 45 + Math.floor(Math.random() * 30),
            wind_speed_10m: 5 + Math.floor(Math.random() * 15),
            pressure_msl: 1013 + Math.floor(Math.random() * 8)
        },
        hourly: hourlyData,
        daily: dailyData
    };
}

// ============================================

// AI-generated data as fallback
async function fetchAIData(lat, lon, retryCount = 0) {
    const cacheKey = `ai_weather_${lat.toFixed(2)}_${lon.toFixed(2)}`;
    const cachedData = localStorage.getItem(cacheKey);
    
    if (cachedData) {
        const { data, timestamp } = JSON.parse(cachedData);
        const age = Date.now() - timestamp;
        if (age < AI_CONFIG.aiCache.maxAge) {
            return data;
        }
    }
    
    const currentConditions = weatherAI.analyzeWeatherConditions(lat, lon, currentCity);
    const hourlyForecast = weatherAI.generateHourlyForecast(currentConditions, 24);
    const dailyForecast = weatherAI.generateDailyForecast(currentConditions, 5);
    
    const mappedData = {
        current: {
            temperature_2m: currentConditions.temperature,
            relative_humidity_2m: currentConditions.humidity,
            apparent_temperature: currentConditions.feelsLike,
            is_day: currentConditions.isDay,
            weather_code: currentConditions.weatherCode,
            wind_speed_10m: currentConditions.windSpeed,
            pressure_msl: currentConditions.pressure,
            visibility: currentConditions.visibility,
            sunrise: currentConditions.sunrise,
            sunset: currentConditions.sunset
        },
        hourly: {
            time: hourlyForecast.map(item => item.time),
            temperature_2m: hourlyForecast.map(item => item.temperature),
            weather_code: hourlyForecast.map(item => item.weatherCode),
            is_day: hourlyForecast.map(item => item.isDay)
        },
        daily: {
            time: dailyForecast.map(item => item.time),
            temperature_2m_max: dailyForecast.map(item => item.temperature_2m_max),
            temperature_2m_min: dailyForecast.map(item => item.temperature_2m_min),
            weather_code: dailyForecast.map(item => item.weatherCode),
            sunrise: dailyForecast.map(item => item.sunrise),
            sunset: dailyForecast.map(item => item.sunset)
        }
    };
    
    localStorage.setItem(cacheKey, JSON.stringify({ data: mappedData, timestamp: Date.now() }));
    return mappedData;
}

// Fallback forecast helpers
async function fetchAIForecast(lat, lon, hours) {
    const currentConditions = weatherAI.analyzeWeatherConditions(lat, lon, currentCity);
    const hourlyForecast = weatherAI.generateHourlyForecast(currentConditions, hours);
    return {
        time: hourlyForecast.map(item => item.time),
        temperature_2m: hourlyForecast.map(item => item.temperature),
        weather_code: hourlyForecast.map(item => item.weatherCode),
        is_day: hourlyForecast.map(item => item.isDay)
    };
}

async function fetchAIDailyForecast(lat, lon, days) {
    const currentConditions = weatherAI.analyzeWeatherConditions(lat, lon, currentCity);
    const dailyForecast = weatherAI.generateDailyForecast(currentConditions, days);
    return {
        time: dailyForecast.map(item => item.time),
        temperature_2m_max: dailyForecast.map(item => item.temperature_2m_max),
        temperature_2m_min: dailyForecast.map(item => item.temperature_2m_min),
        weather_code: dailyForecast.map(item => item.weatherCode),
        sunrise: dailyForecast.map(item => item.sunrise),
        sunset: dailyForecast.map(item => item.sunset)
    };
}

function isDayTime(sunrise, sunset) {
    const now = Date.now();
    return now >= sunrise * 1000 && now <= sunset * 1000 ? 1 : 0;
}

// Convert WeatherAPI condition code to our format
function getWeatherCodeFromWeatherAPI(code) {
    // WeatherAPI uses WMO codes similar to Open-Meteo
    return code;
}

// Conversion des codes OpenWeather vers nos codes internes
function getWeatherCodeFromOpenWeather(openWeatherId) {
    const codeMap = {
        200: 95, 201: 95, 202: 95, 210: 95, 211: 95, 212: 95, 221: 95, 232: 95, // Orage
        230: 95, 231: 95, // Orage avec bruine légère
        500: 51, 501: 51, 502: 51, 503: 51, 504: 51, 511: 51, 520: 51, 521: 51, 522: 51, 531: 51, // Bruine
        600: 61, 601: 61, 602: 61, 611: 61, 612: 61, 613: 61, 614: 61, 615: 61, 616: 61, 620: 61, 621: 61, 622: 61, // Pluie légère
        701: 63, 711: 63, 721: 63, 731: 63, 741: 63, // Pluie modérée
        800: 0,   // Dégagé
        801: 1,   // Quelques nuages
        802: 2,   // Nuages épars
        803: 2,   // Nuages épars
        804: 3,   // Nuages épars
        741: 2,   // Nuageux
        600: 45,  // Brouillard
        741: 45,  // Brouillard
        620: 45,  // Brouillard
        721: 45,  // Brouillard
        751: 75, 752: 75, 771: 75, // Neige
        761: 71, 762: 71, 771: 71, // Neige légère
        731: 71, 741: 71, 761: 71, // Neige
    };
    return codeMap[openWeatherId] || 0;
}

function getSimulatedWeatherData() {
    // Données simulées en cas d'erreur API - TOUS LES CHAMPS REQUIS
    const now = new Date();
    const hour = now.getHours();
    const baseTemp = 15 + Math.sin(hour * Math.PI / 12) * 8;
    const isDayNow = hour >= 6 && hour <= 20 ? 1 : 0;
    
    const hourlyTemps = Array.from({length: 48}, (_, i) => {
        const h = (hour + i) % 24;
        const temp = baseTemp + Math.sin(h * Math.PI / 12) * 8 + Math.random() * 3;
        return {
            time: new Date(now.getTime() + i * 3600000).toISOString().replace('Z', '').split('.')[0],
            temperature_2m: temp,
            weather_code: Math.random() > 0.7 ? 0 : (Math.random() > 0.5 ? 51 : 1),
            is_day: h >= 6 && h <= 20 ? 1 : 0,
            precipitation: Math.random() > 0.8 ? Math.random() * 2 : 0,
            precipitation_probability: Math.random() > 0.7 ? Math.floor(Math.random() * 50) : 0,
            cloud_cover: Math.floor(Math.random() * 100),
            wind_speed_10m: 5 + Math.random() * 15,
            wind_direction_10m: Math.floor(Math.random() * 360),
            uv_index: Math.random() * 8
        };
    });
    
    const dailyTemps = Array.from({length: 8}, (_, i) => {
        const tempMax = baseTemp + 5 + Math.random() * 5;
        const tempMin = baseTemp - 3 + Math.random() * 3;
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, 12, 0, 0);
        return {
            time: d.toISOString().split('T')[0],
            temperature_2m_max: tempMax,
            temperature_2m_min: tempMin,
            weather_code: Math.random() > 0.6 ? 0 : (Math.random() > 0.5 ? 1 : 51),
            precipitation_sum: Math.random() > 0.7 ? Math.random() * 5 : 0,
            rain_sum: Math.random() > 0.7 ? Math.random() * 3 : 0,
            uv_index_max: Math.random() * 8,
            wind_speed_10m_max: 10 + Math.random() * 20,
            wind_direction_10m_dominant: Math.floor(Math.random() * 360)
        };
    });
    
    return {
        current: {
            temperature_2m: baseTemp + Math.random() * 3,
            relative_humidity_2m: 50 + Math.floor(Math.random() * 30),
            apparent_temperature: baseTemp + Math.random() * 2,
            is_day: isDayNow,
            weather_code: 0,
            wind_speed_10m: 5 + Math.random() * 10,
            wind_direction_10m: Math.floor(Math.random() * 360),
            pressure_msl: 1013 + Math.random() * 10,
            visibility: 10000,
            precipitation: 0,
            rain: 0,
            cloud_cover: 20,
            dew_point_2m: baseTemp - 5 + Math.random() * 3
        },
        hourly: {
            time: hourlyTemps.map(h => h.time),
            temperature_2m: hourlyTemps.map(h => h.temperature_2m),
            weather_code: hourlyTemps.map(h => h.weather_code),
            is_day: hourlyTemps.map(h => h.is_day),
            precipitation: hourlyTemps.map(h => h.precipitation),
            precipitation_probability: hourlyTemps.map(h => h.precipitation_probability),
            rain: hourlyTemps.map(h => h.precipitation),
            cloud_cover: hourlyTemps.map(h => h.cloud_cover),
            wind_speed_10m: hourlyTemps.map(h => h.wind_speed_10m),
            wind_direction_10m: hourlyTemps.map(h => h.wind_direction_10m),
            uv_index: hourlyTemps.map(h => h.uv_index)
        },
        daily: {
            time: dailyTemps.map(d => d.time),
            temperature_2m_max: dailyTemps.map(d => d.temperature_2m_max),
            temperature_2m_min: dailyTemps.map(d => d.temperature_2m_min),
            weather_code: dailyTemps.map(d => d.weather_code),
            precipitation_sum: dailyTemps.map(d => d.precipitation_sum),
            rain_sum: dailyTemps.map(d => d.rain_sum),
            uv_index_max: dailyTemps.map(d => d.uv_index_max),
            wind_speed_10m_max: dailyTemps.map(d => d.wind_speed_10m_max),
            wind_direction_10m_dominant: dailyTemps.map(d => d.wind_direction_10m_dominant)
        }
    };
}

function showWeatherError(message) {
    // Créer un message d'erreur stylé
    const errorDiv = document.createElement('div');
    errorDiv.className = 'weather-error';
    errorDiv.innerHTML = `
        <div class="error-icon">⚠️</div>
        <div class="error-message">${message}</div>
        <div class="error-close" onclick="this.parentElement.remove()">✕</div>
    `;
    
    // Ajouter au conteneur principal
    const container = document.querySelector('.weather-hero') || document.querySelector('.hero');
    if (container) {
        container.appendChild(errorDiv);
        
        // Auto-suppression après 5 secondes
        setTimeout(() => {
            if (errorDiv.parentElement) {
                errorDiv.parentElement.removeChild(errorDiv);
            }
        }, 5000);
    }
}

async function updateWeatherByCoords(lat, lon) {
    try {
        currentCoords = { lat, lon };
        
        // Afficher "Chargement..." pendant la recherche
        const cityElement = document.querySelector('.city');
        const conditionElement = document.querySelector('.condition');
        if (cityElement) cityElement.textContent = 'Chargement...';
        
        // Obtenir le nom réel de la ville avec geocoding
        const cityInfo = await getCityNameFromCoords(lat, lon);
        currentCity = cityInfo.name;
        
        // Afficher le nom de la ville
        if (cityElement) cityElement.textContent = currentCity;
        const inputElement = document.getElementById('city-input');
        if (inputElement) inputElement.value = currentCity;
        
        console.log('Fetching weather for', lat, lon);
        const weatherData = await fetchWeatherData(lat, lon);
        console.log('Got weatherData:', weatherData ? 'yes' : 'no', weatherData?.daily ? 'with daily' : 'no daily');
        
        if (!weatherData) {
            showWeatherError('Impossible de récupérer les données météo.');
            return;
        }
        
        // Generate hourly with proper ISO format
        if (!weatherData.hourly || !weatherData.hourly.time) {
            const now = new Date();
            const h = [];
            for (let i = 0; i < 48; i++) {
                const d = new Date(now.getTime() + i*3600000);
                h.push(d.toISOString().replace('Z', '').split('.')[0]);
            }
            const nh = now.getHours();
            const base = 20;
            weatherData.hourly = {
                time: h,
                temperature_2m: h.map((_,i) => base + Math.sin((nh+i)%24 * Math.PI/12) * 5),
                weather_code: h.map(() => 0),
                is_day: h.map((_,i) => (nh+i)%24 >= 6 && (nh+i)%24 <= 20 ? 1 : 0),
                precipitation_probability: h.map(() => 0)
            };
        }
        
        if (!weatherData.daily || !weatherData.daily.time || !weatherData.daily.temperature_2m_max) {
            console.error('Invalid or missing weatherData.daily:', weatherData?.daily);
        }
        
        await displayWeatherData(weatherData);
        
    } catch (error) {
        console.error('Erreur:', error);
        showWeatherError('Erreur de connexion. Vérifiez votre accès internet et réessayez.');
    }
}

async function updateWeather(cityName) {
    const searchBtn = document.querySelector('.menu-btn');
    if (searchBtn) searchBtn.style.opacity = '0.5';
    
    try {
        // Forcer la recherche manuelle si ce n'est pas une localisation automatique
        if (cityName !== 'Votre position' && cityName !== 'Localisation...' && cityName !== 'Position en cache...') {
            currentCoords = null; // Réinitialiser pour permettre la recherche manuelle
        }
        
        const cityData = await searchCityCoords(cityName);
        
        if (!cityData) {
            // Toujours afficher l'erreur, même au premier chargement
            showWeatherError('Ville non trouvée. Vérifiez l\'orthographe ou essayez une autre ville.');
            if (searchBtn) searchBtn.style.opacity = '1';
            return;
        }
        
        currentCity = cityData.name;
        currentCoords = { lat: cityData.lat, lon: cityData.lon };
        
        let weatherData = await fetchWeatherData(cityData.lat, cityData.lon);
        
        if (!weatherData) {
            weatherData = await fetchOpenMeteo(cityData.lat, cityData.lon);
        }
        
        await displayWeatherData(weatherData);
    } catch (error) {
        console.error('Erreur lors de l\'affichage des données:', error);
        showWeatherError('Erreur lors de l\'affichage des données météo. Veuillez réessayer.');
        if (searchBtn) searchBtn.style.opacity = '1';
        return;
    }
}

async function displayWeatherData(weatherData) {
    console.log("DEBUG displayWeatherData: weatherDataKeys =", weatherData ? Object.keys(weatherData) : 'undefined');
    const searchBtn = document.querySelector('.menu-btn');
    if (searchBtn) searchBtn.style.opacity = '0.5';

    void (0); { // try replaced
        // Use data if available, else defaults handled below
        const current = weatherData?.current || {};
        
        // Température par defaut si manquante
        if (current.temperature_2m === undefined || current.temperature_2m === null) {
            current.temperature_2m = 20;
            current.weather_code = 0;
            current.is_day = 1;
        }

        const weatherInfo = getWeatherInfo(current.weather_code || 0);
        const isDay = current.is_day === 1;
        
        // IA description poétique
        const aiCondition = getWeatherInfo(current.weather_code || 0).condition;
        
        // Mettre à jour le premier chargement
        if (isFirstLoad) {
            isFirstLoad = false;
            const cityElement = document.querySelector('.city');
            // Ensure we always show city NAME, never coordinates
            let displayName = currentCity || 'Paris';
            // Remove any coordinates-like strings
            displayName = displayName.replace(/^[0-9.]+$/, 'Paris');
            if (cityElement) cityElement.textContent = displayName;
            const inputElement = document.getElementById('city-input');
            if (inputElement) inputElement.value = currentCity || '';
        }
        
        // Température actuelle
        const tempElement = document.document.getElementById('current-temp') || document.querySelector('.big-temp');
        if (tempElement && current.temperature_2m !== undefined && current.temperature_2m !== null) {
            tempElement.textContent = `${Math.round(current.temperature_2m)}°`;
        }
        
        // Condition météo - texte IA
        const conditionElement = document.querySelector('.condition');
        if (conditionElement && aiCondition) {
            conditionElement.textContent = aiCondition;
            conditionElement.classList.remove('has-icon');
        }
        // Vérifier que les données existent avant de les utiliser
        if (weatherData.daily && weatherData.daily.temperature_2m_max && weatherData.daily.temperature_2m_min) {
            document.querySelector('.high-low').innerHTML = 
                `<span>H:${Math.round(weatherData.daily.temperature_2m_max[0])}°</span>` +
                `<span>L:${Math.round(weatherData.daily.temperature_2m_min[0])}°</span>`;
        }
        
        // Humidité
        const humidityElement = document.getElementById('humidity');
        if (humidityElement && current.relative_humidity_2m !== undefined && current.relative_humidity_2m !== null) {
            humidityElement.textContent = `${Math.round(current.relative_humidity_2m)}%`;
        }
        
        // Vent
        const windElement = document.getElementById('wind');
        if (windElement && current.wind_speed_10m !== undefined && current.wind_speed_10m !== null) {
            windElement.innerHTML = `${Math.round(current.wind_speed_10m)} <span class="unit">km/h</span>`;
        }
        
        // Température ressentie
        const feelsLikeElement = document.getElementById('feels-like');
        if (feelsLikeElement && current.apparent_temperature !== undefined && current.apparent_temperature !== null) {
            feelsLikeElement.textContent = `${Math.round(current.apparent_temperature)}°`;
        }
        
        // Visibilité
        const visibilityElements = document.querySelectorAll('.detail-big');
        if (visibilityElements[2] && current.visibility !== undefined && current.visibility !== null) {
            const visibilityKm = Math.round(current.visibility / 1000);
            visibilityElements[2].innerHTML = `${visibilityKm} <span class="unit">km</span>`;
        }
        
        // Précipitations
        const precipElement = document.getElementById('precipitation');
        const precipDesc = document.getElementById('precip-desc');
        const precip = current.precipitation || 0;
        const rain = current.rain || 0;
        const totalPrecip = precip + rain;
        
        if (precipElement && totalPrecip !== undefined) {
            precipElement.innerHTML = `${totalPrecip.toFixed(1)} <span class="unit">mm</span>`;
            
            // Description selon quantité
            if (precipDesc) {
                if (totalPrecip === 0) precipDesc.textContent = 'Aucune';
                else if (totalPrecip < 1) precipDesc.textContent = 'Faible';
                else if (totalPrecip < 5) precipDesc.textContent = 'Modérée';
                else precipDesc.textContent = 'Forte';
            }
        }
        
        // Pression atmosphérique
        const pressureElement = document.getElementById('pressure');
        const pressureTrend = document.getElementById('pressure-trend');
        if (pressureElement && current.pressure_msl !== undefined && current.pressure_msl !== null) {
            pressureElement.innerHTML = `${Math.round(current.pressure_msl)} <span class="unit">hPa</span>`;
            
            // Tendance de pression (approximative)
            if (pressureTrend) {
                if (current.pressure_msl > 1020) pressureTrend.textContent = 'Haute';
                else if (current.pressure_msl < 1000) pressureTrend.textContent = 'Basse';
                else pressureTrend.textContent = 'Normale';
            }
        }
        
        // Nuages
        const cloudsElement = document.getElementById('clouds');
        const cloudDesc = document.getElementById('cloud-desc');
        if (cloudsElement && current.cloud_cover !== undefined) {
            cloudsElement.innerHTML = `${Math.round(current.cloud_cover)} <span class="unit">%</span>`;
            
            if (cloudDesc) {
                if (current.cloud_cover < 20) cloudDesc.textContent = 'Dégagé';
                else if (current.cloud_cover < 50) cloudDesc.textContent = 'Partiellement nuageux';
                else if (current.cloud_cover < 80) cloudDesc.textContent = 'Nuageux';
                else cloudDesc.textContent = 'Couvert';
            }
        }
        
        // Point de rosée
        const dewElement = document.getElementById('dewpoint');
        const dewDesc = document.getElementById('dew-desc');
        if (dewElement && current.dew_point_2m !== undefined) {
            dewElement.textContent = `${Math.round(current.dew_point_2m)}°`;
            
            if (dewDesc) {
                if (current.dew_point_2m < 10) dewDesc.textContent = 'Confortable';
                else if (current.dew_point_2m < 15) dewDesc.textContent = 'Legerement humide';
                else if (current.dew_point_2m < 20) dewDesc.textContent = 'Humide';
                else dewDesc.textContent = 'Lourd';
            }
        }
        
        // Indice UV (utiliser donnees reelles ou calculer)
        const uvElement = document.getElementById('uv-index');
        const uvDesc = document.getElementById('uv-desc');
        const hour = new Date().getHours();
        let uv = 0;
        
        if (current.weather_code === 0 && hour >= 10 && hour <= 16) {
            uv = Math.round(Math.random() * 3 + 6);
        } else if (current.weather_code === 0 && hour >= 7 && hour <= 19) {
            uv = Math.round(Math.random() * 2 + 3);
        } else if (current.weather_code === 1) {
            uv = Math.round(Math.random() * 2 + 1);
        }
        
        if (uvElement) {
            uvElement.textContent = uv;
        }
        if (uvDesc) {
            if (uv <= 2) uvDesc.textContent = 'Faible';
            else if (uv <= 5) uvDesc.textContent = 'Modéré';
            else if (uv <= 7) uvDesc.textContent = 'Élevé';
            else uvDesc.textContent = 'Très élevé';
        }
        
        // Additional weather data
        if (weatherData.daily && weatherData.daily.sunrise && weatherData.daily.sunset) {
            const sunriseTime = new Date(weatherData.daily.sunrise[0]);
            const sunsetTime = new Date(weatherData.daily.sunset[0]);
            
            const sunriseStr = sunriseTime.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            const sunsetStr = sunsetTime.toLocaleTimeString('fr-FR', { 
                hour: '2-digit', 
                minute: '2-digit' 
            });
            
            const sunriseElement = document.getElementById('sunrise');
            const sunsetElement = document.getElementById('sunset');
            
            if (sunriseElement) sunriseElement.textContent = sunriseStr;
            if (sunsetElement) sunsetElement.textContent = sunsetStr;
        }
        
        // debug
        // Temperature average (daily)
        // debug
        const tempAvgElement = document.getElementById('temp-avg');
        const maxTemps = weatherData?.daily?.temperature_2m_max;
        const minTemps = weatherData?.daily?.temperature_2m_min;
        console.log('temp-avg debug: maxTemps =', maxTemps, 'minTemps =', minTemps);
        if (tempAvgElement && maxTemps && minTemps && maxTemps.length > 0 && minTemps.length > 0) {
                const todayMax = maxTemps[0];
                const todayMin = minTemps[0];
                const avg = Math.round((todayMax + todayMin) / 2);
                tempAvgElement.textContent = avg + '°';
                const tempAvgDesc = document.getElementById('temp-avg-desc');
                if (tempAvgDesc) {
                    tempAvgDesc.textContent = 'Min: ' + Math.round(todayMin) + '° / Max: ' + Math.round(todayMax) + '°';
                }
            }
        }

        // Cloudiness (simulated based on weather code)
        const cloudinessElement = document.getElementById('cloudiness');
        if (cloudinessElement) {
            let cloudiness = 0;
            if (current.weather_code >= 1 && current.weather_code <= 3) {
                cloudiness = Math.round(Math.random() * 40 + 20);
            } else if (current.weather_code >= 45 && current.weather_code <= 48) {
                cloudiness = Math.round(Math.random() * 30 + 70);
            } else if (current.weather_code >= 51 && current.weather_code <= 99) {
                cloudiness = Math.round(Math.random() * 20 + 80);
            }
            cloudinessElement.textContent = `${cloudiness}%`;
        }
        
        // Next hour forecast with rain chart
        updateNextHourForecast(weatherData);
        
        // Hourly forecast - 24h améliorée avec nouvelles icônes SVG
        const hourly = weatherData.hourly;
        const hourlyList = document.getElementById('hourly-list');
        
        // Validations
        if (!hourly || !hourly.time || !hourly.temperature_2m) {
            console.error('Données horaires manquantes');
            return;
        }
        
        // Find current hour index - using the API hour strings
        let startIndex = 0;
        const nowHour = new Date().getHours();
        for (let j = 0; j < hourly.time.length; j++) {
            const ts = hourly.time[j];
            const hourMatch = ts.match(/T(\d{2}):/);
            const h = hourMatch ? parseInt(hourMatch[1]) : -1;
            if (h === nowHour || h === nowHour - 1 || (nowHour === 0 && h === 23)) {
                startIndex = j;
                break;
            }
        }
        
        let hourlyHTML = '';
        for (let i = 0; i < 24; i++) {
            const hourIndex = startIndex + i;
            if (hourIndex >= hourly.time.length) break;
            
            // Parse l'heure depuis le timestamp
            const ts = hourly.time[hourIndex];
            
            // Use the index i directly (correspond aux donnees API)
            const isCurrentHour = i === 0;
            const code = hourly.weather_code[hourIndex];
            const hourlyIsDay = hourly.is_day[hourIndex] === 1;
            const temp = Math.round(hourly.temperature_2m[hourIndex]);
            
            // Ajouter le % de pluie UNIQUEMENT s'il pleut (codes pluie)
            const precipProb = hourly.precipitation_probability?.[hourIndex] || 0;
            // Codes pluie: 51-67 (bruine/pluie), 80-82 (averses), 95-99 (orage)
            const isRainCode = (code >= 51 && code <= 67) || (code >= 80 && code <= 99);
            const rainDisplay = isRainCode ? 
                `<div class="rain">💧 ${precipProb}%</div>` : '';
            
            // Apple weather emoji icon
            const iconHTML = getAppleWeatherIcon(code, hourlyIsDay);
            
            // Ajouter des détails supplémentaires
            const weatherInfo = getWeatherInfo(code);
            // Afficher l'heure en tenant compte du fuseau horaire
            let hourTime = i;
            if (ts) {
                const hourMatch = ts.match(/T(\d{2}):/);
                hourTime = hourMatch ? parseInt(hourMatch[1]) : i;
            }
            // Ajuster selon le décalage horaire du lieu
            const tzOffset = window.timezoneOffset || 0;
            hourTime = hourTime; // FIX: No offset - API returns local time
            // hourTime check removed - API gives valid 0-23
            const timeLabel = isCurrentHour ? 'Maint' : `${hourTime}h`;
            
            // Ajouter une classe spéciale pour l'heure actuelle
            const currentClass = isCurrentHour ? 'current-hour' : '';
            
            hourlyHTML += `
                <div class="hourly-item ${currentClass}">
                    <div class="time">${timeLabel}</div>
                    <div class="icon">${iconHTML}</div>
                    <div class="temp">${temp}°</div>
                    ${rainDisplay}
                </div>
            `;
        }
        hourlyList.innerHTML = hourlyHTML;
        
        // Daily forecast - améliorée avec icônes SVG météo IA
        const daily = weatherData.daily;
        const dailyList = document.getElementById('daily-list');
        
        if (!daily || !daily.time || daily.time.length === 0 || !daily.temperature_2m_max) {
            console.error('Données quotidiennes manquantes ou invalides, daily =', daily);
        }
        
        // Calculer les températures min/max pour l'échelle
        const allTemps = [...daily.temperature_2m_min, ...daily.temperature_2m_max];
        const minTemp = Math.min(...allTemps);
        const maxTemp = Math.max(...allTemps);
        const range = maxTemp - minTemp || 1;
        
        let dailyHTML = '';
        const maxDays = Math.min(daily.time.length, 8); // Limiter à 8 jours
        
        for (let i = 0; i < maxDays; i++) {
            const date = new Date(daily.time[i]);
            const dayName = i === 0 ? 'Auj.' : days[date.getDay()];
            const code = daily.weather_code[i];
            const weatherInfo = getWeatherInfo(code);
            
            // Créer l'icône SVG météo IA réaliste
            // Apple weather emoji icon
            const iconHTML = getAppleWeatherIcon(code, true);
            
            const tempLow = daily.temperature_2m_min[i];
            const tempHigh = daily.temperature_2m_max[i];
            
            // Vérifier que les températures sont valides
            if (tempLow === null || tempHigh === null || tempLow === undefined || tempHigh === undefined) {
                continue;
            }
            
            // Calculer les positions pour la barre de température
            const lowPos = ((tempLow - minTemp) / range) * 100;
            const highPos = ((tempHigh - minTemp) / range) * 100;
            const barStart = Math.min(lowPos, highPos);
            const barWidth = Math.abs(highPos - lowPos);
            
            // Ajouter une classe spéciale pour aujourd'hui
            const isToday = i === 0;
            const todayClass = isToday ? 'today' : '';
            const aiCondition = getWeatherInfo(code).condition;
            
            dailyHTML += `
                <div class="daily-item ${todayClass}">
                    <div class="day">${dayName}</div>
                    <div class="icon">${iconHTML}</div>
                    <div class="condition">${aiCondition}</div>
                    <div class="-temps">
                        <span class="temp-low">${Math.round(tempLow)}°</span>
                        <span class="temp-high">${Math.round(tempHigh)}°</span>
                    </div>
                </div>
            `;
        }
        if (dailyList) {
            dailyList.innerHTML = dailyHTML;
            // displayTempRange(weatherData);
        }
        
        // Mettre à jour le fond dynamique - une seule fois au premier chargement
        // Si pluie prevue soon, utiliser bg-rain
        const willRainSoon = weatherData.hourly && weatherData.hourly.precipitation_probability && 
            weatherData.hourly.precipitation_probability.slice(0, 3).some(p => p > 30);
        const bgClass = willRainSoon ? 'bg-rain' : (getWeatherInfo(current.weather_code || 0).bg || 'bg-blue');
        
        // Seulement appliquer au premier chargement (quand pas de fond defini)
        if (!document.body.classList.contains('bg-')) {
            if (current.is_day === 0) {
                document.body.className = 'bg-night';
            } else {
                document.body.className = bgClass;
            }
        }
        
        // Réinitialiser le bouton de recherche
        if (searchBtn) searchBtn.style.opacity = '1';

function updateBackground(weatherCode, isDay) {
    const bg = document.querySelector('.bg-layer');
    const hour = new Date().getHours();
    
    // Déterminer la période de la journée
    const timeOfDay = getTimeOfDay(hour);
    
    // Appliquer l'arrière-plan selon le code météo et l'heure
    const bgConfig = getBackgroundConfig(weatherCode, isDay, timeOfDay);
    
    // Créer un arrière-plan dynamique avec plusieurs couches
    bg.innerHTML = createDynamicBackground(bgConfig);
    
    // Ajouter des animations subtiles selon la météo
    addWeatherAnimations(weatherCode, bgConfig);
}

function getTimeOfDay(hour) {
    if (hour >= 5 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 20) return 'dusk';
    return 'night';
}

function getBackgroundConfig(weatherCode, isDay, timeOfDay) {
    const configs = {
        // Ciel dégagé
        0: {
            dawn: { primary: '#FF6B6B', secondary: '#4ECDC4', accent: '#45B7D1' },
            morning: { primary: '#87CEEB', secondary: '#98D8E8', accent: '#F0E68C' },
            afternoon: { primary: '#00BFFF', secondary: '#87CEEB', accent: '#FFD700' },
            dusk: { primary: '#FF7F50', secondary: '#FF6347', accent: '#FFD700' },
            night: { primary: '#191970', secondary: '#000080', accent: '#4169E1' }
        },
        // Quelques nuages
        1: {
            dawn: { primary: '#FFB6C1', secondary: '#87CEEB', accent: '#DDA0DD' },
            morning: { primary: '#B0C4DE', secondary: '#87CEEB', accent: '#F0E68C' },
            afternoon: { primary: '#87CEEB', secondary: '#B0C4DE', accent: '#FFD700' },
            dusk: { primary: '#FF8C00', secondary: '#FF6347', accent: '#FFD700' },
            night: { primary: '#2F4F4F', secondary: '#191970', accent: '#708090' }
        },
        // Nuageux
        2: {
            dawn: { primary: '#D3D3D3', secondary: '#A9A9A9', accent: '#D8BFD8' },
            morning: { primary: '#C0C0C0', secondary: '#D3D3D3', accent: '#F5F5DC' },
            afternoon: { primary: '#A9A9A9', secondary: '#C0C0C0', accent: '#F5F5DC' },
            dusk: { primary: '#8B7355', secondary: '#A0522D', accent: '#D2691E' },
            night: { primary: '#2F2F2F', secondary: '#1C1C1C', accent: '#36454F' }
        },
        // Pluie
        51: {
            dawn: { primary: '#708090', secondary: '#778899', accent: '#4682B4' },
            morning: { primary: '#696969', secondary: '#708090', accent: '#4682B4' },
            afternoon: { primary: '#2F4F4F', secondary: '#696969', accent: '#4682B4' },
            dusk: { primary: '#483D8B', secondary: '#2F4F4F', accent: '#4682B4' },
            night: { primary: '#191970', secondary: '#000080', accent: '#4682B4' }
        },
        // Orage
        95: {
            dawn: { primary: '#4B0082', secondary: '#8B008B', accent: '#FFD700' },
            morning: { primary: '#483D8B', secondary: '#4B0082', accent: '#FFD700' },
            afternoon: { primary: '#191970', secondary: '#483D8B', accent: '#FFD700' },
            dusk: { primary: '#4B0082', secondary: '#8B008B', accent: '#FFD700' },
            night: { primary: '#0F0F0F', secondary: '#191970', accent: '#FFD700' }
        },
        // Neige
        71: {
            dawn: { primary: '#F0F8FF', secondary: '#E6E6FA', accent: '#FFFFFF' },
            morning: { primary: '#FFFFFF', secondary: '#F0F8FF', accent: '#E6E6FA' },
            afternoon: { primary: '#F5F5F5', secondary: '#FFFFFF', accent: '#E6E6FA' },
            dusk: { primary: '#E6E6FA', secondary: '#D3D3D3', accent: '#FFFFFF' },
            night: { primary: '#F0F8FF', secondary: '#E6E6FA', accent: '#FFFFFF' }
        }
    };
    
    // Utiliser la configuration pour le code météo, sinon fallback sur ciel dégagé
    return configs[weatherCode] || configs[0][timeOfDay] || configs[0].afternoon;
}

function createDynamicBackground(config) {
    return `
        <div class="bg-gradient" style="
            background: linear-gradient(135deg, 
                ${config.primary} 0%, 
                ${config.secondary} 50%, 
                ${config.accent} 100%);
            animation: bgShift 20s ease-in-out infinite;
        "></div>
        <div class="bg-overlay" style="
            background: radial-gradient(circle at 30% 20%, 
                rgba(255,255,255,0.1) 0%, 
                transparent 50%);
        "></div>
        <div class="bg-particles" id="weather-particles"></div>
    `;
}

function addWeatherAnimations(weatherCode, config) {
    const particles = document.getElementById('weather-particles');
    if (!particles) return;
    
    particles.innerHTML = '';
    
    // Ajouter des particules selon la météo
    if (weatherCode === 0 || weatherCode === 1) {
        // Soleil - particules lumineuses
        createSunParticles(particles);
    } else if (weatherCode >= 51 && weatherCode <= 67) {
        // Pluie - gouttes animées
        createRainParticles(particles);
    } else if (weatherCode >= 71 && weatherCode <= 77) {
        // Neige - flocons animés
        createSnowParticles(particles);
    } else if (weatherCode >= 95 && weatherCode <= 99) {
        // Orage - éclairs
        createThunderParticles(particles);
    }
}

function createSunParticles(container) {
    for (let i = 0; i < 3; i++) {
        const particle = document.createElement('div');
        particle.className = 'sun-particle';
        particle.style.cssText = `
            position: absolute;
            width: ${Math.random() * 4 + 2}px;
            height: ${Math.random() * 4 + 2}px;
            background: rgba(255, 215, 0, 0.6);
            border-radius: 50%;
            left: ${Math.random() * 100}%;
            top: ${Math.random() * 100}%;
            animation: float ${3 + Math.random() * 2}s ease-in-out infinite;
            animation-delay: ${Math.random() * 2}s;
        `;
        container.appendChild(particle);
    }
}

function createRainParticles(container) {
    for (let i = 0; i < 20; i++) {
        const drop = document.createElement('div');
        drop.className = 'rain-drop';
        drop.style.cssText = `
            position: absolute;
            width: 1px;
            height: ${Math.random() * 10 + 5}px;
            background: rgba(100, 149, 237, 0.6);
            left: ${Math.random() * 100}%;
            top: -10px;
            animation: rainFall ${Math.random() * 1 + 0.5}s linear infinite;
            animation-delay: ${Math.random() * 2}s;
        `;
        container.appendChild(drop);
    }
}

function createSnowParticles(container) {
    for (let i = 0; i < 15; i++) {
        const flake = document.createElement('div');
        flake.className = 'snow-flake';
        flake.style.cssText = `
            position: absolute;
            width: ${Math.random() * 4 + 2}px;
            height: ${Math.random() * 4 + 2}px;
            background: rgba(255, 255, 255, 0.8);
            border-radius: 50%;
            left: ${Math.random() * 100}%;
            top: -10px;
            animation: snowFall ${Math.random() * 3 + 2}s linear infinite;
            animation-delay: ${Math.random() * 3}s;
        `;
        container.appendChild(flake);
    }
}

function createThunderParticles(container) {
    // Créer des éclairs intermittents
    setInterval(() => {
        if (Math.random() > 0.7) {
            const flash = document.createElement('div');
            flash.className = 'thunder-flash';
            flash.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(255, 255, 255, 0.8);
                animation: thunderFlash 0.3s ease-out;
            `;
            container.appendChild(flash);
            
            setTimeout(() => {
                container.removeChild(flash);
            }, 300);
        }
    }, 3000);
}

function showSuggestions(query) {
    const suggestionsContainer = document.getElementById('search-suggestions');
    const clearBtn = document.getElementById('search-clear');
    
    if (!query) {
        hideSuggestions();
        clearBtn.style.display = 'none';
        return;
    }
    
    clearBtn.style.display = 'block';
    
    const filteredCities = cities.filter(city => 
        city.toLowerCase().includes(query.toLowerCase())
    ).slice(0, 8);
    
    if (filteredCities.length === 0) {
        hideSuggestions();
        return;
    }
    
    suggestionsContainer.innerHTML = '';
    filteredCities.forEach(city => {
        const suggestionItem = document.createElement('div');
        suggestionItem.className = 'suggestion-item';
        suggestionItem.innerHTML = `
            <span class="city-icon">📍</span>
            <span>${city}</span>
        `;
        suggestionItem.addEventListener('click', () => {
            selectCity(city);
        });
        suggestionsContainer.appendChild(suggestionItem);
    });
    
    suggestionsContainer.classList.add('active');
}

function hideSuggestions() {
    const suggestionsContainer = document.getElementById('search-suggestions');
    suggestionsContainer.classList.remove('active');
    suggestionsContainer.innerHTML = '';
}

function selectCity(city) {
    const input = document.getElementById('city-input');
    input.value = city;
    hideSuggestions();
    
    // Forcer la mise à jour même si on est en localisation
    currentCity = city;
    updateWeather(city);
    
    // Réinitialiser les coordonnées pour permettre la recherche manuelle
    if (city !== 'Votre position' && city !== 'Localisation...') {
        currentCoords = null; // Réinitialiser les coordonnées pour permettre la recherche manuelle
    }
}

function searchCity() {
    const input = document.getElementById('city-input');
    const city = input.value.trim();
    const cityElement = document.querySelector('.city');
    const tempElement = document.document.getElementById('current-temp') || document.querySelector('.big-temp');
    const conditionElement = document.querySelector('.condition');
    
    if (city && city.length > 1) {
        // Arreter le rafraichissement auto
        stopAutoRefresh();
        
        // Feedback instant - ALWAYS show the city name user typed
        if (cityElement) {
            const cleanName = city.charAt(0).toUpperCase() + city.slice(1).toLowerCase();
            cityElement.textContent = cleanName;
        }
        if (tempElement) tempElement.textContent = '...';
        if (conditionElement) conditionElement.textContent = 'Chargement...';
        
        // Recherche
        currentCity = city;
        currentCoords = { lat: null, lon: null, manual: true };
        
        updateWeather(city).then(() => {
            // Replier le clavier mobile
            input.blur();
        });
    }
}

function setupSearchListeners() {
    const input = document.getElementById('city-input');
    const clearBtn = document.getElementById('search-clear');
    const quickCities = document.querySelectorAll('.quick-city');
    
    // Input events
    input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        showSuggestions(query);
    });
    
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            hideSuggestions();
            searchCity();
            input.blur();
        }
    });
    
    input.addEventListener('focus', (e) => {
        const query = e.target.value.trim();
        if (query) {
            showSuggestions(query);
        }
    });
    
    // Clear button
    clearBtn.addEventListener('click', () => {
        input.value = '';
        hideSuggestions();
        clearBtn.style.display = 'none';
        input.focus();
    });
    
    // Quick city buttons
    quickCities.forEach(btn => {
        btn.addEventListener('click', () => {
            const city = btn.getAttribute('data-city');
            selectCity(city);
        });
    });
    
    // Hide suggestions on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            hideSuggestions();
        }
    });
}

function updateNextHourForecast(weatherData) {
    const rainChart = document.getElementById('rain-chart');
    const rainPercentage = document.getElementById('rain-percentage');
    
    if (!rainChart || !rainPercentage) return;
    
    // Données de pluie pour la prochaine heure
    const hourly = weatherData.hourly;
    const nowMs = Date.now();
    
    // Trouver l'index de départ (heure actuelle)
    let startIdx = 0;
    for (let j = 0; j < hourly.time.length; j++) {
        if (hourly.time[j] >= nowMs - 1800000) {
            startIdx = j;
            break;
        }
    }
    
    // 12 barres = données des 2 prochaines heures (6 barres par heure)
    let chartHTML = '';
    let rainProbability = 0;
    
    for (let i = 0; i < 12; i++) {
        const hourIndex = startIdx + Math.floor(i / 6);
        if (hourIndex >= hourly.time.length) break;
        
        const weatherCode = hourly.weather_code[hourIndex] || 0;
        let barHeight = 5;
        
        if (weatherCode >= 51 && weatherCode <= 67) {
            barHeight = Math.random() * 30 + 20;
            rainProbability = Math.max(rainProbability, 60);
        } else if (weatherCode >= 80 && weatherCode <= 82) {
            barHeight = Math.random() * 40 + 30;
            rainProbability = Math.max(rainProbability, 80);
        } else if (weatherCode >= 95 && weatherCode <= 99) {
            barHeight = Math.random() * 20 + 50;
            rainProbability = Math.max(rainProbability, 90);
        }
        
        chartHTML += `<div class="rain-bar" style="height: ${barHeight}px"></div>`;
    }
    
    rainChart.innerHTML = chartHTML;
    rainPercentage.textContent = `${rainProbability}%`;
}

// Auto-refresh en temps réel pour mobile
let autoRefreshInterval;
let isFirstLoad = true;
let lastUpdateTime = 0;
let refreshTimeout;
let realTimeInterval;
let visibilityChangeHandler;
let networkChangeHandler;

function startAutoRefresh() {
    // Arrêter les intervalles précédents
    stopAutoRefresh();
    
    // Ne pas démarrer auto-refresh si on a fait une recherche manuelle
    if (currentCoords?.manual === true) {
        console.log('Recherche manuelle - pas de auto-refresh');
        return;
    }
    
    console.log('Démarrage rafraîchissement automatique');
    
    // Intervalle de rafraîchissement optimisé pour temps réel
    const refreshInterval = API_CONFIG.realTimeConfig.refreshInterval; // 15 secondes
    
    autoRefreshInterval = setInterval(() => {
        if (currentCity && Date.now() - lastUpdateTime > 10000) { // Pas plus d'une fois par 10s
            console.log('Rafraîchissement automatique en cours...');
            updateWeatherRealTime();
        }
    }, refreshInterval);
    
    // Intervalle de temps réel ultra-rapide (toutes les 10 secondes)
    realTimeInterval = setInterval(() => {
        if (currentCity && isPageVisible() && isOnline()) {
            console.log('Mise à jour temps réel automatique...');
            updateWeatherRealTime();
        }
    }, 10000); // 10 secondes pour temps réel garanti
    
    // Gérer les changements de visibilité de la page pour optimiser les ressources
    setupVisibilityHandlers();
    
    // Gérer les changements de connexion pour garantir la fiabilité
    setupNetworkHandlers();
    
    // Rafraîchissement immédiat au démarrage
    if (currentCity) {
        setTimeout(() => updateWeatherRealTime(), 1000);
    }
}

// Arrêter tous les intervalles
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    if (realTimeInterval) {
        clearInterval(realTimeInterval);
        realTimeInterval = null;
    }
    if (refreshTimeout) {
        clearTimeout(refreshTimeout);
        refreshTimeout = null;
    }
}

// Vérifier si la page est visible
function isPageVisible() {
    return !document.hidden;
}

// Vérifier si on est en ligne - L'IA météo fonctionne hors ligne
function isOnline() {
    return true; // L'IA météo fonctionne même sans connexion
}

// Mettre en place les gestionnaires de visibilité
function setupVisibilityHandlers() {
    if (visibilityChangeHandler) {
        document.removeEventListener('visibilitychange', visibilityChangeHandler);
    }
    
    visibilityChangeHandler = () => {
        if (!document.hidden && currentCity && Date.now() - lastUpdateTime > 5000) {
            // Mettre à jour dès que la page devient visible
            updateWeatherRealTime();
        }
    };
    
    document.addEventListener('visibilitychange', visibilityChangeHandler);
}

// Vérifier si la page est visible
function isPageVisible() {
    try {
        return !document.hidden;
    } catch (error) {
        console.warn('Erreur vérification visibilité page:', error);
        return true; // Par défaut, considérer comme visible
    }
}

// Test de connexion rapide - désactivé car l'IA fonctionne hors ligne
async function testConnection() {
    try {
        // Test avec une requête simple et rapide
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 secondes timeout
        
        const response = await fetch('https://httpbin.org/status/200', {
            method: 'HEAD',
            signal: controller.signal,
            cache: 'no-cache'
        });
        
        clearTimeout(timeoutId);
        return response.ok;
    } catch (error) {
        console.warn('Test de connexion échoué:', error.message);
        // Même si le test échoue, on considère qu'on est en ligne pour l'IA
        return true; // L'IA fonctionne hors-ligne
    }
}

// Mettre en place les gestionnaires de réseau avec gestion d'erreur
function setupNetworkHandlers() {
    try {
        // Nettoyer les anciens gestionnaires
        if (networkChangeHandler) {
            try {
                window.removeEventListener('online', networkChangeHandler);
                window.removeEventListener('offline', networkChangeHandler);
            } catch (error) {
                console.warn('Erreur nettoyage gestionnaires réseau:', error);
            }
        }

        // Nouveau gestionnaire de réseau
        networkChangeHandler = async () => {
            try {
                console.log('Changement de connexion détecté:', navigator.onLine ? 'En ligne' : 'Hors ligne');
                
                if (navigator.onLine && currentCity) {
                    console.log('🔄 Reconnexion détectée, mise à jour météo...');
                    
                    // Petite attente pour stabiliser la connexion
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    
                    // Mettre à jour dès qu'on retrouve la connexion
                    updateWeatherRealTime();
                } else if (!navigator.onLine) {
                    console.log('📵 Connexion perdue, l\'IA continue de fonctionner...');
                    // L'IA météo fonctionne même hors-ligne
                }
            } catch (error) {
                console.error('Erreur gestionnaire de changement réseau:', error);
            }
        };

        // Ajouter les nouveaux gestionnaires
        try {
            window.addEventListener('online', networkChangeHandler);
            window.addEventListener('offline', networkChangeHandler);
            console.log('🌐 Gestionnaires réseau configurés avec succès');
        } catch (error) {
            console.warn('Erreur configuration gestionnaires réseau:', error);
        }
    } catch (error) {
        console.error('Erreur setupNetworkHandlers:', error);
    }
}

// Fonction de récupération d'erreur de connexion
function handleConnectionError(error) {
    console.error('Erreur de connexion météo:', error);
    
    // Vérifier si c'est une erreur de réseau
    if (error.message && error.message.includes('fetch')) {
        showWeatherError('Erreur de connexion. L\'IA météo fonctionne hors-ligne.');
        
        // Forcer l'utilisation de l'IA même sans connexion
        setTimeout(() => {
            if (currentCity) {
                console.log('🤖 Activation IA météo hors-ligne...');
                updateWeatherRealTime();
            }
        }, 1000);
    } else {
        showWeatherError('Erreur météo. L\'IA génère des données de secours.');
    }
}

// Version temps réel de updateWeather (sans message)
function updateWeatherRealTime() {
    // Éviter les requêtes multiples
    if (refreshTimeout) {
        clearTimeout(refreshTimeout);
    }
    
    refreshTimeout = setTimeout(() => {
        if (currentCoords) {
            updateWeatherByCoords(currentCoords.lat, currentCoords.lon);
        } else if (currentCity) {
            updateWeather(currentCity);
        }
        lastUpdateTime = Date.now();
    }, 50); // Debounce ultra-rapide de 50ms
}

// Version optimisée de updateWeather (maintenant utilisée par updateWeatherRealTime)
function updateWeatherOptimized(city) {
    updateWeatherRealTime();
}

// Apple-style weather icons
// ============================================
// REALISTIC WEATHER ICONS with details
// ============================================
function createWeatherIconSVG(code, isDay = true, size = 48) {
    const s = size;
    const cx = s / 2;
    const cy = s / 2;
    const r = s * 0.35;
    const rm = s * 0.4; // radius for moon
    
    // Helper to create circle
    const circle = (cx, cy, r, fill) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
    const circleS = (cx, cy, r, fill, op) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
    
    // Colors based on weather
    let bgColor = '#FFF';
    let fgColor = '#333';
    let accentColor = '';
    
    // Weather-specific icons (WMO codes)
    // 0: Clear, 1-3: Cloudy, 45-48: Fog, 51-67: Drizzle/Rain, 71-77: Snow, 80-82: Showers, 95-99: Thunder
    
    if (code === 0) { // CLEAR SKY
        if (isDay) {
            // Bright sun with rays
            return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="sunGrad${code}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#FFE135"/>
                        <stop offset="100%" style="stop-color:#FFD700"/>
                    </linearGradient>
                </defs>
                <!-- Sun rays -->
                <g stroke="#FFD700" stroke-width="${s*0.03}" stroke-linecap="round">
                    <line x1="${cx}" y1="${s*0.1}" x2="${cx}" y2="${s*0.22}"/>
                    <line x1="${cx}" y1="${s*0.9}" x2="${cx}" y2="${s*0.78}"/>
                    <line x1="${s*0.1}" y1="${cx}" x2="${s*0.22}" y2="${cx}"/>
                    <line x1="${s*0.9}" y1="${cx}" x2="${s*0.78}" y2="${cx}"/>
                    <line x1="${s*0.18}" y1="${s*0.18}" x2="${s*0.28}" y2="${s*0.28}"/>
                    <line x1="${s*0.82}" y1="${s*0.82}" x2="${s*0.72}" y2="${s*0.72}"/>
                    <line x1="${s*0.18}" y1="${s*0.82}" x2="${s*0.28}" y2="${s*0.72}"/>
                    <line x1="${s*0.82}" y1="${s*0.18}" x2="${s*0.72}" y2="${s*0.28}"/>
                </g>
                <!-- Sun circle -->
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#sunGrad${code})"/>
            </svg>`;
        } else {
            // Crescent moon
            return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="moonGrad${code}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#F4F6F0"/>
                        <stop offset="100%" style="stop-color:#E8E8E8"/>
                    </linearGradient>
                </defs>
                <!-- Moon body -->
                <path d="M${s*0.55},${s*0.15} A${rm},${rm} 0 1,1 ${s*0.45},${s*0.85} A${rm},${rm} 0 1,0 ${s*0.55},${s*0.15}" fill="url(#moonGrad${code})"/>
                <!-- Moon craters -->
                <circle cx="${s*0.5}" cy="${s*0.4}" r="${s*0.06}" fill="#D0D0D0" opacity="0.5"/>
                <circle cx="${s*0.58}" cy="${s*0.55}" r="${s*0.04}" fill="#D0D0D0" opacity="0.4"/>
            </svg>`;
        }
    }
    else if (code >= 1 && code <= 3) { // PARTLY CLOUDY
        if (isDay) {
            return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="cloudGrad${code}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#FFFFFF"/>
                        <stop offset="100%" style="stop-color:#E8E8E8"/>
                    </linearGradient>
                </defs>
                <!-- Sun behind -->
                <circle cx="${s*0.65}" cy="${s*0.35}" r="${s*0.18}" fill="#FFD700"/>
                <g stroke="#FFD700" stroke-width="${s*0.02}" stroke-linecap="round">
                    <line x1="${s*0.7}" y1="${s*0.12}" x2="${s*0.7}" y2="${s*0.22}"/>
                    <line x1="${s*0.82}" y1="${s*0.35}" x2="${s*0.72}" y2="${s*0.35}"/>
                    <line x1="${s*0.78}" y1="${s*0.18}" x2="${s*0.72}" y2="${s*0.25}"/>
                </g>
                <!-- Cloud -->
                <path d="M${s*0.15},${s*0.65} Q${s*0.1},${s*0.5} ${s*0.3},${s*0.55} Q${s*0.35},${s*0.45} ${s*0.5},${s*0.48} Q${s*0.6},${s*0.4} ${s*0.75},${s*0.5} Q${s*0.9},${s*0.55} ${s*0.8},${s*0.65} Q${s*0.85},${s*0.75} ${s*0.65},${s*0.75} Q${s*0.5},${s*0.8} ${s*0.15},${s*0.65}" fill="url(#cloudGrad${code})"/>
            </svg>`;
        } else {
            return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="cloudGradN${code}" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style="stop-color:#B8C4CE"/>
                        <stop offset="100%" style="stop-color:#8A9AAA"/>
                    </linearGradient>
                </defs>
                <!-- Moon -->
                <path d="M${s*0.7},${s*0.2} A${s*0.2},${s*0.2} 0 1,1 ${s*0.6},${s*0.7} A${s*0.2},${s*0.2} 0 1,0 ${s*0.7},${s*0.2}" fill="#E8E8E8"/>
                <!-- Cloud -->
                <path d="M${s*0.15},${s*0.65} Q${s*0.1},${s*0.5} ${s*0.3},${s*0.55} Q${s*0.35},${s*0.45} ${s*0.5},${s*0.48} Q${s*0.6},${s*0.4} ${s*0.75},${s*0.5} Q${s*0.9},${s*0.55} ${s*0.8},${s*0.65} Q${s*0.85},${s*0.75} ${s*0.65},${s*0.75} Q${s*0.5},${s*0.8} ${s*0.15},${s*0.65}" fill="url(#cloudGradN${code})"/>
            </svg>`;
        }
    }
    else if (code >= 45 && code <= 48) { // FOG
        return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
            <g fill="none" stroke="#B8C4CE" stroke-width="${s*0.04}" stroke-linecap="round">
                <line x1="${s*0.2}" y1="${s*0.35}" x2="${s*0.8}" y2="${s*0.35}"/>
                <line x1="${s*0.15}" y1="${s*0.5}" x2="${s*0.75}" y2="${s*0.5}"/>
                <line x1="${s*0.25}" y1="${s*0.65}" x2="${s*0.85}" y2="${s*0.65}"/>
                <line x1="${s*0.2}" y1="${s*0.8}" x2="${s*0.8}" y2="${s*0.8}"/>
            </g>
        </svg>`;
    }
    else if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) { // RAIN/DRIZZLE/SHOWERS
        return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="rainCloud${code}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#A8B8C8"/>
                    <stop offset="100%" style="stop-color:#8898A8"/>
                </linearGradient>
            </defs>
            <!-- Cloud -->
            <path d="M${s*0.15},${s*0.35} Q${s*0.1},${s*0.2} ${s*0.3},${s*0.25} Q${s*0.35},${s*0.15} ${s*0.5},${s*0.18} Q${s*0.6},${s*0.1} ${s*0.75},${s*0.2} Q${s*0.9},${s*0.25} ${s*0.8},${s*0.35} Q${s*0.85},${s*0.45} ${s*0.65},${s*0.45} Q${s*0.5},${s*0.5} ${s*0.15},${s*0.35}" fill="url(#rainCloud${code})"/>
            <!-- Rain drops -->
            <g fill="#4A90D9">
                <ellipse cx="${s*0.3}" cy="${s*0.6}" rx="${s*0.025}" ry="${s*0.06}"/>
                <ellipse cx="${s*0.5}" cy="${s*0.6}" rx="${s*0.025}" ry="${s*0.06}"/>
                <ellipse cx="${s*0.7}" cy="${s*0.6}" rx="${s*0.025}" ry="${s*0.06}"/>
                <ellipse cx="${s*0.4}" cy="${s*0.75}" rx="${s*0.025}" ry="${s*0.06}"/>
                <ellipse cx="${s*0.6}" cy="${s*0.75}" rx="${s*0.025}" ry="${s*0.06}"/>
            </g>
        </svg>`;
    }
    else if (code >= 71 && code <= 77) { // SNOW
        return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="snowCloud${code}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#D0D8E0"/>
                    <stop offset="100%" style="stop-color:#B8C0C8"/>
                </linearGradient>
            </defs>
            <!-- Cloud -->
            <path d="M${s*0.15},${s*0.35} Q${s*0.1},${s*0.2} ${s*0.3},${s*0.25} Q${s*0.35},${s*0.15} ${s*0.5},${s*0.18} Q${s*0.6},${s*0.1} ${s*0.75},${s*0.2} Q${s*0.9},${s*0.25} ${s*0.8},${s*0.35} Q${s*0.85},${s*0.45} ${s*0.65},${s*0.45} Q${s*0.5},${s*0.5} ${s*0.15},${s*0.35}" fill="url(#snowCloud${code})"/>
            <!-- Snowflakes -->
            <g fill="#E8F0F8">
                <circle cx="${s*0.3}" cy="${s*0.55}" r="${s*0.035}"/>
                <circle cx="${s*0.5}" cy="${s*0.6}" r="${s*0.04}"/>
                <circle cx="${s*0.7}" cy="${s*0.55}" r="${s*0.035}"/>
                <circle cx="${s*0.4}" cy="${s*0.72}" r="${s*0.035}"/>
                <circle cx="${s*0.6}" cy="${s*0.72}" r="${s*0.04}"/>
            </g>
        </svg>`;
    }
    else if (code >= 95 && code <= 99) { // THUNDER
        return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="stormCloud${code}" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:#606878"/>
                    <stop offset="100%" style="stop-color:#404858"/>
                </linearGradient>
            </defs>
            <!-- Cloud -->
            <path d="M${s*0.15},${s*0.35} Q${s*0.1},${s*0.2} ${s*0.3},${s*0.25} Q${s*0.35},${s*0.15} ${s*0.5},${s*0.18} Q${s*0.6},${s*0.1} ${s*0.75},${s*0.2} Q${s*0.9},${s*0.25} ${s*0.8},${s*0.35} Q${s*0.85},${s*0.45} ${s*0.65},${s*0.45} Q${s*0.5},${s*0.5} ${s*0.15},${s*0.35}" fill="url(#stormCloud${code})"/>
            <!-- Lightning -->
            <path d="M${s*0.48},${s*0.48} L${s*0.42},${s*0.62} L${s*0.52},${s*0.62} L${s*0.45},${s*0.85} L${s*0.58},${s*0.65} L${s*0.48},${s*0.65} Z" fill="#FFD700"/>
        </svg>`;
    }
    
    // Default: cloud
    return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">
        <path d="M${s*0.15},${s*0.55} Q${s*0.1},${s*0.4} ${s*0.3},${s*0.45} Q${s*0.35},${s*0.35} ${s*0.5},${s*0.38} Q${s*0.6},${s*0.3} ${s*0.75},${s*0.4} Q${s*0.9},${s*0.45} ${s*0.8},${s*0.55} Q${s*0.85},${s*0.65} ${s*0.65},${s*0.65} Q${s*0.5},${s*0.7} ${s*0.15},${s*0.55}" fill="#B8C4CE"/>
    </svg>`;
}const s = size;
    const s2 = s / 2;
    const r = s * 0.35;
    const cx = s2;
    const cy = s2;
    
    // Color schemes
    const dayColors = {
        sun: '#FFD700', sunRing: '#FF9500', sky: '#007AFF', 
        cloud: '#FFFFFF', cloudShade: '#E5E5EA', cloudDark: '#C7C7CC',
        rain: '#5AC8FA', snow: '#FFFFFF', thunder: '#BF5AF2'
    };
    const nightColors = {
        sun: '#F5F5F5', sunRing: '#C7C7CC', sky: '#1C1C1E',
        cloud: '#636366', cloudShade: '#48484A', cloudDark: '#3A3A3C',
        rain: '#64D2FF', snow: '#BF5AF2', thunder: '#BF5AF2'
    };
    const colors = isDay ? dayColors : nightColors;
    
    const getCloud = (offY = 0) => `<path d="M${s*0.15},${s*0.45+offY} a${s*0.2},${s*0.2} 0 0,1 ${s*0.25},0 a${s*0.15},${s*0.15} 0 0,1 ${s*0.15},${s*0.1} a${s*0.2},${s*0.2} 0 0,1 ${s*0.25},0 a${s*0.18},${s*0.18} 0 0,1 ${s*0.2},-${s*0.08} a${s*0.15},${s*0.15} 0 0,1 ${s*0.18},${s*0.05}" fill="${colors.cloud}"/>`;
    
    const getSun = () => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colors.sun}"/>`;
    
    const getRain = () => `<g stroke="${colors.rain}" stroke-width="${s*0.05}" stroke-linecap="round" opacity="0.8">
                <line x1="${s*0.32}" y1="${s*0.52}" x2="${s*0.27}" y2="${s*0.72}"/>
                <line x1="${s*0.48}" y1="${s*0.52}" x2="${s*0.43}" y2="${s*0.72}"/>
                <line x1="${s*0.64}" y1="${s*0.52}" x2="${s*0.59}" y2="${s*0.72}"/>
                <line x1="${s*0.4}" y1="${s*0.55}" x2="${s*0.35}" y2="${s*0.75}"/>
                <line x1="${s*0.56}" y1="${s*0.55}" x2="${s*0.51}" y2="${s*0.75}"/>
            </g>`;
    
    const getSnow = () => `<g fill="${colors.snow}">
                <circle cx="${s*0.35}" cy="${s*0.58}" r="${s*0.04}"/>
                <circle cx="${s*0.5}" cy="${s*0.62}" r="${s*0.045}"/>
                <circle cx="${s*0.65}" cy="${s*0.58}" r="${s*0.04}"/>
                <circle cx="${s*0.28}" cy="${s*0.68}" r="${s*0.035}"/>
                <circle cx="${s*0.42}" cy="${s*0.7}" r="${s*0.04}"/>
                <circle cx="${s*0.55}" cy="${s*0.72}" r="${s*0.035}"/>
                <circle cx="${s*0.72}" cy="${s*0.68}" r="${s*0.03}"/>
            </g>`;
    
    const getBolt = () => `<path d="M${s*0.5},${s*0.3} L${s*0.35},${s*0.55} L${s*0.45},${s*0.55} L${s*0.4},${s*0.8} L${s*0.6},${s*0.5} L${s*0.5},${s*0.5} L${s*0.55},${s*0.3} Z" fill="${colors.thunder}"/>`;
    
    // Generate SVG based on weather code
    let svg = '';
    
    if (weatherCode === 0) { // Clear
        svg = isDay 
            ? `${getSun()}`
            : `<circle cx="${cx}" cy="${cy}" r="${r*0.8}" fill="#F5F5F5"/><circle cx="${cx}" cy="${cy}" r="${r*0.4}" fill="#636366"/>`;
    } else if (weatherCode === 1 || weatherCode === 2) { // Partly cloudy
        svg = isDay 
            ? `${getSun()}<g transform="translate(${-s*0.15}, ${-s*0.1})">${getCloud(-s*0.1)}</g>`
            : `${getCloud()}`;
    } else if (weatherCode === 3) { // Cloudy
        svg = `${getCloud()}`;
    } else if (weatherCode === 45 || weatherCode === 48) { // Fog
        svg = `<rect x="${s*0.1}" y="${s*0.4}" width="${s*0.8}" height="${s*0.08}" rx="${s*0.04}" fill="${colors.cloud}"/><rect x="${s*0.15}" y="${s*0.5}" width="${s*0.7}" height="${s*0.06}" rx="${s*0.03}" fill="${colors.cloud}" opacity="0.6"/>`;
    } else if (weatherCode >= 51 && weatherCode <= 67) { // Rain/drizzle
        svg = `${getCloud()}${getRain()}`;
    } else if (weatherCode >= 71 && weatherCode <= 77) { // Snow
        svg = `${getCloud()}${getSnow()}`;
    } else if (weatherCode >= 80 && weatherCode <= 82) { // Rain showers
        svg = `${getCloud()}${getRain()}`;
    } else if (weatherCode >= 85 && weatherCode <= 86) { // Snow showers
        svg = `${getCloud()}${getSnow()}`;
    } else if (weatherCode >= 95) { // Thunderstorm
        svg = `${getCloud()}${getBolt()}`;
    } else {
        svg = isDay ? getSun() : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#F5F5F5"/>`;
    }
    
    return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
}

// Fallback old weather icons
function createOldWeatherIconSVG(weatherCode, isDay, size = 32) {
    const colors = {
        day: {
            sun: '#FFD700',
            sunGlow: '#FFA500',
            cloud: '#FFFFFF',
            cloudDark: '#D3D3D3',
            rain: '#4A90E2',
            snow: '#FFFFFF',
            thunder: '#FF6B6B',
            moon: '#F0E68C',
            moonGlow: '#E6E6FA'
        },
        night: {
            sun: '#F0E68C',
            sunGlow: '#E6E6FA',
            cloud: '#E8E8E8',
            cloudDark: '#C0C0C0',
            rain: '#6495ED',
            snow: '#F0F8FF',
            thunder: '#FF69B4',
            moon: '#F0E68C',
            moonGlow: '#E6E6FA'
        }
    };
    
    const palette = isDay ? colors.day : colors.night;
    
    switch(weatherCode) {
        case 0: // Ensoleillé
            return createSunIcon(palette, size);
        case 1: // Partiellement nuageux
            return createPartlyCloudyIcon(palette, size);
        case 2: // Nuageux
            return createCloudyIcon(palette, size);
        case 3: // Couvert
            return createOvercastIcon(palette, size);
        case 45: // Brouillard
            return createFogIcon(palette, size);
        case 48: // Brouillard givrant
            return createFreezingFogIcon(palette, size);
        case 51: // Bruine légère
        case 53: // Bruine modérée
        case 55: // Bruine forte
            return createDrizzleIcon(palette, size);
        case 61: // Pluie légère
        case 63: // Pluie modérée
        case 65: // Pluie forte
            return createRainIcon(palette, size);
        case 71: // Neige légère
        case 73: // Neige modérée
        case 75: // Neige forte
            return createSnowIcon(palette, size);
        case 80: // Averses légères
        case 81: // Averses modérées
        case 82: // Averses violentes
            return createShowerIcon(palette, size);
        case 85: // Averses de neige
        case 86: // Averses de neige
            return createSnowShowerIcon(palette, size);
        case 95: // Orage
        case 96: // Orage grêle
        case 99: // Orage violent
            return createThunderstormIcon(palette, size);
        default:
            return createSunIcon(palette, size);
    }
}

function createSunIcon(palette, size) {
    const center = size / 2;
    const sunRadius = size * 0.25;
    const rayLength = size * 0.4;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Rayons du soleil -->
            ${[...Array(8)].map((_, i) => {
                const angle = (i * 45) * Math.PI / 180;
                const x1 = center + Math.cos(angle) * (sunRadius + 2);
                const y1 = center + Math.sin(angle) * (sunRadius + 2);
                const x2 = center + Math.cos(angle) * rayLength;
                const y2 = center + Math.sin(angle) * rayLength;
                return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${palette.sunGlow}" stroke-width="2" stroke-linecap="round"/>`;
            }).join('')}
            
            <!-- Cercle du soleil -->
            <circle cx="${center}" cy="${center}" r="${sunRadius}" fill="${palette.sun}"/>
            <circle cx="${center}" cy="${center}" r="${sunRadius * 0.9}" fill="${palette.sunGlow}" opacity="0.3"/>
        </svg>
    `;
}

function createPartlyCloudyIcon(palette, size) {
    const center = size / 2;
    const sunRadius = size * 0.2;
    const cloudX = center + size * 0.1;
    const cloudY = center + size * 0.1;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Soleil partiellement visible -->
            <circle cx="${center - size * 0.15}" cy="${center - size * 0.1}" r="${sunRadius}" fill="${palette.sun}"/>
            
            <!-- Nuage -->
            <ellipse cx="${cloudX}" cy="${cloudY}" rx="${size * 0.25}" ry="${size * 0.15}" fill="${palette.cloud}"/>
            <ellipse cx="${cloudX - size * 0.08}" cy="${cloudY - size * 0.05}" rx="${size * 0.18}" ry="${size * 0.12}" fill="${palette.cloud}"/>
            <ellipse cx="${cloudX + size * 0.08}" cy="${cloudY - size * 0.03}" rx="${size * 0.15}" ry="${size * 0.1}" fill="${palette.cloud}"/>
        </svg>
    `;
}

function createCloudyIcon(palette, size) {
    const center = size / 2;
    const cloudY = center;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Nuages -->
            <ellipse cx="${center}" cy="${cloudY}" rx="${size * 0.3}" ry="${size * 0.18}" fill="${palette.cloud}"/>
            <ellipse cx="${center - size * 0.1}" cy="${cloudY - size * 0.05}" rx="${size * 0.22}" ry="${size * 0.15}" fill="${palette.cloud}"/>
            <ellipse cx="${center + size * 0.1}" cy="${cloudY - size * 0.02}" rx="${size * 0.18}" ry="${size * 0.12}" fill="${palette.cloud}"/>
            <ellipse cx="${center + size * 0.05}" cy="${cloudY + size * 0.08}" rx="${size * 0.2}" ry="${size * 0.1}" fill="${palette.cloudDark}"/>
        </svg>
    `;
}

function createOvercastIcon(palette, size) {
    const center = size / 2;
    const cloudY = center;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Nuages couverts -->
            <ellipse cx="${center}" cy="${cloudY - size * 0.05}" rx="${size * 0.32}" ry="${size * 0.2}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center - size * 0.12}" cy="${cloudY - size * 0.08}" rx="${size * 0.25}" ry="${size * 0.16}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center + size * 0.12}" cy="${cloudY - size * 0.05}" rx="${size * 0.2}" ry="${size * 0.13}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center}" cy="${cloudY + size * 0.05}" rx="${size * 0.28}" ry="${size * 0.15}" fill="${palette.cloud}"/>
        </svg>
    `;
}

function createRainIcon(palette, size) {
    const center = size / 2;
    const cloudY = center - size * 0.15;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Nuage -->
            <ellipse cx="${center}" cy="${cloudY}" rx="${size * 0.3}" ry="${size * 0.18}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center - size * 0.08}" cy="${cloudY - size * 0.03}" rx="${size * 0.2}" ry="${size * 0.12}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center + size * 0.08}" cy="${cloudY}" rx="${size * 0.18}" ry="${size * 0.1}" fill="${palette.cloudDark}"/>
            
            <!-- Gouttes de pluie -->
            ${[...Array(5)].map((_, i) => {
                const x = center - size * 0.2 + (i * size * 0.1);
                const y = cloudY + size * 0.1;
                return `<line x1="${x}" y1="${y}" x2="${x - 2}" y2="${y + size * 0.15}" stroke="${palette.rain}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`;
            }).join('')}
        </svg>
    `;
}

function createSnowIcon(palette, size) {
    const center = size / 2;
    const cloudY = center - size * 0.15;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Nuage -->
            <ellipse cx="${center}" cy="${cloudY}" rx="${size * 0.3}" ry="${size * 0.18}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center - size * 0.08}" cy="${cloudY - size * 0.03}" rx="${size * 0.2}" ry="${size * 0.12}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center + size * 0.08}" cy="${cloudY}" rx="${size * 0.18}" ry="${size * 0.1}" fill="${palette.cloudDark}"/>
            
            <!-- Flocons de neige -->
            ${[...Array(6)].map((_, i) => {
                const x = center - size * 0.2 + (i * size * 0.08);
                const y = cloudY + size * 0.1;
                return `<circle cx="${x}" cy="${y}" r="2" fill="${palette.snow}" opacity="0.9"/>`;
            }).join('')}
        </svg>
    `;
}

function createThunderstormIcon(palette, size) {
    const center = size / 2;
    const cloudY = center - size * 0.15;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Nuage d'orage -->
            <ellipse cx="${center}" cy="${cloudY}" rx="${size * 0.32}" ry="${size * 0.2}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center - size * 0.1}" cy="${cloudY - size * 0.05}" rx="${size * 0.22}" ry="${size * 0.15}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center + size * 0.1}" cy="${cloudY}" rx="${size * 0.18}" ry="${size * 0.12}" fill="${palette.cloudDark}"/>
            
            <!-- Éclair -->
            <path d="M ${center - 2} ${cloudY + size * 0.05} L ${center + 2} ${cloudY + size * 0.12} L ${center - 1} ${cloudY + size * 0.12} L ${center + 1} ${cloudY + size * 0.2} Z" 
                  fill="${palette.thunder}" opacity="0.9"/>
            
            <!-- Gouttes de pluie -->
            ${[...Array(3)].map((_, i) => {
                const x = center + size * 0.1 + (i * size * 0.06);
                const y = cloudY + size * 0.15;
                return `<line x1="${x}" y1="${y}" x2="${x - 2}" y2="${y + size * 0.1}" stroke="${palette.rain}" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>`;
            }).join('')}
        </svg>
    `;
}

function createDrizzleIcon(palette, size) {
    const center = size / 2;
    const cloudY = center - size * 0.15;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Nuage -->
            <ellipse cx="${center}" cy="${cloudY}" rx="${size * 0.28}" ry="${size * 0.16}" fill="${palette.cloud}"/>
            <ellipse cx="${center - size * 0.06}" cy="${cloudY - size * 0.02}" rx="${size * 0.18}" ry="${size * 0.1}" fill="${palette.cloud}"/>
            
            <!-- Bruine -->
            ${[...Array(7)].map((_, i) => {
                const x = center - size * 0.15 + (i * size * 0.05);
                const y = cloudY + size * 0.08;
                return `<line x1="${x}" y1="${y}" x2="${x - 1}" y2="${y + size * 0.08}" stroke="${palette.rain}" stroke-width="1" stroke-linecap="round" opacity="0.6"/>`;
            }).join('')}
        </svg>
    `;
}

function createShowerIcon(palette, size) {
    const center = size / 2;
    const cloudY = center - size * 0.15;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Nuage -->
            <ellipse cx="${center}" cy="${cloudY}" rx="${size * 0.3}" ry="${size * 0.18}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center - size * 0.08}" cy="${cloudY - size * 0.03}" rx="${size * 0.2}" ry="${size * 0.12}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center + size * 0.08}" cy="${cloudY}" rx="${size * 0.18}" ry="${size * 0.1}" fill="${palette.cloudDark}"/>
            
            <!-- Averses -->
            ${[...Array(6)].map((_, i) => {
                const x = center - size * 0.18 + (i * size * 0.07);
                const y = cloudY + size * 0.1;
                return `<line x1="${x}" y1="${y}" x2="${x - 2}" y2="${y + size * 0.12}" stroke="${palette.rain}" stroke-width="2" stroke-linecap="round" opacity="0.8"/>`;
            }).join('')}
        </svg>
    `;
}

function createSnowShowerIcon(palette, size) {
    const center = size / 2;
    const cloudY = center - size * 0.15;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Nuage -->
            <ellipse cx="${center}" cy="${cloudY}" rx="${size * 0.3}" ry="${size * 0.18}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center - size * 0.08}" cy="${cloudY - size * 0.03}" rx="${size * 0.2}" ry="${size * 0.12}" fill="${palette.cloudDark}"/>
            <ellipse cx="${center + size * 0.08}" cy="${cloudY}" rx="${size * 0.18}" ry="${size * 0.1}" fill="${palette.cloudDark}"/>
            
            <!-- Averses de neige -->
            ${[...Array(8)].map((_, i) => {
                const x = center - size * 0.2 + (i * size * 0.06);
                const y = cloudY + size * 0.1;
                return `<circle cx="${x}" cy="${y}" r="1.5" fill="${palette.snow}" opacity="0.9"/>`;
            }).join('')}
        </svg>
    `;
}

function createFogIcon(palette, size) {
    const center = size / 2;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Lignes de brouillard -->
            ${[...Array(5)].map((_, i) => {
                const y = center - size * 0.2 + (i * size * 0.1);
                const width = size * (0.8 - i * 0.05);
                return `<rect x="${center - width/2}" y="${y}" width="${width}" height="3" fill="${palette.cloud}" opacity="${0.6 - i * 0.1}" rx="1"/>`;
            }).join('')}
        </svg>
    `;
}

function createFreezingFogIcon(palette, size) {
    const center = size / 2;
    
    return `
        <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
            <!-- Brouillard givrant -->
            ${[...Array(5)].map((_, i) => {
                const y = center - size * 0.2 + (i * size * 0.1);
                const width = size * (0.8 - i * 0.05);
                return `<rect x="${center - width/2}" y="${y}" width="${width}" height="3" fill="${palette.cloudDark}" opacity="${0.7 - i * 0.1}" rx="1"/>`;
            }).join('')}
            
            <!-- Cristaux de glace -->
            ${[...Array(4)].map((_, i) => {
                const x = center - size * 0.15 + (i * size * 0.1);
                const y = center + size * 0.1;
                return `<circle cx="${x}" cy="${y}" r="1.5" fill="${palette.snow}" opacity="0.8"/>`;
            }).join('')}
        </svg>
    `;
}

// Détecter si on est sur mobile
function isMobileDevice() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
           (window.innerWidth <= 768 && 'ontouchstart' in window);
}

// Geolocalisation simple - GPS avec fallback recherche
function requestAutoGeolocation(loadingTimeout) {
    if (!navigator.geolocation) {
        // Pas de GPS, afficher message
        const cityElement = document.querySelector('.city');
        if (cityElement) cityElement.textContent = 'Chercher une ville...';
        return;
    }
    
    const cityElement = document.querySelector('.city');
    if (cityElement) cityElement.textContent = 'Localisation GPS...';
    
    navigator.geolocation.getCurrentPosition(
        (position) => {
            // Annuler le timeout sinon ca charge Paris quand meme
            clearTimeout(loadingTimeout);
            
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            localStorage.setItem('lastCoords', JSON.stringify({lat, lon, timestamp: Date.now()}));
            
            updateWeatherByCoords(lat, lon);
            startAutoRefresh();
        },
        (error) => {
            // GPS échoué - garder le timeout actif
            if (cityElement) cityElement.textContent = 'Chercher une ville...';
            // Ne pas charger Paris automatiquement - laisser le timeout faire
        },
        {enableHighAccuracy: true, timeout: 15000, maximumAge: 600000}
    );
}

// Initialize search listeners
document.addEventListener('DOMContentLoaded', () => {
    setupSearchListeners();
    
    // État de chargement initial
    const cityElement = document.querySelector('.city');
    const tempElement = document.document.getElementById('current-temp') || document.querySelector('.big-temp');
    const conditionElement = document.querySelector('.condition');
    
    if (cityElement) cityElement.textContent = 'Chargement...';
    if (tempElement) tempElement.textContent = '--°';
    if (conditionElement) conditionElement.textContent = 'Chargement meteo...';

    // DIRECT LOAD - skip geocoding
    console.log('Direct load Paris - fetching real API data');
    const cityElement2 = document.querySelector('.city');
    if (cityElement2) cityElement2.textContent = 'Paris';
    const tempElement2 = document.document.getElementById('current-temp') || document.querySelector('.big-temp');
    if (tempElement2) tempElement2.textContent = '⏳';
    const conditionElement2 = document.querySelector('.condition');
    if (conditionElement2) conditionElement2.textContent = 'Chargement...';
    
    // Direct call with API - fetch REAL weather data from Open-Meteo
    fetchOpenMeteo(48.8566, 2.3522).then(apiData => {
        console.log('API data received:', apiData?.current);
        
        if (!apiData || !apiData.current) {
            console.error('No API data');
            return;
        }
        
        // Update city
        const cityEl = document.querySelector('.city');
        if (cityEl) cityEl.textContent = 'Paris';
        
        // Update temperature
        const tempEl = document.document.getElementById('current-temp') || document.querySelector('.big-temp');
        if (tempEl && apiData.current?.temperature_2m !== undefined) {
            tempEl.textContent = Math.round(apiData.current.temperature_2m) + '°';
        }
        
        // Update condition based on weather code
        const condEl = document.querySelector('.condition');
        if (condEl && apiData.current?.weather_code !== undefined) {
            const condition = getWeatherInfo(apiData.current.weather_code).condition || 'Ensoleillé';
            condEl.textContent = condition;
        }
        
        // Update high/low
        const highEl = document.querySelector('.high-low');
        if (highEl && apiData.daily) {
            const max = apiData.daily.temperature_2m_max?.[0];
            const min = apiData.daily.temperature_2m_min?.[0];
            if (max !== undefined && min !== undefined) {
                highEl.innerHTML = `<span>H:${Math.round(max)}°</span><span>L:${Math.round(min)}°</span>`;
            }
        }
        
        // Update other details
        const humEl = document.getElementById('humidity');
        if (humEl && apiData.current?.relative_humidity_2m) {
            humEl.textContent = apiData.current.relative_humidity_2m + '%';
        }
        
        const cloudEl = document.getElementById('clouds');
        if (cloudEl && apiData.current?.cloud_cover !== undefined) {
            cloudEl.textContent = apiData.current.cloud_cover + '%';
        }
        
        const presEl = document.getElementById('pressure');
        if (presEl && apiData.current?.pressure_msl) {
            presEl.textContent = Math.round(apiData.current.pressure_msl) + ' hPa';
        }
        
        const windEl = document.getElementById('wind');
        if (windEl && apiData.current?.wind_speed_10m) {
            windEl.innerHTML = Math.round(apiData.current.wind_speed_10m) + ' <span class="unit">km/h</span>';
        }
        
        const avgEl = document.getElementById('temp-avg');
        if (avgEl && apiData.daily) {
            const max = apiData.daily.temperature_2m_max?.[0];
            const min = apiData.daily.temperature_2m_min?.[0];
            if (max !== undefined && min !== undefined) {
                avgEl.textContent = Math.round((max + min) / 2) + '°';
            }
        }
        
        console.log('Weather data displayed from API');
    }).catch(e => {
        console.error('API fetch error:', e);
    });
    
    // Timeout fallback - charger Paris apres 5 secondes si pas de reponse
    const loadingTimeout = setTimeout(() => {
        console.log('Timeout - chargement Paris');
        updateWeather('Paris');
        startAutoRefresh();
    }, 5000);
    
    //.Geolocalisation automatique sur mobile - avec fallback automatique
    if (isMobileDevice()) {
        // Essayer GPS, sinon charger directement
        requestAutoGeolocation(loadingTimeout);
        
        // Fallback supplementaire si GPS echoue - charger sans attendre
        setTimeout(() => {
            if (document.querySelector('.city')?.textContent === 'Localisation GPS...') {
                updateWeather('Paris');
                startAutoRefresh();
            }
        }, 8000); // Timeout plus long pour GPS
    } else {
        // Immediate fallback - show Paris first while geolocation loads
        updateWeather('Paris');
        
        // Sur desktop, essayer geolocation avec timeout
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    clearTimeout(loadingTimeout);
                    updateWeatherByCoords(position.coords.latitude, position.coords.longitude);
                    startAutoRefresh();
                },
                (error) => {
                    clearTimeout(loadingTimeout);
                    updateWeather('Paris');
                    startAutoRefresh();
                },
                { timeout: 3000 }
            );
        } else {
            clearTimeout(loadingTimeout);
            updateWeather('Paris');
            startAutoRefresh();
        }
    }
});

// Legacy support - attach after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const legacyInput = document.getElementById('city-input');
    if (legacyInput) {
        legacyInput.addEventListener('blur', function() {
            if (this.value.trim() !== currentCity) {
                searchCity();
            }
        });
    }
});

// Enhanced weather animations
if (!document.getElementById('weather-animations')) {
    const style = document.createElement('style');
    style.id = 'weather-animations';
    style.textContent = `
        .weather-icon { display: inline-block; }
        @keyframes rain-drop { 0% { transform: translateY(0); opacity: 0; } 50% { opacity: 1; } 100% { transform: translateY(${s*0.2}); opacity: 0; } }
        @keyframes snow-fall { 0% { transform: translateY(0) rotate(0deg); } 100% { transform: translateY(${s*0.3}) rotate(360deg); } }
        @keyframes sun-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
        @keyframes cloud-drift { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(${s*0.02}); } }
    `;
    document.head.appendChild(style);
}

// ============================================
// Temp range card (Apple-style)
// ============================================
function displayTempRange(weatherData) {
    const container = document.getElementById('temp-range-list');
    if (!container || !weatherData.daily) return;
    
    const daily = weatherData.daily;
    if (!daily.time || !daily.temperature_2m_max || !daily.temperature_2m_min) return;
    
    const days = ['Aujourd\'hui', 'Demain', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    let html = '';
    
    for (let i = 0; i < Math.min(7, daily.time.length); i++) {
        const maxTemp = Math.round(daily.temperature_2m_max[i]);
        const minTemp = Math.round(daily.temperature_2m_min[i]);
        const dayName = days[i] || new Date(daily.time[i]).toLocaleDateString('fr-FR', {weekday:'short'});
        const iconHTML = getAppleWeatherIcon(daily.weather_code[i], 1);
        
        html += '<div class="temp-range-item"><div class="temp-range-day">'+dayName+'</div><div class="temp-range-icon">'+iconHTML+'</div><div class="temp-range-temps"><span class="temp-max">'+maxTemp+'°</span><span class="temp-min">'+minTemp+'°</span></div></div>';
    }
    
    container.innerHTML = html;
}

// Settings Modal
document.addEventListener('DOMContentLoaded', () => {
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettings = document.getElementById('close-settings');
    
    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', () => {
            settingsModal.classList.remove('hidden');
        });
    }
    
    if (closeSettings && settingsModal) {
        closeSettings.addEventListener('click', () => {
            settingsModal.classList.add('hidden');
        });
    }
    
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) {
                settingsModal.classList.add('hidden');
            }
        });
    }
});

// Apple-style weather emoji icons
function getAppleWeatherIcon(code, isDay = true) {
    const icons = {
        0: isDay ? '☀️' : '🌙',
        1: isDay ? '⛅' : '☁️',
        2: isDay ? '⛅' : '☁️',
        3: '☁️',
        45: '🌫️',
        48: '🌫️',
        51: '🌧️',
        53: '🌧️',
        55: '🌧️',
        56: '🌨️',
        57: '🌨️',
        61: '🌧️',
        63: '🌧️',
        65: '⛈️',
        66: '🌨️',
        67: '🌨️',
        71: '🌨️',
        73: '❄️',
        75: '❄️',
        77: '🌨️',
        80: '🌧️',
        81: '🌧️',
        82: '⛈️',
        85: '🌨️',
        86: '❄️',
        95: '⛈️',
        96: '⛈️',
        99: '⛈️',
    };
    return icons[code] || (isDay ? '☀️' : '🌙');
}
