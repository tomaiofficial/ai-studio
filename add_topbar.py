with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
if '<header' not in content:
    content = content.replace('<div class="shell">', '<header style="position:sticky;top:0;z-index:12;padding:14px 18px;background:rgba(18,16,42,.55);backdrop-filter:blur(14px);border-bottom:1px solid rgba(124,92,255,.16);display:flex;align-items:center;justify-content:space-between;"><h1 style="font-size:18px;font-weight:700;color:#fff;">Assistant IA</h1><div style="display:flex;gap:8px;"><a class="icon-btn" href="debat.html" title="Débat">🎙️</a><button class="icon-btn" id="historyBtn" title="Historique">📜</button><button class="icon-btn" id="settingsBtn" title="Réglages">⚙️</button></div></header>\n<div class="shell">')
    with open('index.html','w',encoding='utf-8') as f:
        f.write(content)
    print('Topbar added')
else:
    print('Already present')
