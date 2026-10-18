with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
content = content.replace('<h1 style="font-size:18px;font-weight:700;color:#fff;">Assistant IA — Tom AI</h1>', '<h1 style="font-size:18px;font-weight:700;color:#fff;">Assistant IA</h1>')
with open('index.html','w',encoding='utf-8') as f:
    f.write(content)
print('Header cleaned')
