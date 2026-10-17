#!/usr/bin/env python3
"""Scarica dal sito del Comitato Regionale Lombardia i comunicati ufficiali
e i programmi gare recenti e ne salva il testo nella cartella indicata.

Lo esegue la GitHub Action .github/workflows/crl-cache.yml, che pubblica il
risultato sul ramo `crl-cache`. I task programmati di Claude leggono da lì,
così non devono aprire crlombardia.it (e non chiedono permessi ogni volta).

Uso: python3 scripts/crl_cache.py <cartella-cache> [--backfill DA-A]
Con --backfill si recuperano anche i comunicati regionali più vecchi,
provando le pagine /documenti/<id> nell'intervallo di id indicato.
Solo libreria standard + `pdftotext` (poppler-utils).
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser

BASE = "https://www.crlombardia.it/"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/128.0 Safari/537.36")
KEEP_DAYS = 60          # documenti più vecchi vengono rimossi dalla cache
TEAM_RE = re.compile(r"SETTIMO\s+MILANESE", re.I)
CONTEXT_LINES = 3       # righe di contesto attorno a ogni menzione
MESI = {m: i for i, m in enumerate(
    "gennaio febbraio marzo aprile maggio giugno luglio agosto settembre "
    "ottobre novembre dicembre".split(), 1)}
DATE_RE = re.compile(r"(\d{1,2})\s+(" + "|".join(MESI) + r")\s+(\d{4})", re.I)


class Links(HTMLParser):
    """Raccoglie (href, testo) di ogni <a>, compreso il testo annidato."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self._stack = [], []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._stack.append([dict(attrs).get("href") or "", []])

    def handle_data(self, data):
        for item in self._stack:
            item[1].append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._stack:
            href, parts = self._stack.pop()
            self.links.append((href, " ".join(" ".join(parts).split())))


def get(url, tries=3):
    # Gli href contengono spazi e parentesi: codifica solo ciò che serve.
    url = urllib.parse.quote(url, safe=":/?&=%#()~+,;@!$'*-._")
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept-Language": "it-IT,it;q=0.9"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def links(html_bytes, base):
    p = Links()
    p.feed(html_bytes.decode("utf-8", "replace"))
    return [(urllib.parse.urljoin(base, h), t) for h, t in p.links if h]


def parse_date(text):
    m = DATE_RE.search(text or "")
    if not m:
        return None
    return date(int(m.group(3)), MESI[m.group(2).lower()], int(m.group(1))).isoformat()


def homepage_docs():
    """Comunicati ufficiali CRL e programmi gare elencati in home."""
    found = {}
    for url, text in links(get(BASE), BASE):
        m = re.match(r"https?://www\.crlombardia\.it/(documenti|news)/(\d+)/([^/?#]+)", url)
        if not m:
            continue
        section, doc_id, slug = m.groups()
        low = (text + " " + slug).lower().replace("-", " ")
        if section == "documenti" and "comunicato ufficiale" in low:
            kind = "comunicato"
        elif "programma gare" in low:
            kind = "programma-gare"
        else:
            continue
        if "delegazion" in low:  # solo comunicati regionali
            continue
        # la data compare attaccata all'inizio o alla fine del testo del link
        title = re.sub(r"^\s*" + DATE_RE.pattern + r"|" + DATE_RE.pattern + r"\s*$", "",
                       text, flags=re.I).strip() or slug
        num = re.search(r"n[°º]?\s*(\d+)", title, re.I) if kind == "comunicato" else None
        prev = found.get(doc_id, {})
        found[doc_id] = {
            "id": doc_id, "kind": kind, "title": prev.get("title") or title,
            "number": int(num.group(1)) if num else prev.get("number"),
            "date": prev.get("date") or parse_date(text),
            "url": f"{BASE}{section}/{doc_id}/{slug}",
        }
    return list(found.values())


def pdf_text(data):
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "f.pdf")
        with open(src, "wb") as f:
            f.write(data)
        out = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", src, "-"],
                             capture_output=True, check=True, timeout=180)
        return out.stdout.decode("utf-8", "replace")


def mentions(text):
    lines = text.splitlines()
    hits, last_end = [], -1
    for i, line in enumerate(lines):
        if TEAM_RE.search(line):
            start, end = max(0, i - CONTEXT_LINES), min(len(lines), i + CONTEXT_LINES + 1)
            if start <= last_end and hits:  # unisci blocchi sovrapposti
                hits[-1]["text"] += "\n" + "\n".join(lines[last_end:end])
            else:
                hits.append({"line": i + 1, "text": "\n".join(lines[start:end])})
            last_end = end
    return hits


def safe_name(name):
    name = re.sub(r"\.pdf$", "", name, flags=re.I)
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_")
    return (name or "allegato")[:90]


def is_main(kind, name):
    low = name.lower()
    return (kind == "programma-gare" or "comunicato ufficiale" in low
            or "classific" in low or "programma" in low or "risultat" in low)


def fetch_doc(doc, out_dir):
    page = get(doc["url"])
    doc_dir = os.path.join(out_dir, "docs", doc["id"])
    files, seen = [], set()
    for url, text in links(page, doc["url"]):
        if f"/storage/uploads/files/{doc['id']}/" not in url or url in seen:
            continue
        seen.add(url)
        name = text or urllib.parse.unquote(url.rsplit("/", 1)[-1].split("_", 1)[-1])
        entry = {"name": name, "url": url}
        try:
            data = get(url)
        except RuntimeError as e:
            entry["error"] = str(e)
            files.append(entry)
            continue
        if not data.startswith(b"%PDF"):
            entry["skipped"] = "non è un PDF"
            files.append(entry)
            continue
        text_pdf = pdf_text(data)
        hits = mentions(text_pdf)
        entry["pages_chars"] = len(text_pdf)
        entry["settimo_mentions"] = len(hits)
        if is_main(doc["kind"], name) or hits:
            os.makedirs(doc_dir, exist_ok=True)
            fname = safe_name(name) + ".txt"
            with open(os.path.join(doc_dir, fname), "w", encoding="utf-8") as f:
                f.write(text_pdf)
            entry["txt"] = f"docs/{doc['id']}/{fname}"
        if hits:
            entry["mentions"] = hits
        files.append(entry)
    return files


HEADER_RE = re.compile(r"Comunicato\s+Ufficiale\s+N\S*\s*(\d+)\s+del\s+(\d{1,2})/(\d{1,2})/(\d{4})", re.I)


def backfill_doc(doc_id, out_dir):
    """Comunicato regionale recuperato per id; None se la pagina non lo è."""
    url = f"{BASE}documenti/{doc_id}/x"
    try:
        html = get(url, tries=1).decode("utf-8", "replace")
    except RuntimeError:
        return None
    m = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    title = " ".join((m.group(1) if m else "").split())
    title = re.sub(r"^CRL\s*\|\s*", "", title)
    if "comunicato ufficiale" not in title.lower() or "delegazion" in title.lower():
        return None
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower().replace("°", "")).strip("-")
    num = re.search(r"n[°º]?\s*(\d+)", title, re.I)
    doc = {"id": str(doc_id), "kind": "comunicato", "title": title,
           "number": int(num.group(1)) if num else None, "date": None,
           "url": f"{BASE}documenti/{doc_id}/{slug}", "backfill": True}
    doc["files"] = fetch_doc(doc, out_dir)
    # Solo comunicati del Comitato Regionale: l'intestazione del PDF lo dice.
    main = next((f for f in doc["files"] if f.get("txt") and "comunicato ufficiale" in f["name"].lower()), None)
    head = ""
    if main:
        with open(os.path.join(out_dir, main["txt"]), encoding="utf-8") as f:
            head = "".join(f.readlines()[:45])
    h = HEADER_RE.search(head)
    if not main or "delegazion" in head.lower() or not h:
        shutil.rmtree(os.path.join(out_dir, "docs", str(doc_id)), ignore_errors=True)
        return None
    doc["date"] = date(int(h.group(4)), int(h.group(3)), int(h.group(2))).isoformat()
    return doc


def write_settimo_md(out_dir, docs):
    """Riepilogo leggibile: tutte le menzioni del Settimo, documento per documento."""
    rows = ["# Menzioni di SETTIMO MILANESE nei documenti CRL in cache", ""]
    for d in sorted(docs.values(), key=lambda x: (x.get("date") or "", x["id"]), reverse=True):
        rows.append(f"## {d['title']} ({d.get('date') or 'data n.d.'})")
        rows.append(f"Pagina: {d['url']}")
        any_hit = False
        for f in d.get("files", []):
            for h in f.get("mentions", []):
                any_hit = True
                rows += ["", f"### {f['name']} – riga {h['line']}", "```", h["text"], "```"]
        if not any_hit:
            rows.append("Nessuna menzione del Settimo Milanese." if d.get("files")
                        else "Allegati non ancora disponibili.")
        rows.append("")
    with open(os.path.join(out_dir, "settimo.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(rows))


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "crl-cache"
    os.makedirs(out_dir, exist_ok=True)
    idx_path = os.path.join(out_dir, "index.json")
    index = {"docs": {}}
    if os.path.exists(idx_path):
        with open(idx_path, encoding="utf-8") as f:
            index = json.load(f)
    docs = index.setdefault("docs", {})
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")

    listed = homepage_docs()
    if not listed:
        raise SystemExit("Nessun comunicato trovato in home: struttura del sito cambiata?")

    errors = []
    if "--backfill" in sys.argv:
        lo, hi = map(int, sys.argv[sys.argv.index("--backfill") + 1].split("-"))
        skipped = set(index.get("notRegional", []))
        for doc_id in range(lo, hi + 1):
            if str(doc_id) in docs or str(doc_id) in skipped or str(doc_id) in {d["id"] for d in listed}:
                continue
            time.sleep(0.4)
            try:
                doc = backfill_doc(doc_id, out_dir)
            except Exception as e:  # noqa: BLE001
                errors.append(f"backfill {doc_id}: {e}")
                continue
            if doc:
                doc["fetchedAt"] = now
                docs[doc["id"]] = doc
                print("Recuperato", doc["title"], doc["date"])
            else:
                skipped.add(str(doc_id))
        index["notRegional"] = sorted(skipped, key=int)[-2000:]

    for doc in listed:
        old = docs.get(doc["id"])
        if old and old.get("files"):
            continue  # già scaricato con allegati
        try:
            doc["files"] = fetch_doc(doc, out_dir)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{doc['url']}: {e}")
            continue
        doc["fetchedAt"] = now
        docs[doc["id"]] = doc

    cutoff = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    for doc_id in [k for k, v in docs.items() if (v.get("date") or "9999") < cutoff]:
        shutil.rmtree(os.path.join(out_dir, "docs", doc_id), ignore_errors=True)
        del docs[doc_id]

    index["source"] = BASE
    index["lastRun"] = now
    index["homepage"] = [d["id"] for d in listed]
    index["errors"] = errors
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=2)
        f.write("\n")
    write_settimo_md(out_dir, docs)
    print(f"In home: {len(listed)} documenti; in cache: {len(docs)}; errori: {len(errors)}")
    for e in errors:
        print("ERRORE", e)
    if errors and len(errors) == len(listed):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
