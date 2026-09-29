with open('app.js',encoding='utf-8',errors='ignore') as f: content=f.read()
funcs = "function learnFromUser(text){ try{ const vocab=JSON.parse(localStorage.getItem('astra_vocab')||'{}'); const words=(text||'').toLowerCase().match(/[a-zà-ÿ]{3,}/g)||[]; words.forEach(w=>{vocab[w]=(vocab[w]||0)+1}); localStorage.setItem('astra_vocab',JSON.stringify(vocab));}catch(e){} }\nfunction buildUserProfile(){ try{ const vocab=JSON.parse(localStorage.getItem('astra_vocab')||'{}'); const top=Object.entries(vocab).sort((a,b)=>b[1]-a[1]).slice(0,20).map(x=>x[0]).join(', '); return top?'Tu parles souvent de : '+top+'. Adapte ton ton et tes sujets a cela.':'';}catch(e){return '';} }\n"
content = content.replace('/* ============================================================', funcs + '/* ============================================================')
with open('app.js','w',encoding='utf-8') as f: f.write(content)
print('insere')
