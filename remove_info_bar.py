with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
old = '<div style="padding:8px 18px;background:rgba(124,92,255,.1);text-align:center;font-size:14px;color:#fff;">TikTok : <a href="https://www.tiktok.com/@tom.ai.official" target="_blank" style="color:#fff;text-decoration:underline;">@tom.ai.official</a> — Astra par Tom AI</div>\n\n<div class="shell">'
new = '<div class="shell">'
content = content.replace(old, new)
with open('index.html','w',encoding='utf-8') as f:
    f.write(content)
print('Info bar removed')
