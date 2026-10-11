with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
if '<link rel="icon"' not in content:
    content = content.replace('<title>Assistant IA</title>', '<title>Assistant IA</title>\n<link rel="icon" href="icon-192.png" type="image/png">')
    with open('index.html','w',encoding='utf-8') as f:
        f.write(content)
    print('Favicon link restored')
else:
    print('Favicon link present')
