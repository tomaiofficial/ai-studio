with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    lines = f.read().split('\n')
# Remove orphan await at line 3428 (0-indexed 3427) if present
for i in range(len(lines)):
    if i == 3427 and 'await speak(reply);' in lines[i]:
        lines[i] = ''
with open('app.js','w',encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('cleaned orphan await at 3428')
