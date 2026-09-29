async function meteoFor(city){
  const ville = String(city || '').trim().toLowerCase();
  if (!ville) return '';
  let pageUrl = '';
  try {
    const s = await fetch('https://www.lachainemeteo.com/ajax/search-autocomplete?q=' + encodeURIComponent(ville), { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    if (s.ok){
      const html = await s.text();
      const m = html.match(/data-url=\\u0022(.*?)\\u0022/);
      if (m) pageUrl = m[1].replace(/\\u002F/g, '/').replace(/\\\//g, '/');
    }
  } catch(e){}
  console.log('pageUrl:', pageUrl || 'fallback France');
  if (!pageUrl) pageUrl = 'https://www.lachainemeteo.com/meteo-france/previsions-meteo-france-aujourdhui';
  try {
    const r = await fetch('https://r.jina.ai/' + pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (r.ok){
      const txt = await r.text();
      const todayM = txt.match(/Aujourd'hui\s*à[^.]{0,200}\.\s*Les températures[^.]{0,150}\./i)
        || txt.match(/Aujourd'hui\s*à[^.]{0,250}\./i)
        || txt.match(/Aujourd hui\s*à[^.]{0,250}\./i);
      let desc = todayM ? todayM[0].replace(/\s+/g, ' ').trim() : '';
      desc = desc.replace(/\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]/g, '$1').replace(/\s{2,}/g, ' ').trim();
      const tRange = desc.match(/entre\s*([+-]?\d{1,2})\s*et\s*([+-]?\d{1,2})\s*°C/i);
      if (tRange){
        const out = 'Meteo a ' + (city || 'ta ville') + ' (source La Chaine Meteo) : ' + desc;
        console.log('OUT:', out.slice(0, 600));
        return;
      }
      const temps = txt.match(/[+-]?\d{1,2}\s*°C/g) || [];
      const uniq = [...new Set(temps.map(t => t.replace(/\s+/g, '')))].slice(0, 6);
      if (uniq.length){
        let out = 'Meteo a ' + (city || 'ta ville') + ' (source La Chaine Meteo) : temperatures ' + uniq.join(', ') + '.';
        if (desc) out += ' ' + desc;
        console.log('OUT:', out.slice(0, 600));
        return;
      }
    }
  } catch(e){ console.log('ERR jina', e.message); }
  console.log('FALLBACK open-meteo');
}
meteoFor('paris');