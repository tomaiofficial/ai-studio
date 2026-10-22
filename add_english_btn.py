with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
old = '<button class="icon-btn" id="visionBtn" title="Vision caméra" aria-label="Vision">📷</button>'
new = '<button class="icon-btn" id="visionBtn" title="Vision caméra" aria-label="Vision">📷</button><button class="icon-btn" id="englishBtn" title="Apprendre l\'anglais" aria-label="Anglais">🇬🇧</button>'
content = content.replace(old, new)
with open('index.html','w',encoding='utf-8') as f:
    f.write(content)
print('English button added')
