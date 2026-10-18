with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    lines = f.read().split('\n')
for i in range(len(lines)):
    if 'await speak(reply);' in lines[i]:
        # Check if inside async function by looking backward for def
        inside = False
        for j in range(i-1, max(i-30, -1), -1):
            stripped = lines[j].strip()
            if stripped.startswith('def ') or stripped.startswith('async def '):
                inside = True
                break
        if not inside:
            lines[i] = ''
with open('app.js','w',encoding='utf-8') as f:
    f.write('\n'.join(lines))
print('Cleaned orphan awaits')
