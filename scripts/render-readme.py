"""Render the README and API/test guides' Markdown subset to self-contained offline HTML (stdlib only).

Supports headings, paragraphs, simple lists/tables, inline links/code/emphasis,
and fenced code. GitHub remains the full Markdown renderer for README.md.
"""
from pathlib import Path
import base64
import html
import re

root = Path(__file__).resolve().parents[1]


def link_target(value):
    return value if re.match(r'^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|#)', value) else '../' + value


def header_html(source):
    """Preserve the repository-authored HTML masthead and embed its local SVG."""
    def asset(match):
        path = (root / html.unescape(match[1])).resolve()
        if not path.is_relative_to(root) or path.suffix != '.svg':
            raise ValueError('README header images must be local SVG files')
        encoded = base64.b64encode(path.read_bytes()).decode('ascii')
        return 'src="data:image/svg+xml;base64,' + encoded + '"'

    source = re.sub(r'src="([^"]+)"', asset, source)
    source = re.sub(r'href="([^"]+)"', lambda m: 'href="' + html.escape(
        link_target(html.unescape(m[1])), quote=True) + '"', source)
    return source


def inline(source):
    saved = []

    def keep(value):
        saved.append(value)
        return f'\x00{len(saved)-1}\x00'

    text = re.sub(r'`([^`]+)`', lambda m: keep('<code>' + html.escape(m[1]) + '</code>'), source)
    text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', lambda m: keep(
        '<a href="' + html.escape(link_target(m[2]), quote=True)
        + '">' + re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', html.escape(m[1])) + '</a>'), text)
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    for i, value in enumerate(saved):
        text = text.replace(f'\x00{i}\x00', value)
    return text


for source, target, title, label in (
    ('README.md', 'readme.html', 'Shifter Proxy Extension — Residential & ISP Proxies for Chrome and Firefox', 'README'),
    ('shifter_docs/shifter-extension-api.md', 'api.html', 'Shifter Extension API Reference', 'API REFERENCE'),
    ('e2e/README.md', 'testing.html', 'Shifter Proxy Extension — Browser Tests', 'TEST GUIDE'),
):
    lines = (root / source).read_text().splitlines()
    out = []
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith(('<p align="center">', '<h1 align="center">')):
            block = []
            while i < len(lines) and lines[i].strip():
                block.append(lines[i])
                i += 1
            out.append(header_html('\n'.join(block)))
            continue
        if line.startswith('```'):
            block = []
            i += 1
            while i < len(lines) and not lines[i].startswith('```'):
                block.append(lines[i])
                i += 1
            out.append('<pre><code>' + html.escape('\n'.join(block)) + '</code></pre>')
            i += 1
            continue
        heading = re.match(r'^(#{1,6}) (.+)$', line)
        if heading:
            level = len(heading[1])
            anchor = re.sub(r'[^\w -]', '', heading[2].lower()).replace(' ', '-')
            out.append(f'<h{level} id="{anchor}">{inline(heading[2])}</h{level}>')
            i += 1
            continue
        if line.startswith('|'):
            rows = []
            while i < len(lines) and lines[i].startswith('|'):
                cells = [s.strip() for s in lines[i].strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?', cell) for cell in cells):
                    tag = 'th' if not rows else 'td'
                    rows.append('<tr>' + ''.join(f'<{tag}>{inline(cell)}</{tag}>' for cell in cells) + '</tr>')
                i += 1
            out.append('<div class="table"><table>' + ''.join(rows) + '</table></div>')
            continue
        item = re.match(r'^(?:- |\d+\. )(.+)$', line)
        if item:
            tag = 'ul' if line.startswith('- ') else 'ol'
            items = []
            while i < len(lines):
                item = re.match(r'^' + (r'- ' if tag == 'ul' else r'\d+\. ') + r'(.+)$', lines[i])
                if not item:
                    break
                items.append('<li>' + inline(item[1]) + '</li>')
                i += 1
            out.append(f'<{tag}>' + ''.join(items) + f'</{tag}>')
            continue
        paragraph = []
        while i < len(lines) and lines[i].strip():
            paragraph.append(lines[i])
            i += 1
        out.append('<p>' + inline(' '.join(paragraph)) + '</p>')

    style = """*{box-sizing:border-box}html{scroll-behavior:smooth;color-scheme:light}body{margin:0;background:#ffffff;color:#1f2328;font:16px/1.65 system-ui,-apple-system,sans-serif}header,main,footer{max-width:1040px;margin:auto;padding:26px 40px}header{color:#59636e;font-size:12px;letter-spacing:1.5px;font-weight:600;border-bottom:1px solid #d1d9e0}main{padding-top:20px}h1,h2,h3{color:#1f2328;line-height:1.3}h1{font-size:34px;letter-spacing:-.9px;margin:28px 0 16px}h2{margin-top:42px;padding-bottom:10px;border-bottom:1px solid #d1d9e0;font-size:24px}h3{margin-top:28px;font-size:19px}p{margin:16px 0}p[align=center]{text-align:center}p[align=center] img{display:block;width:100%;max-width:960px;height:auto;margin:0 auto}h1[align=center]{text-align:center}a{color:#0969da;text-underline-offset:3px;text-decoration:none}a:hover{text-decoration:underline}code{font:13px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere;background:#eff1f3;border-radius:4px;padding:2px 5px}pre{padding:20px;overflow:auto;background:#f6f8fa;border:1px solid #d1d9e0;border-radius:8px}pre code{white-space:pre;overflow-wrap:normal;padding:0;background:none}.table{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:12px 14px;border:1px solid #d1d9e0;text-align:left;vertical-align:top}th{background:#f6f8fa;color:#1f2328}tr:nth-child(even){background:#f6f8fa}li{margin:6px 0}footer{border-top:1px solid #d1d9e0;color:#59636e;font-size:13px}h2,h3{scroll-margin-top:18px}@media(max-width:650px){header,main,footer{padding:18px}h1{font-size:27px}table{min-width:540px}}@media print{html{color-scheme:light}body{background:white;color:#172235}header,main,footer{max-width:none;padding:12px}h1,h2,h3,th{color:#172235}h2,h3{break-after:avoid}pre,th,tr:nth-child(even){background:#f1f4f8}a{color:#1756a5}}"""
    page = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + html.escape(title) + '</title><meta name="description" content="Shifter browser proxy extension for Residential and ISP proxies. Chrome and Firefox setup, location targeting, sticky sessions, privacy, and development."><style>' + style + '</style></head><body><main>' + '\n'.join(out) + '</main></body></html>'
    (root / 'docs').mkdir(exist_ok=True)
    (root / 'docs' / target).write_text(page)
    print(f'Generated docs/{target}')
