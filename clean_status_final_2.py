with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
content = content.replace("setStatus('Astra : Appuie sur le micro et parle')", "setStatus('Appuie sur le micro et parle')")
with open('app.js','w',encoding='utf-8') as f:
    f.write(content)
print('Status cleaned')
