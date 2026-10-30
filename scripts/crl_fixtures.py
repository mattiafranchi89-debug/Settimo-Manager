#!/usr/bin/env python3
"""Prossime partite del Settimo Milanese (Prima Categoria girone A e Coppa
Lombardia Prima Categoria) dai «Programma gare» del CRL salvati da
crl_cache.py: data, ora d'inizio, campo, località e indirizzo ufficiali.

Il file prodotto (public/data/fixtures.json) è cumulativo: una gara già
presente resta finché è recente, e si aggiorna quando un programma gare
pubblicato dopo ne cambia data, ora o campo. L'app lo usa per allineare
l'orario delle partite in calendario.

Uso: python3 scripts/crl_fixtures.py <cartella-cache> <fixtures.json>
"""

import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

TEAM = {"settimo", "milanese"}
KEEP_DAYS = 30

# «CAMPIONATO 1C PRIMA CATEGORIA», «CAMPIONATO K1 COPPA LOMBARDIA PRIMA CTG»
SECTION_RE = re.compile(r"^\s*CAMPIONATO\s+\S+\s+(.+?)\s*$")
GIRONE_RE = re.compile(r"^GIRONE\s+(\S+)\s")
ROW_RE = re.compile(
    r"^(?P<home>\S.*?)\s{2,}(?P<away>\S.*?)\s{2,}(?P<venue>\S.*?)\s{2,}"
    r"(?P<d>\d{1,2})/(?P<m>\d{1,2})/(?P<y>\d{4}|\d{2})\s+(?P<h>\d{1,2})[:.](?P<min>\d{2})\s+(?P<round>\d+\s*[AR]?)\s+(?P<rest>.*?)\s*$")
SECTIONS = {"PRIMA CATEGORIA": ("Prima Categoria", "A"), "COPPA LOMBARDIA PRIMA CTG": ("Coppa Lombardia", None)}
GENERIC = set("asd ssd ssdarl ssdrl srl arl rl ac acd as us usd gs gsd fc sc ss cs pol calcio".split())


def tokens(name):
    return {t for t in re.split(r"[^a-z0-9]+", name.lower().replace(".", "")) if len(t) > 1 and t not in GENERIC}


def is_us(name):
    # Solo la prima squadra: «SETTIMO MILANESE», non altre squadre con quel nome dentro.
    return tokens(name) == TEAM


def parse(lines):
    """Gare del Settimo nelle sezioni di Prima Categoria girone A e Coppa Lombardia Prima Categoria."""
    section = girone = None
    out = []
    for line in lines:
        m = SECTION_RE.match(line)
        if m and line.startswith(" "):
            section = SECTIONS.get(m.group(1).strip())
            girone = None
            continue
        m = GIRONE_RE.match(line)
        if m:
            girone = m.group(1)
            continue
        if not section or (section[1] and girone != section[1]):
            continue
        m = ROW_RE.match(line)
        if not m or not (is_us(m["home"]) or is_us(m["away"])):
            continue
        rest = [p for p in re.split(r"\s{2,}", m["rest"]) if p]
        status = rest.pop() if rest and re.fullmatch(r"[HKPV]", rest[-1]) else ""
        home = is_us(m["home"])
        out.append({
            "competition": section[0], "girone": girone, "round": m["round"].replace(" ", ""),
            "date": f"{int(m['y']) + (2000 if len(m['y']) == 2 else 0):04d}-{int(m['m']):02d}-{int(m['d']):02d}", "time": f"{int(m['h']):02d}:{m['min']}",
            "home": home, "opponent": (m["away"] if home else m["home"]).strip(),
            "venue": m["venue"].strip(), "city": rest[0] if rest else "", "address": rest[1] if len(rest) > 1 else "",
            "status": status
        })
    return out


def main():
    cache_dir, out_path = sys.argv[1], sys.argv[2]
    with open(os.path.join(cache_dir, "index.json"), encoding="utf-8") as f:
        docs = json.load(f)["docs"]
    data = {}
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            data = json.load(f)

    key = lambda g: (g["competition"], g["round"], " ".join(sorted(tokens(g["opponent"]))))  # noqa: E731
    fixtures = {key(g): g for g in data.get("fixtures", [])}
    order = sorted((d for d in docs.values() if d.get("kind") == "programma-gare"), key=lambda d: (d.get("date") or "", d["id"]))
    for doc in order:
        for f in doc.get("files", []):
            if not f.get("txt"):
                continue
            with open(os.path.join(cache_dir, f["txt"]), encoding="utf-8") as fh:
                games = parse(fh.read().splitlines())
            for g in games:
                old = fixtures.get(key(g))
                # Vince il programma pubblicato per ultimo: è lì che finiscono anticipi e posticipi.
                if old and (old.get("published") or "") > (doc.get("date") or ""):
                    continue
                d = doc.get("date") or ""
                fixtures[key(g)] = {**g, "published": d, "source": f"{doc.get('title') or 'Programma gare'}", "url": doc.get("url")}

    since = (date.today() - timedelta(days=KEEP_DAYS)).isoformat()
    kept = sorted((g for g in fixtures.values() if g["date"] >= since), key=lambda g: (g["date"], g["time"]))
    new = {"team": "SETTIMO MILANESE", "fixtures": kept}
    if {k: v for k, v in data.items() if k != "generatedAt"} == new:
        print("fixtures.json: nessuna novità")
        return
    new = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), **new}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"fixtures.json: {len(kept)} gare " + ", ".join(f"{g['date']} {g['time']} {g['opponent']}" for g in kept))


if __name__ == "__main__":
    main()
