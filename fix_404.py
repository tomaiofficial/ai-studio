with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
content = content.replace('<link rel="manifest" href="manifest.webmanifest">\n', '')
content = content.replace('<link rel="icon" href="icon-192.png">\n', '')
with open('index.html','w',encoding='utf-8') as f:
    f.write(content)
print('Removed manifest/icon links')
