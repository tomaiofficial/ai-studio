with open('index.html','r',encoding='utf-8',errors='ignore') as f:
    content = f.read()
start = content.find('<nav class="rail"')
if start != -1:
    end = content.find('</nav>', start)
    if end != -1:
        content = content[:start] + content[end+6:]
        with open('index.html','w',encoding='utf-8') as f:
            f.write(content)
        print('Rail removed')
else:
    print('No rail sidebar')
