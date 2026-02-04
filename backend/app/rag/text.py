import re

def strip_html(html: str) -> str:
    # POC-quality HTML stripping (good enough)
    text = re.sub(r"<script.*?>.*?</script>", " ", html, flags=re.S|re.I)
    text = re.sub(r"<style.*?>.*?</style>", " ", text, flags=re.S|re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

def chunk_text(text: str, max_chars: int = 1400, overlap: int = 150) -> list[str]:
    text = text.strip()
    if not text:
        return []
    out = []
    i = 0
    while i < len(text):
        j = min(len(text), i + max_chars)
        out.append(text[i:j])
        i = max(0, j - overlap)
        if j == len(text):
            break
    return out
