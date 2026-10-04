with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
old = '<button class="icon-btn" id="settingsBtn" title="Réglages" aria-label="Réglages">⚙️</button>'
new = '<button class="icon-btn" id="settingsBtn" title="Réglages" aria-label="Réglages">⚙️</button><a class="icon-btn" href="https://www.tiktok.com/@tom.ai.official" target="_blank" title="TikTok @tom.ai.official">🎵</a>'
content = content.replace(old, new)
with open('index.html','w',encoding='utf-8') as f:
    f.write(content)
print('TikTok link added')
