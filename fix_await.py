with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    lines = f.read().split('\n')
for i in range(len(lines)):
    if i >= 3430 and i <= 3440 and 'addAiMsg(lesson' in lines[i]:
        lines.insert(i+1, '    await speak(lesson);')
        break
with open('app.js','w',encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('restored await speak(lesson)')
