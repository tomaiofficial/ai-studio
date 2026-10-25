#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import io

FILE = "C:/Users/tomg-/ai-studio-repo/app.js"
with io.open(FILE, "rb") as f:
    data = f.read()

v10_idx = data.find(b"/* v10.27")
if v10_idx < 0:
    print("NOT FOUND")
    exit(1)

arr_idx = data.find(b"Array.from(ttsVoiceSel.options)", v10_idx)
if arr_idx < 0:
    print("NOT FOUND: Array.from")
    exit(1)

region_start = v10_idx
region_end = arr_idx
broken = data[region_start:region_end]
print("Broken region:")
print(broken.decode("utf-8", errors="replace"))

new_region = (
    b"  /* v10.27 : VOIX SYST\xc3\xa9ME RETIR\xc3\xa9ES du s\xe9lecteur \u2014 la lecture syst\xe8me reste\r\n"
    b"  branch\xc3\xa9e UNIQUEMENT comme secours silencieux automatique dans speak(). */\r\n"
    b"  Array.from(ttsVoiceSel.options).forEach(o => {\r\n"
    b"    if (o.value === 'systeme' || o.value.indexOf('system:') === 0 || o.value.indexOf('kokoro:') === 0 || o.value.indexOf('puter:') === 0) o.remove();\r\n"
    b"  });\r\n"
    b"  /* v12.0 : VOIX PIPER (Mozilla TTS, ultra-rapide ~2s, franc) \u00e7ais) */\r\n"
    b"  {\r\n"
    b"    const grpP = document.createElement('optgroup');\r\n"
    b"    grpP.label = 'Piper - voix vocale rapide (~2s, systeme)';\r\n"
    b"    const optP = document.createElement('option');\r\n"
    b"    optP.value = 'piper';\r\n"
    b"    optP.textContent = 'Piper - voix fran\xc3\xa9aise rapide (gratuite, instantan\xc3\xa9e)';\r\n"
    b"    grpP.appendChild(optP);\r\n"
    b"    ttsVoiceSel.appendChild(grpP);\r\n"
    b"  }\r\n"
    b"  Array.from(ttsVoiceSel.options).forEach(o => {"
)

new_data = data[:region_start] + new_region + data[arr_idx:]
with io.open(FILE, "wb") as f:
    f.write(new_data)
print("PATCHED")
