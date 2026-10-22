with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
marker = 'PARLE COMME UN VRAI HUMAIN EN CONVERSATION VOCALE'
if marker in content:
    content = content.replace(marker, marker + ' ; si tu dois dire un mot anglais, prononce-le naturellement en francais (ex: "hello" -> "allo" si contexte, sinon prononce clairement sans couper).')
    with open('app.js','w',encoding='utf-8') as f:
        f.write(content)
    print('Pronunciation instruction added')
else:
    print('Marker not found')
