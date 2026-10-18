with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    lines = f.read().split('\n')
new_lines = []
for i, line in enumerate(lines):
    if 'await speak(reply);' in line:
        # Check if inside an async function by scanning backward for function definition
        inside_async = False
        for j in range(i-1, max(i-50, -1), -1):
            stripped = lines[j].strip()
            if stripped.startswith('async def ') or stripped.startswith('def '):
                inside_async = True
                break
            if stripped == '' and j < i-10:
                # likely outside if too far from definition
                pass
        if not inside_async:
            continue  # drop orphan await
    new_lines.append(line)
with open('app.js','w',encoding='utf-8') as f:
    f.write('\n'.join(new_lines))
print('Cleaned orphan awaits')
