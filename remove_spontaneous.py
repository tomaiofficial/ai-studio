with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
# Remove spontaneous AI messages at startup / autonomous mode
content = content.replace("toastMsg('🌌 Astra (toute seule) : ' + pensee);", "")
content = content.replace("toastMsg('🌟 ' + recit);", "")
with open('app.js','w',encoding='utf-8') as f:
    f.write(content)
print('Spontaneous AI messages removed')
