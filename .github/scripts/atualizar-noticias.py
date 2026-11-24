import json
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from xml.etree import ElementTree

FEED = "https://agenciabrasil.ebc.com.br/rss/esportes/feed.xml"
MAX_BYTES = 2_000_000


def read_articles(payload):
    articles = []
    seen = set()
    for item in ElementTree.fromstring(payload).findall("./channel/item"):
        title = " ".join(item.findtext("title", "").split())
        url = item.findtext("link", "").strip()
        link = urlsplit(url)
        if link.scheme == "http":
            link = link._replace(scheme="https")
            url = link.geturl()
        if (not title or url in seen or link.scheme != "https"
                or link.netloc != "agenciabrasil.ebc.com.br"
                or not link.path.startswith("/esportes/noticia/")):
            continue
        try:
            date = parsedate_to_datetime(item.findtext("pubDate", "")).isoformat()
        except (TypeError, ValueError):
            date = None
        seen.add(url)
        articles.append({"title": title, "url": url, "publishedAt": date})
        if len(articles) == 6:
            break
    return articles


def main():
    request = Request(FEED, headers={"User-Agent": "Arena-Esportiva-RSS/1.0"})
    with urlopen(request, timeout=25) as response:
        payload = response.read(MAX_BYTES + 1)
    if len(payload) > MAX_BYTES:
        raise ValueError("RSS excedeu o limite de tamanho")
    articles = read_articles(payload)
    if not articles:
        raise ValueError("O RSS não retornou manchetes de esporte")
    output = {"updatedAt": datetime.now(timezone.utc).isoformat(), "articles": articles}
    Path(sys.argv[1]).write_text(json.dumps(output, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
