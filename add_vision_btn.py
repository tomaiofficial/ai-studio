with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
content = content.replace('<button class="icon-btn" id="historyBtn" title="Historique" aria-label="Historique">📜</button>', '<button class="icon-btn" id="visionBtn" title="Vision caméra" aria-label="Vision">📷</button><button class="icon-btn" id="historyBtn" title="Historique" aria-label="Historique">📜</button>')
with open('index.html','w',encoding='utf-8') as f:
    f.write(content)
print('Vision button added')
