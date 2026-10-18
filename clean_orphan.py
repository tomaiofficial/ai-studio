with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    lines = f.read().split('\n')
for i in range(len(lines)):
    if i >= 3410 and i <= 3420 and 'await speak(reply);' in lines[i] and 'const gamesPanel' not in lines[i]:
        lines[i] = ''
with open('app.js','w',encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('cleaned orphan await')
