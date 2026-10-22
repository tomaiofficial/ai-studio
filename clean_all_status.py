with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
lines = content.split('\n')
for i in range(len(lines)):
    if 'setStatus' in lines[i] and 'Astra' in lines[i]:
        lines[i] = lines[i].replace('Astra : ', '').replace('Astra :', '').replace('Astra', '')
with open('app.js','w',encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('Cleaned all status lines')
