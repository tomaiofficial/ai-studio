with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
content = content.replace("setStatus('Astra : ", "setStatus('")
with open('app.js','w',encoding='utf-8') as f:
    f.write(content)
print('Status cleaned')
