import pathlib

root = pathlib.Path('frontend')
changed = []
for path in root.glob('*.html'):
    text = path.read_text(encoding='utf-8')
    new = text.replace('`n', '\n')
    if new != text:
        path.write_text(new, encoding='utf-8')
        changed.append(str(path))
print('fixed', len(changed))
for f in changed:
    print('-', f)
