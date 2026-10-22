with open('app.js','r',encoding='utf-8',errors='ignore') as f:
    for i,line in enumerate(f):
        if 'await speak' in line:
            print(i+1, line[:120])
