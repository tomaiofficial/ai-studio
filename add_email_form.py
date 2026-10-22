with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
form = '<form style="padding:10px 18px;background:rgba(124,92,255,.1);text-align:center;font-size:14px;color:#fff;" onsubmit="event.preventDefault(); alert(\'Inscrit ! Mises à jour Astra par email.\');"><label>Recevoir mises à jour Astra : <input type="email" placeholder="ton@email.com" style="padding:4px;border:none;border-radius:4px;" required></label> <button type="submit" style="padding:4px 8px;border:none;border-radius:4px;background:#7c5cff;color:#fff;">OK</button></form>'
content = content.replace('<div class="shell">', form + '\n<div class="shell">')
with open('index.html','w',encoding='utf-8') as f:
    f.write(content)
print('Form added')
