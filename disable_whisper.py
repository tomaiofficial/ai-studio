with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
content = content.replace('loadWhisper();', '/* loadWhisper(); */ /* v10.28 : disabled to avoid SharedArrayBuffer warning */')
with open('app.js','w',encoding='utf-8') as f:
    f.write(content)
print('Whisper preload disabled')
