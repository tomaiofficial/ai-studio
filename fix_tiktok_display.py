with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
content = content.replace('<a class="icon-btn" href="https://www.tiktok.com/@tom.ai.official" target="_blank" title="TikTok @tom.ai.official">🎵</a>', '')
content = content.replace('<div class="shell">', '<div style="padding:8px 18px;background:rgba(124,92,255,.1);text-align:center;font-size:14px;color:#fff;">TikTok : <a href="https://www.tiktok.com/@tom.ai.official" target="_blank" style="color:#fff;text-decoration:underline;">@tom.ai.official</a> — Astra par Tom AI</div>\n<div class="shell">')
with open('index.html','w',encoding='utf-8') as f:
    f.write(content)
print('Done')
