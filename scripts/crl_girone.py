#!/usr/bin/env python3
"""Classifica e risultati di Prima Categoria girone A (più le gare di Coppa
Lombardia Prima Categoria delle squadre del girone), ricavati dai testi dei
comunicati CRL salvati da crl_cache.py.

Il file prodotto (public/data/girone.json) è cumulativo: i risultati già
presenti restano anche quando i comunicati escono dalla cache, così lo
storico copre tutta la stagione. La scheda Avversari dell'app lo usa per
compilare da sola classifica e ultime partite di ogni squadra del girone.

Uso: python3 scripts/crl_girone.py <cartella-cache> <girone.json>
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

COMPETITION = "Prima Categoria"
GIRONE = "A"
COPPA = "Coppa Lombardia"

HEADING_RE = re.compile(
    r"^(ECCELLENZA|PROMOZIONE|PRIMA CATEGORIA|SECONDA CATEGORIA|TERZA CATEGORIA|COPPA |REGIONALE |"
    r"JUNIORES|UNDER |ALLIEVI|GIOVANISSIMI|ESORDIENTI|PULCINI|CALCIO A ?5|CALCIO FEMMINILE|SERIE |"
    r"FEMMINILE|ATTIVITA)[A-Z0-9 .'/-]*$")
STOP_RE = re.compile(r"^\s*(GIUDICE SPORTIVO|CLASSIFICA|VARIAZIONI AL PROGRAMMA GARE|PROGRAMMA GARE)\s*$")
GARE_DEL_RE = re.compile(r"GARE\s+DEL\s+(\d{1,2})/(\d{1,2})/(\d{4})", re.I)
BLOCK_RE = re.compile(r"GIRONE\s+([A-Z0-9]+)\s*-\s*(\d+)\s*Giornata\s*-\s*([AR])", re.I)
NAME = r"[A-Z0-9][^\s]*(?: {1,2}[^\s]+)*?"
RESULT_RE = re.compile(r"(?:\((\d+)\)\s*)?(" + NAME + r")\s+-\s+(" + NAME + r")\s+(\d{1,2})\s*-\s*(\d{1,2})(?=\s{2,}|\s*$)")
NOTE_RE = re.compile(r"\((\d+)\)\s*-\s*disputata\s+il\s+(\d{1,2})/(\d{1,2})/(\d{4})", re.I)
ROW_RE = re.compile(r"^\s*(\S.*?)\s{2,}(-?\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s*$")

GENERIC = set("asd ssd ssdarl ssdrl srl arl rl ac acd as us usd gs gsd fc sc ss cs pol pold polisportiva calcio "
              "sport sportiva societa football club academy di del della de".split())


def tokens(name):
    # «U.S.», «A.S.D.» sono sigle: si tolgono i punti prima di spezzare il nome.
    return [t for t in re.split(r"[^a-z0-9]+", name.lower().replace(".", ""))
            if len(t) > 1 and t not in GENERIC]


def similarity(a, b):
    ta, tb = tokens(a), set(tokens(b))
    if not ta or not tb:
        return 0
    return sum(t in tb for t in ta) / min(len(ta), len(tb))


def iso(d, m, y):
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


def heading_of(line):
    s = line.strip()
    if len(s) > 45 or "..." in s or not s.isupper():
        return None
    return s if HEADING_RE.match(s) else None


def parse_standing(lines):
    """Righe della classifica di Prima Categoria girone A, se il testo la contiene."""
    cat = None
    for i, line in enumerate(lines):
        h = heading_of(line)
        if h:
            cat = h
            continue
        if cat != COMPETITION.upper() or line.strip() != f"GIRONE {GIRONE}":
            continue
        head = next((j for j in range(i + 1, min(i + 4, len(lines)))
                     if "PT" in lines[j] and "GF" in lines[j]), None)
        if head is None:
            continue
        rows = []
        for row in lines[head + 1:]:
            m = ROW_RE.match(row)
            if not m:
                if rows:
                    break
                continue
            team, pts, g, v, n, p, gf, gs, _dr, pe = m.groups()
            rows.append({"pos": len(rows) + 1, "team": team.strip(), "pts": int(pts), "g": int(g),
                         "v": int(v), "n": int(n), "p": int(p), "gf": int(gf), "gs": int(gs), "pe": int(pe)})
        if len(rows) >= 6:
            return rows
    return None


def parse_results(lines):
    """Tutti i risultati di Prima Categoria e Coppa Lombardia Prima Categoria del testo."""
    out, cat, day = [], None, None
    i = 0
    while i < len(lines):
        line = lines[i]
        h = heading_of(line)
        if h:
            cat = h
        m = GARE_DEL_RE.search(line)
        if m:
            day = iso(*m.groups())
        labels = list(BLOCK_RE.finditer(line))
        is_pc = cat == COMPETITION.upper()
        is_coppa = bool(cat and cat.startswith("COPPA LOMBARDIA PRIMA"))
        if not labels or not (is_pc or is_coppa):
            i += 1
            continue
        # Una o due colonne di gironi affiancate: la seconda inizia più a destra.
        split = labels[1].start() * 0.6 if len(labels) > 1 else None
        col = lambda pos: 1 if split is not None and pos >= split else 0  # noqa: E731
        found, notes = [], {}
        j = i + 1
        while j < len(lines):
            row = lines[j]
            if BLOCK_RE.search(row) or heading_of(row) or STOP_RE.match(row) or GARE_DEL_RE.search(row):
                break
            for n in NOTE_RE.finditer(row):
                notes[(col(n.start()), n.group(1))] = iso(*n.group(2, 3, 4))
            for r in RESULT_RE.finditer(row):
                found.append((col(r.start()), r))
            j += 1
        for c, r in found:
            lab = labels[min(c, len(labels) - 1)]
            mark, home, away, hg, ag = r.groups()
            out.append({
                "competition": COMPETITION if is_pc else COPPA,
                "girone": lab.group(1).upper(), "round": int(lab.group(2)), "leg": lab.group(3).upper(),
                "date": notes.get((c, mark)) if mark else day,
                "home": home.strip(), "away": away.strip(), "hg": int(hg), "ag": int(ag),
            })
        i = j
    return out


def main():
    cache_dir, out_path = sys.argv[1], sys.argv[2]
    with open(os.path.join(cache_dir, "index.json"), encoding="utf-8") as f:
        docs = json.load(f)["docs"]
    data = {}
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            data = json.load(f)

    standing = data.get("standing")
    results = {(r["competition"], r["girone"], r["round"], r["leg"], r["home"], r["away"]): r
               for r in data.get("results", [])}
    order = sorted(docs.values(), key=lambda d: (d.get("date") or "", d.get("number") or 0))
    for doc in order:
        if doc.get("kind") != "comunicato":
            continue
        label = f"Comunicato Ufficiale n. {doc.get('number')}" if doc.get("number") else doc.get("title")
        for f in doc.get("files", []):
            if not f.get("txt"):
                continue
            with open(os.path.join(cache_dir, f["txt"]), encoding="utf-8") as fh:
                lines = fh.read().splitlines()
            rows = parse_standing(lines)
            key = (doc.get("date") or "", doc.get("number") or 0, sum(r["g"] for r in rows or []))
            old = standing or {}
            if rows and key >= (old.get("date") or "", old.get("number") or 0, sum(r["g"] for r in old.get("rows", []))):
                d = doc.get("date") or ""
                standing = {"asOf": f"{label} del {d[8:10]}/{d[5:7]}/{d[:4]}" if d else label,
                            "date": d, "number": doc.get("number"), "url": doc["url"], "rows": rows}
            for r in parse_results(lines):
                r["date"] = r["date"] or doc.get("date")
                r["source"] = label
                r["url"] = doc["url"]
                results[(r["competition"], r["girone"], r["round"], r["leg"], r["home"], r["away"])] = r

    if not standing:
        raise SystemExit("Classifica di Prima Categoria girone A non trovata nei comunicati in cache")
    teams = [r["team"] for r in standing["rows"]]
    # Per la Coppa serve lo stesso nome (sigle a parte): «Villa» non è «Villa D'Adda».
    team_sets = [set(tokens(t)) for t in teams]
    in_girone = lambda name: set(tokens(name)) in team_sets  # noqa: E731
    kept = [r for r in results.values()
            if (r["competition"] == COMPETITION and r["girone"] == GIRONE)
            or (r["competition"] == COPPA and (in_girone(r["home"]) or in_girone(r["away"])))]
    kept.sort(key=lambda r: (r["date"] or "", r["competition"], r["home"]))

    new = {"competition": f"{COMPETITION} girone {GIRONE}", "season": "2026/2027",
           "standing": standing, "results": kept}
    if {k: v for k, v in data.items() if k != "generatedAt"} == new:
        print("girone.json: nessuna novità")
        return
    new = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), **new}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"girone.json: classifica {standing['asOf']}, {len(kept)} risultati")


if __name__ == "__main__":
    main()
