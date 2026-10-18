with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
old = "  if (localRecipePrompt(question)) {\n    const reply = await askAI(question);\n    if (reply) {\n      addAiMsg(reply, 'local');\n      await speak(reply);\n      isProcessing = false;\n      manualStop = false;\n      maybeRestartListening();\n    }\n    return;\n  }\n"
if old in content:
    content = content.replace(old, '')
    with open('app.js','w',encoding='utf-8') as f:
        f.write(content)
    print('Fixed missing localRecipePrompt call')
else:
    print('Pattern not found; checking line 3415')
