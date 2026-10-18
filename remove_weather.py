from pathlib import Path

path = Path('app.js')
source = path.read_text(encoding='utf-8')
start = source.index('function showWeatherPanel(){')
end = source.index('/* Heure appareil', start)
source = source[:start] + source[end:]
start = source.index('async function meteoFor(city){')
end = source.index('/* OUTIL HEURE', start)
source = source[:start] + source[end:]
source = source.replace("  meteo:    { desc: 'meteo actuelle d une ville', run: q => meteoFor(q) },\n", '')
source = source.replace("  if (coordinates) { try { localStorage.setItem('va_weather_coordinates', JSON.stringify({ latitude: coordinates.latitude, longitude: coordinates.longitude, updatedAt: Date.now() })); } catch {} }\n", '')
path.write_text(source, encoding='utf-8')
print('Removed weather helpers and tool entry')
