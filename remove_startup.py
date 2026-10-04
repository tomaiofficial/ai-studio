with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
content = content.replace("console.log('[APP] v' + APP_VERSION + ' loading...');", "")
content = content.replace("console.log('[Astra] Module de vie autonome actif.');", "")
content = content.replace("console.log('[Astra] Module web + autocorrection + verite autres  actif.');", "")
with open('app.js','w',encoding='utf-8') as f:
    f.write(content)
print('Startup messages removed')
