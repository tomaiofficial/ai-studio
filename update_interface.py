#!/usr/bin/env python3
"""Update the interface for a cleaner, more professional design."""

with open('static/index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Replace the CSS for a cleaner, more modern interface
old_css_start = content.find('body{')
old_css_end = content.find('/* ===== FOND FÉERIQUE', content.find('body{'))

new_css = """body{
  font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;-moz-osx-smoothing:grayscale;
  text-rendering:optimizeLegibility;
  background:linear-gradient(160deg,#0a0a14 0%,#12102a 50%,#0a0a14 100%);
  color:#e8e8f0;
  display:flex;flex-direction:column;
  overflow:hidden;text-size-adjust:100%;
}
/* ===== HEADER SUPERPOSÉ (haut à droite) ===== */
.top-bar{position:fixed;top:0;left:0;right:0;z-index:200;display:flex;align-items:center;
  justify-content:flex-end;padding:12px 18px;
  background:rgba(10,10,18,.7);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  border-bottom:1px solid rgba(124,92,255,.12)}
.top-bar .icon-btn{flex-shrink:0;font-size:18px;width:42px;height:42px;border-radius:12px;
  background:rgba(124,92,255,.1);border:1px solid rgba(124,92,255,.2);color:#e8e8f0;
  cursor:pointer;transition:all .15s ease}
.top-bar .icon-btn:hover{background:rgba(124,92,255,.25);color:#fff;border-color:rgba(124,92,255,.4)}
.top-bar .icon-btn:active{transform:scale(.92)}

/* ===== DESIGN PRINCIPAL ===== */
.shell{position:relative;flex:1;display:flex;align-items:stretch;min-height:0;width:100%;padding:80px 20px 20px 20px}

/* ===== CENTRE DE PARLE ===== */
.voice-stage{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;min-height:0}

/* ===== STATUT ===== */
.status{font-size:15px;color:#9a9ab5;text-align:center;padding:12px;letter-spacing:.5px}

/* ===== ORB ===== */
.mic-btn{width:240px;height:240px;border-radius:50%;border:none;cursor:pointer;position:relative;
  overflow:hidden;background:#0d0d10;box-shadow:0 0 60px rgba(124,92,255,.4),0 0 140px rgba(255,92,168,.18)}
.mic-btn:active{transform:scale(.92)}
.mic-btn::before{content:'';position:absolute;inset:-30%;background:conic-gradient(from 0deg,#7c5cff,#ff5ca8,#ff9f2e,#ff5ca8);animation:spin 8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.mic-btn .orb-icon{font-size:48px;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)}

/* ===== BOUTONS HABILLÉS ===== */
.equipped{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:20px;width:100%}
.equipped .icon-btn{flex-shrink:0;width:52px;height:52px;border-radius:14px;
  background:rgba(124,92,255,.12);border:1px solid rgba(124,92,255,.25);color:#e8e8f0;
  font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:all .15s ease;box-shadow:0 4px 16px rgba(124,92,255,.2)}
.equipped .icon-btn:hover{background:rgba(124,92,255,.25);transform:translateY(-3px);color:#fff}
.equipped .icon-btn:active{transform:scale(.9)}

/* ===== SOUS-TITRE ===== */
.subtitle{font-size:12px;color:#3cdca0;font-weight:600;padding:6px 0;text-align:center;
  line-height:1.35;display:block;width:100%;margin:8px auto 0;max-width:400px}

/* ===== STOP BOUTON ===== */
.stop-btn{width:50px;height:50px;border-radius:50%;border:1px solid rgba(124,92,255,.35);
  background:rgba(124,92,255,.15);color:#fff;font-size:18px;cursor:pointer;
  display:none;align-items:center;justify-content:center;flex-shrink:0;
  box-shadow:0 0 20px rgba(124,92,255,.25);margin-top:12px}
.stop-btn.show{display:flex}

/* ===== VERSION TAG ===== */
.version-tag{font-size:10px;color:#5a5a75;text-align:center;padding:4px}

/* ===== QUOTA HUD ===== */
.quota-hud{position:fixed;bottom:20px;right:20px;z-index:100}
.quota-pill{display:flex;align-items:center;gap:8px;background:rgba(124,92,255,.12);
  border:1px solid rgba(124,92,255,.25);border-radius:14px;padding:10px 14px;
  cursor:pointer;font-size:13px;color:#e8e8f0;transition:all .15s ease}
.quota-pill:hover{background:rgba(124,92,255,.2);color:#fff}
.quota-pill span{font-size:16px}
.quota-pill b{font-weight:700}
.quota-bar{flex:1;height:6px;background:rgba(124,92,255,.2);border-radius:3px;overflow:hidden}
.quota-fill{height:100%;background:linear-gradient(90deg,#7c5cff,#4f8bf5);border-radius:3px;transition:width .5s ease}
.quota-detail{display:none;background:rgba(18,16,42,.85);border:1px solid rgba(124,92,255,.3);
  border-radius:14px;padding:16px;width:320px;box-shadow:0 8px 32px rgba(0,0,0,.4)}
.quota-detail.show{display:block}
.quota-detail h5{font-size:14px;color:#ffc107;margin-bottom:12px}
.qrow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(124,92,255,.1)}
.qrow:last-child{border-bottom:0}
.qrow span:first-child{font-size:12px;color:#6a6a7e}
.qrow span:last-child{font-size:13px;color:#e8e8f0;font-weight:600}

/* ===== BOUTONS MODAL ===== */
.modal{position:fixed;inset:0;z-index:300;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;
  backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
.modal[hidden]{display:none}
.modal-card{position:relative;background:#12102a;border:1px solid rgba(124,92,255,.25);
  border-radius:20px;padding:24px;max-width:520px;width:100%;max-height:85vh;overflow-y:auto;
  box-shadow:0 20px 60px rgba(0,0,0,.5)}
.modal-close{position:absolute;top:12px;right:14px;width:32px;height:32px;border-radius:50%;
  background:rgba(255,255,255,.07);border:1px solid rgba(124,92,255,.16);color:#9a9ab5;
  font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.modal-close:hover{background:rgba(124,92,255,.2);color:#fff}
.settings-title{font-size:16px;color:#ffc107;margin:16px 0 8px 0;font-weight:700}
.muted{color:#6a6a7e;font-size:13px;line-height:1.6}
.primary{background:linear-gradient(135deg,#7c5cff,#4f8bf5);color:#fff;border:none;
  border-radius:12px;padding:12px 20px;font-size:14px;font-weight:600;cursor:pointer;display:block;
  width:100%;margin-top:12px;transition:all .15s ease}
.primary:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(124,92,255,.4)}
"""

# Replace the old CSS
old_css = content[old_css_start:old_css_end]
content = content.replace(old_css, new_css)

# 2. Add the top bar HTML after the settingsBtn
old_btn = '      <button class="icon-btn" id="settingsBtn" title="Réglages" aria-label="Réglages">⚙️</button>'
new_btn = '''      <div class="top-bar">
        <button class="icon-btn" id="settingsBtn" title="Paramètres" aria-label="Paramètres">⚙️</button>
        <button class="icon-btn" id="historyBtn" title="Historique" aria-label="Historique">📋</button>
        <button class="icon-btn" id="aboutBtn" title="À propos d\\'Astra" aria-label="À propos">ℹ️</button>
      </div>'''
content = content.replace(old_btn, new_btn)

# 3. Add the equipped buttons area after the mic button
old_mic = '''      <button class="mic-btn" id="orb" role="button" aria-label="Parler">
        <span class="orb-waves"></span>
        <span class="orb-icon" id="orbIcon">🎙️</span>
      </button>'''
new_mic = '''      <button class="mic-btn" id="orb" role="button" aria-label="Parler">
        <span class="orb-icon" id="orbIcon">🎙️</span>
      </button>
      <div class="equipped">
        <button class="icon-btn" id="historyBtn" title="Historique" aria-label="Historique">📋</button>
        <button class="icon-btn" id="aboutBtn" title="À propos d\\'Astra" aria-label="À propos">ℹ️</button>
        <button class="icon-btn" id="mathBtn" title="Calculatrice" aria-label="Calculatrice">🧮</button>
        <button class="icon-btn" id="notesBtn" title="Bloc-notes" aria-label="Bloc-notes">📝</button>
      </div>'''
content = content.replace(old_mic, new_mic)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("Interface updated successfully")
