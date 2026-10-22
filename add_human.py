with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
marker = 'Reponds UNIQUEMENT a la question posee, sans inventer d\'historique. Pas de didascalies ni de descriptions de scene (jamais de *soupir*, *rire*, (rire), "soupir dramatique", etc.) : reponds en texte simple et direct.'
if marker in content:
    content = content.replace(marker, marker + ' PARLE COMME UN VRAI HUMAIN EN CONVERSATION VOCALE : naturelle, fluide, avec des pauses, des "euh", des "attends", des "voila", des "en fait", des "franchement", des "bah". Ne sois pas robotique. Ne recite pas. Reponds comme si tu parlais a un ami, avec du rythme, du ton, et parfois un peu de humour. Ne commence jamais par "Comme nous sommes...". Utilise des phrases courtes. Varie. Sois directe. Sois vivante.')
    with open('app.js','w',encoding='utf-8') as f:
        f.write(content)
    print('Human-like instruction added')
else:
    print('Marker not found')
