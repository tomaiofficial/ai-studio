with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
old = "  if (isProcessing) return;"
new = "  if (isProcessing) return;\n  /* v10.28 : autonomie locale uniquement si active dans Reglages */\n  const autonomyEnabled = (typeof localStorage !== 'undefined' && localStorage.getItem('va_autonomy') === '1');"
content = content.replace(old, new, 1)
with open('app.js','w',encoding='utf-8') as f:
    f.write(content)
print('Autonomy guard added')
