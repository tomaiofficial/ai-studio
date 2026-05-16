// Apple-style Weather Icons (SF Symbols style)
// Usage: getWeatherIcon(code, isDay, size)

(function() {
    'use strict';
    
    const iconPaths = {
        clear: {
            day: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sunG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#FFD700;stop-opacity:1"/><stop offset="100%" style="stop-color:#FFA500;stop-opacity:1"/></linearGradient></defs><circle cx="32" cy="32" r="14" fill="url(#sunG)"/><g stroke="url(#sunG)" stroke-width="3" stroke-linecap="round"><line x1="32" y1="6" x2="32" y2="12"/><line x1="32" y1="52" x2="32" y2="58"/><line x1="6" y1="32" x2="12" y2="32"/><line x1="52" y1="32" x2="58" y2="32"/><line x1="13.6" y1="13.6" x2="17.8" y2="17.8"/><line x1="46.2" y1="46.2" x2="50.4" y2="50.4"/><line x1="13.6" y1="50.4" x2="17.8" y2="46.2"/><line x1="46.2" y1="17.8" x2="50.4" y2="13.6"/></g></svg>',
            night: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="moonG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#F5F5F5;stop-opacity:1"/><stop offset="100%" style="stop-color:#E8E8E8;stop-opacity:1"/></linearGradient></defs><path d="M 42 14 A 18 18 0 1 0 42 50 A 14 14 0 1 1 42 14" fill="url(#moonG)"/></svg>'
        },
        partlyCloudy: {
            day: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sunG2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#FFD700;stop-opacity:1"/><stop offset="100%" style="stop-color:#FFA500;stop-opacity:1"/></linearGradient><linearGradient id="cloudG" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#FFFFFF;stop-opacity:1"/><stop offset="100%" style="stop-color:#E0E0E0;stop-opacity:1"/></linearGradient></defs><circle cx="40" cy="28" r="10" fill="url(#sunG2)"/><g stroke="url(#sunG2)" stroke-width="2.5" stroke-linecap="round"><line x1="40" y1="10" x2="40" y2="14"/><line x1="54.1" y1="17.9" x2="56.9" y2="20.7"/><line x1="54.1" y1="38.1" x2="56.9" y2="35.3"/></g><path d="M 48 44 A 8 8 0 0 1 48 28 L 52 28 A 10 10 0 0 1 52 48 L 24 48 A 8 8 0 0 1 24 32 L 28 32 A 6 6 0 0 1 28 20 L 34 20 A 8 8 0 0 1 48 24 Z" fill="url(#cloudG)" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"/></svg>',
            night: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="moonG2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#F5F5F5;stop-opacity:1"/><stop offset="100%" style="stop-color:#E8E8E8;stop-opacity:1"/></linearGradient><linearGradient id="cloudG2" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#FFFFFF;stop-opacity:1"/><stop offset="100%" style="stop-color:#E0E0E0;stop-opacity:1"/></linearGradient></defs><path d="M 38 22 A 12 12 0 1 0 38 46 A 10 10 0 1 1 38 22" fill="url(#moonG2)"/><path d="M 44 46 A 6 6 0 0 1 44 34 L 47 34 A 8 8 0 0 1 47 50 L 20 50 A 6 6 0 0 1 20 38 L 23 38 A 5 5 0 0 1 23 30 L 28 30 A 6 6 0 0 1 44 36 Z" fill="url(#cloudG2)" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.1))"/></svg>'
        },
        cloudy: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="cloudG3" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#F0F0F0;stop-opacity:1"/><stop offset="100%" style="stop-color:#C0C0C0;stop-opacity:1"/></linearGradient></defs><path d="M 48 44 A 10 10 0 0 1 48 24 L 54 24 A 12 12 0 0 1 54 48 L 20 48 A 10 10 0 0 1 20 28 L 26 28 A 8 8 0 0 1 26 12 L 36 12 A 10 10 0 0 1 48 24 Z" fill="url(#cloudG3)" filter="drop-shadow(0 3px 6px rgba(0,0,0,0.15))"/></svg>',
        rain: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="rainC" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#A0A0A0;stop-opacity:1"/><stop offset="100%" style="stop-color:#707070;stop-opacity:1"/></linearGradient><linearGradient id="rainD" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#6BB6FF;stop-opacity:1"/><stop offset="100%" style="stop-color:#3B82F6;stop-opacity:1"/></linearGradient></defs><path d="M 46 38 A 8 8 0 0 1 46 22 L 51 22 A 10 10 0 0 1 51 42 L 18 42 A 8 8 0 0 1 18 26 L 23 26 A 6 6 0 0 1 23 14 L 31 14 A 8 8 0 0 1 46 26 Z" fill="url(#rainC)" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.2))"/><g stroke="url(#rainD)" stroke-width="2" stroke-linecap="round"><line x1="24" y1="46" x2="22" y2="54"/><line x1="32" y1="46" x2="30" y2="54"/><line x1="40" y1="46" x2="38" y2="54"/></g></svg>',
        storm: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="stormC" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#5A5A5A;stop-opacity:1"/><stop offset="100%" style="stop-color:#3A3A3A;stop-opacity:1"/></linearGradient><linearGradient id="lightning" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#FFE135;stop-opacity:1"/><stop offset="100%" style="stop-color:#FFA500;stop-opacity:1"/></linearGradient></defs><path d="M 46 36 A 8 8 0 0 1 46 20 L 51 20 A 10 10 0 0 1 51 40 L 18 40 A 8 8 0 0 1 18 24 L 23 24 A 6 6 0 0 1 23 12 L 31 12 A 8 8 0 0 1 46 24 Z" fill="url(#stormC)" filter="drop-shadow(0 3px 6px rgba(0,0,0,0.3))"/><path d="M 34 42 L 28 52 L 32 52 L 30 60 L 38 48 L 34 48 Z" fill="url(#lightning)" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.3))"/></svg>',
        snow: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="snowC" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#E8E8E8;stop-opacity:1"/><stop offset="100%" style="stop-color:#C0C0C0;stop-opacity:1"/></linearGradient></defs><path d="M 46 38 A 8 8 0 0 1 46 22 L 51 22 A 10 10 0 0 1 51 42 L 18 42 A 8 8 0 0 1 18 26 L 23 26 A 6 6 0 0 1 23 14 L 31 14 A 8 8 0 0 1 46 26 Z" fill="url(#snowC)" filter="drop-shadow(0 2px 4px rgba(0,0,0,0.15))"/><g fill="#FFFFFF" stroke="#E0E0E0" stroke-width="0.5"><circle cx="24" cy="50" r="3"/><circle cx="32" cy="52" r="3"/><circle cx="40" cy="50" r="3"/><circle cx="28" cy="58" r="2.5"/><circle cx="36" cy="58" r="2.5"/></g></svg>',
        fog: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="fogG" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#D0D0D0;stop-opacity:1"/><stop offset="100%" style="stop-color:#A0A0A0;stop-opacity:1"/></linearGradient></defs><g fill="url(#fogG)" opacity="0.8"><rect x="12" y="24" width="40" height="6" rx="3"/><rect x="16" y="34" width="32" height="6" rx="3"/><rect x="14" y="44" width="36" height="6" rx="3"/></g></svg>',
        wind: '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="windG" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:#A0C4FF;stop-opacity:1"/><stop offset="100%" style="stop-color:#6B9BFF;stop-opacity:1"/></linearGradient></defs><g stroke="url(#windG)" stroke-width="4" stroke-linecap="round" fill="none"><path d="M 12 28 Q 28 28 34 24 Q 40 20 52 24"/><path d="M 12 38 Q 30 38 38 34 Q 46 30 52 34"/><path d="M 12 48 Q 26 48 32 46"/></g></svg>'
    };
    
    const wmoIconMap = {
        0: 'clear', 1: 'partlyCloudy', 2: 'partlyCloudy', 3: 'cloudy',
        45: 'fog', 48: 'fog',
        51: 'rain', 53: 'rain', 55: 'rain', 56: 'rain', 57: 'rain',
        61: 'rain', 63: 'rain', 65: 'rain', 66: 'rain', 67: 'rain',
        71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
        80: 'rain', 81: 'rain', 82: 'storm',
        85: 'snow', 86: 'snow',
        95: 'storm', 96: 'storm', 99: 'storm'
    };
    
    window.getWeatherIcon = function(code, isDay, size) {
        const c = Number(code || 0);
        let iconName = wmoIconMap[c] || 'clear';
        let iconData;
        if (typeof iconPaths[iconName] === 'string') {
            iconData = iconPaths[iconName];
        } else if (iconPaths[iconName]) {
            iconData = isDay ? iconPaths[iconName].day : iconPaths[iconName].night;
        } else {
            iconData = isDay ? iconPaths.clear.day : iconPaths.clear.night;
        }
        if (!iconData) iconData = iconPaths.clear.day;
        return '<div class="weather-icon-container" style="width:' + size + 'px;height:' + size + 'px;display:flex;align-items:center;justify-content:center;">' + iconData + '</div>';
    };
})();
