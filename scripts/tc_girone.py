#!/usr/bin/env python3
"""Risultati e classifica provvisori di Prima Categoria girone A dai widget
ufficiali di Tuttocampo, la domenica sera, prima che escano i comunicati.

Legge i due widget pubblici (gli stessi che il sito offre da incorporare):
la classifica e i risultati della giornata in corso e di quella prima. I nomi
delle squadre si riportano a quelli dei comunicati; se anche una sola squadra
non si abbina, non si scrive nulla (meglio niente che dati sbagliati).

In public/data/girone.json:
- i risultati entrano con "provisional": true e la fonte Tuttocampo, solo
  per le partite che i comunicati non hanno ancora;
- la classifica va in "standingProvisional" solo se è più avanti di quella
  ufficiale.
Quando arrivano i comunicati, crl_girone.py tiene i risultati ufficiali,
toglie i provvisori e annota in "corrections" quelli che erano diversi.

Uso: python3 scripts/tc_girone.py <girone.json> [--files classifica.html risultati.html ...]
"""

import importlib.util
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
from html import unescape

HERE = os.path.dirname(os.path.abspath(__file__))
_spec = importlib.util.spec_from_file_location("crl_girone", os.path.join(HERE, "crl_girone.py"))
crl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(crl)

WIDGET_ID = os.environ.get("TC_WIDGET_ID", "bc1d2cc7-2af1-4ed3-bf50-b4c12bf0afaa")
BASE = "https://www.tuttocampo.it/WidgetV2"
PAGE = "https://www.tuttocampo.it/Lombardia/MI/PrimaCategoria/GironeA"
UA = "SettimoManager/1.0 (+https://github.com/mattiafranchi89-debug/Settimo-Manager)"
ROUNDS_PER_LEG = 15
MONTHS = {m: i + 1 for i, m in enumerate("gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre".split())}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "it-IT,it;q=0.9"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def text(s):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def parse_standing(html):
    rows = []
    for tr in re.findall(r'(?s)<tr class="[^"]*">\s*<td class="last_match".*?</tr>', html):
        cell = lambda c: text(re.search(r'(?s)<td class="%s">(.*?)</td>' % c, tr).group(1))  # noqa: E731
        try:
            team = text(re.search(r'(?s)<td class="team">(.*?)</td>', tr).group(1))
            nums = [int(cell(c)) for c in ("points pt", "pg", "vt", "pa", "sc", "gf", "gs")]
        except (AttributeError, ValueError):
            continue
        pts, g, v, n, p, gf, gs = nums
        rows.append({"pos": len(rows) + 1, "team": team, "pts": pts, "g": g, "v": v, "n": n, "p": p, "gf": gf, "gs": gs, "pe": 0})
    return rows


def parse_results(html):
    """Partite terminate della giornata mostrata: (giornata, [risultati]), giornate vicine."""
    m = re.search(r'Risultati Giornata (\d+)', html)
    if not m:
        return None, [], {}
    rnd = int(m.group(1))
    season = re.search(r'\?y=(\d{4})-\d{2}', html)
    y0 = int(season.group(1)) if season else datetime.now().year
    links = {int(n): u for u, n in re.findall(r'href="(/WidgetV2/Risultati/[^"/]+/(\d+)\?y=[^"]+)"', html)}
    out, day = [], None
    for tr in re.split(r'<tr class="', html)[1:]:
        if tr.startswith("date"):
            dm = re.search(r'(\d{1,2})\s+([a-z]+)', text(tr).lower())
            if dm and dm.group(2) in MONTHS:
                mo = MONTHS[dm.group(2)]
                day = f"{y0 if mo >= 7 else y0 + 1:04d}-{mo:02d}-{int(dm.group(1)):02d}"
            continue
        if not tr.startswith("match"):
            continue
        home = re.search(r'(?s)<td class="team home[^"]*">.*?class="team-name[^"]*"[^>]*>(.*?)</a>', tr)
        away = re.search(r'(?s)<td class="team away[^"]*">.*?class="team-name[^"]*"[^>]*>(.*?)</a>', tr)
        goals = re.findall(r'(?s)<span class="goal[^"]*" title="Partita terminata">\s*(\d+)\s*</span>', tr)
        if not home or not away or len(goals) != 2:
            continue  # non ancora giocata, rinviata o in corso
        out.append({"date": day, "home": text(home.group(1)), "away": text(away.group(1)), "hg": int(goals[0]), "ag": int(goals[1])})
    return rnd, out, links


def name_map(tc_names, cu_names):
    """Ogni nome Tuttocampo al nome dei comunicati: abbinamento uno a uno, o None."""
    pairs = sorted(((crl.similarity(t, c), t, c) for t in tc_names for c in cu_names), reverse=True)
    out, used = {}, set()
    for s, t, c in pairs:
        if s < 0.99 or t in out or c in used:
            continue
        out[t] = c
        used.add(c)
    return out if len(out) == len(set(tc_names)) else None


def leg_round(n):
    return ("A", n) if n <= ROUNDS_PER_LEG else ("R", n - ROUNDS_PER_LEG)


def main():
    out_path = sys.argv[1]
    with open(out_path, encoding="utf-8") as f:
        data = json.load(f)
    before = {k: v for k, v in data.items() if k != "generatedAt"}
    if "--files" in sys.argv:
        files = sys.argv[sys.argv.index("--files") + 1:]
        pages = [open(p, encoding="utf-8").read() for p in files]
        standing_html, result_pages = pages[0], pages[1:]
    else:
        standing_html = fetch(f"{BASE}/Classifica/{WIDGET_ID}")
        first = fetch(f"{BASE}/Risultati/{WIDGET_ID}")
        rnd, _, links = parse_results(first)
        result_pages = [first] + ([fetch("https://www.tuttocampo.it" + links[rnd - 1])] if rnd and links.get(rnd - 1) else [])

    official = data["standing"]
    cu_names = [r["team"] for r in official["rows"]]
    rows = parse_standing(standing_html)
    parsed = [parse_results(h) for h in result_pages]
    tc_names = [r["team"] for r in rows] + [n for _, res, _ in parsed for r in res for n in (r["home"], r["away"])]
    names = name_map(sorted(set(tc_names)), cu_names) if rows else None
    if len(rows) != len(cu_names) or not names:
        raise SystemExit(f"Tuttocampo: classifica di {len(rows)} squadre o nomi non abbinabili ai comunicati, nessuna modifica")

    now = datetime.now(timezone.utc)
    results = [r for r in data.get("results", []) if not r.get("provisional")]
    added = []
    for rnd, res, _ in parsed:
        leg, n = leg_round(rnd)
        for r in res:
            p = {"competition": crl.COMPETITION, "girone": crl.GIRONE, "round": n, "leg": leg, "date": r["date"],
                 "home": names[r["home"]], "away": names[r["away"]], "hg": r["hg"], "ag": r["ag"],
                 "source": "Tuttocampo (provvisorio)", "url": f"{PAGE}/Risultati", "provisional": True}
            if not any(crl.same_match(o, p) for o in results):
                added.append(p)
    data["results"] = sorted(results + added, key=lambda r: (r["date"] or "", r["competition"], r["home"]))

    played = sum(r["g"] for r in rows)
    if played > sum(r["g"] for r in official["rows"]):
        rows = [{**r, "team": names[r["team"]]} for r in rows]
        last = max(rnd for rnd, _, _ in parsed if rnd)
        data["standingProvisional"] = {"asOf": f"Tuttocampo, provvisoria dopo la {last}ª giornata", "provisional": True,
                                       "url": f"{PAGE}/Classifica", "rows": rows}
    else:
        data.pop("standingProvisional", None)

    if {k: v for k, v in data.items() if k != "generatedAt"} == before:
        print("Tuttocampo: nessuna novità")
        return
    data["generatedAt"] = now.isoformat(timespec="seconds")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"Tuttocampo: {len(added)} risultati provvisori, classifica {'provvisoria' if 'standingProvisional' in data else 'ufficiale già aggiornata'}")


if __name__ == "__main__":
    main()
