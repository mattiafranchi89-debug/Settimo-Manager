#!/usr/bin/env python3
"""Provvedimenti del Giudice Sportivo a carico del Settimo Milanese (prima
squadra: Prima Categoria e Coppa Lombardia Prima Categoria), ricavati dai
testi dei comunicati CRL salvati da crl_cache.py.

Per ogni «(SETTIMO MILANESE)» nelle decisioni del Giudice Sportivo si
registrano la sezione (calciatori, allenatori, dirigenti, massaggiatori,
medici, assistente arbitro), il titolo del provvedimento (ammonizione con il
numero dell'infrazione, squalifica a gare o fino a una data, inibizione) e la
data della gara. Serve soprattutto per lo staff: la scheda gara conosce i
cartellini, ma solo il comunicato dice quante giornate o fino a quando.

Il file prodotto (public/data/disciplina.json) è cumulativo: le voci restano
quando i comunicati escono dalla cache e ripartono a ogni stagione (1° luglio).

Uso: python3 scripts/crl_disciplina.py <cartella-cache> <disciplina.json>
"""

import json
import os
import re
import sys
from datetime import date, datetime, timezone

COMPS = {"PRIMA CATEGORIA": "campionato", "COPPA LOMBARDIA PRIMA CTG": "coppa"}
# Stessi titoli di competizione di crl_girone.py: ogni titolo chiude il blocco precedente.
HEADING_RE = re.compile(
    r"^(ECCELLENZA|PROMOZIONE|PRIMA CATEGORIA|SECONDA CATEGORIA|TERZA CATEGORIA|COPPA |REGIONALE |"
    r"JUNIORES|UNDER |ALLIEVI|GIOVANISSIMI|ESORDIENTI|PULCINI|CALCIO A ?5|CALCIO FEMMINILE|SERIE |"
    r"FEMMINILE|ATTIVITA)[A-Z0-9 .'/-]*$")
SECTIONS = {
    "CALCIATORI ESPULSI": "calciatore", "CALCIATORI NON ESPULSI": "calciatore",
    "ALLENATORI": "allenatore", "DIRIGENTI": "dirigente", "MASSAGGIATORI": "massaggiatore",
    "MEDICI": "medico", "ASSISTENTE ARBITRO": "assistente", "SOCIETA'": None, "SOCIETA": None,
}
TITLE_RE = re.compile(r"^(?:[IVX]+\s+)?(AMMONIZIONE|SQUALIFICA|INIBIZIONE)\b")
GARE_DEL_RE = re.compile(r"^GARE\s+DEL\s+(\d{1,2})/\s?(\d{1,2})/(\d{4})")
TEAM_RE = re.compile(r"\(([^()]*)\)")
DATE_RE = re.compile(r"(\d{1,2})/\s?(\d{1,2})/(\d{4})")
WORDS = {"UNA": 1, "DUE": 2, "TRE": 3, "QUATTRO": 4, "CINQUE": 5, "SEI": 6, "SETTE": 7, "OTTO": 8,
         "NOVE": 9, "DIECI": 10, "UNDICI": 11, "DODICI": 12}
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10}
GENERIC = set("asd ssd ssdarl ssdrl srl arl rl ac acd as us usd gs gsd fc sc ss cs pol calcio".split())
TEAM = {"settimo", "milanese"}
# Il nome di una voce andata a capo sta sopra e sotto la squadra, a circa 25 colonne a sinistra.
WRAP_COLS = 30


def tokens(name):
    return {t for t in re.split(r"[^a-z0-9]+", name.lower().replace(".", "")) if len(t) > 1 and t not in GENERIC}


def is_us(team):
    # Solo «SETTIMO MILANESE» (anche «U.S. SETTIMO MILANESE»), non altre squadre con quel nome dentro.
    return tokens(team) == TEAM


def iso(d, m, y):
    return f"{int(y):04d}-{int(m):02d}-{int(d):02d}"


def heading_of(line):
    s = line.strip()
    if len(s) > 45 or "..." in s or not s.isupper():
        return None
    return s if HEADING_RE.match(s) else None


def sanction(title):
    """Significato del titolo sopra i nomi: tipo, gare, data finale, infrazione, diffida."""
    t = re.sub(r"\s+", " ", title.strip())
    out = {"titolo": t, "tipo": "squalifica", "gare": None, "fino": None, "infrazione": None, "diffida": "DIFFIDA" in t}
    if TITLE_RE.match(t).group(1) == "AMMONIZIONE":
        out["tipo"] = "ammonizione"
    elif t.startswith("INIBIZIONE"):
        out["tipo"] = "inibizione"
    m = re.search(r"FINO AL\s+" + DATE_RE.pattern, t)
    if m:
        out["fino"] = iso(*m.groups()[-3:])
    m = re.search(r"PER\s+([A-Z]+)\s+GAR[AE]\s+EFFETTIV[AE]", t)
    if m and m.group(1) in WORDS:
        out["gare"] = WORDS[m.group(1)]
    m = re.search(r"\(([IVX]+)\s+INFR\)", t) or re.match(r"^([IVX]+)\s+AMMONIZIONE", t)
    if m:
        out["infrazione"] = ROMAN.get(m.group(1))
    return out


def blank(line):
    s = line.strip()
    return not s or bool(TITLE_RE.match(s) or GARE_DEL_RE.match(s) or s in SECTIONS or heading_of(line))


def cell(lines, j, s):
    """Pezzo di nome nella colonna della squadra (che inizia alla colonna s) sulla riga j."""
    if not 0 <= j < len(lines) or blank(lines[j]):
        return ""
    line = lines[j]
    # Una squadra vicina a quella colonna vuol dire che la riga è un'altra voce.
    if any(abs(m.start() - s) <= 6 for m in TEAM_RE.finditer(line)):
        return ""
    # Il pezzo intero (parole separate da uno spazio) che cade nella colonna: un nome
    # andato a capo può cominciare più a sinistra o finire oltre la squadra.
    for m in re.finditer(r"\S+(?: \S+)*", line):
        if m.end() > s - WRAP_COLS and m.start() <= s:
            return m.group(0) if re.fullmatch(r"[A-Z][A-Z' .-]*", m.group(0)) else ""
    return ""


def games_after(text):
    m = re.match(r"\s*(\d+)\s+gar[ae]\b", text) or re.match(r"\s*gar[ae]\s+(\d+)\b", text)
    return int(m.group(1)) if m else None


def name_at(lines, i, m):
    """Nome (e «N gare», se scritto accanto) della voce con la squadra m sulla riga i."""
    line = lines[i]
    prev = [x for x in TEAM_RE.finditer(line) if x.end() <= m.start()]
    before = line[prev[-1].end() if prev else 0:m.start()].strip()
    games = games_after(line[m.end():])
    if before:
        return before, games
    # Voce andata a capo: prima parte del nome sopra la squadra, resto sotto. Con la
    # squadra sopra il nome, nella colonna di destra il nome può stare due righe sotto.
    above = cell(lines, i - 1, m.start())
    j = i + 1
    below = cell(lines, j, m.start())
    if not above and not below and j < len(lines) and not lines[j][max(0, m.start() - WRAP_COLS):m.start() + WRAP_COLS].strip():
        j += 1
        below = cell(lines, j, m.start())
    if games is None and below:
        # «SESTI CLAUDIO   2 gare»: con la squadra sopra, le gare stanno accanto al nome.
        at = lines[j].find(below, max(0, m.start() - WRAP_COLS))
        games = games_after(lines[j][at + len(below):])
    return " ".join(x for x in (above, below) if x), games


def parse(lines):
    """Voci del Settimo nelle decisioni del Giudice Sportivo di Prima Categoria e Coppa Lombardia Prima Ctg."""
    comp = section = title = gara = None
    out = []
    for i, line in enumerate(lines):
        s = line.strip()
        h = heading_of(line)
        if h:
            comp, section, title = COMPS.get(h), None, None
            continue
        if not comp:
            continue
        g = GARE_DEL_RE.match(s)
        if g:
            gara, section, title = iso(*g.groups()), None, None
            continue
        if s in SECTIONS:
            section, title = s, None
            continue
        if TITLE_RE.match(s):
            title = s
            continue
        if not section or not SECTIONS[section] or not title:
            continue
        for m in TEAM_RE.finditer(line):
            if not is_us(m.group(1)):
                continue
            name, games = name_at(lines, i, m)
            if not name:
                print(f"  voce del Settimo senza nome leggibile alla riga {i + 1}: {s[:80]}", file=sys.stderr)
                continue
            v = sanction(title)
            if games and not v["gare"] and not v["fino"]:
                v["gare"] = games
            out.append({"competizione": comp, "gara": gara, "nome": re.sub(r"\s+", " ", name), "ruolo": SECTIONS[section], **v})
    return out


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def season_start(today=None):
    today = today or date.today()
    return date(today.year if today.month >= 7 else today.year - 1, 7, 1).isoformat()


def main():
    cache_dir, out_path = sys.argv[1], sys.argv[2]
    with open(os.path.join(cache_dir, "index.json"), encoding="utf-8") as f:
        docs = json.load(f)["docs"]
    data = {}
    if os.path.exists(out_path):
        with open(out_path, encoding="utf-8") as f:
            data = json.load(f)

    since = season_start()
    items = {v["id"]: v for v in data.get("provvedimenti", []) if (v.get("pubblicato") or "") >= since}
    order = sorted((d for d in docs.values() if d.get("kind") == "comunicato" and (d.get("date") or "") >= since),
                   key=lambda d: (d.get("date") or "", d.get("number") or 0))
    for doc in order:
        for f in doc.get("files", []):
            # Le decisioni sono nel comunicato principale, non negli allegati (classifiche, delibere).
            if not f.get("txt") or not re.match(r"comunicato", os.path.basename(f["txt"]), re.I):
                continue
            with open(os.path.join(cache_dir, f["txt"]), encoding="utf-8") as fh:
                found = parse(fh.read().splitlines())
            num = doc.get("number")
            label = f"Comunicato Ufficiale n. {num}" if num else (doc.get("title") or "Comunicato CRL")
            for v in found:
                what = v["gare"] or v["fino"] or v["infrazione"] or ""
                vid = f"cu{num or doc.get('id')}-{v['competizione']}-{v['gara'] or ''}-{v['ruolo']}-{slug(v['nome'])}-{v['tipo']}{what}"
                items[vid] = {"id": vid, "doc": label, "numero": num, "pubblicato": doc.get("date"), "url": doc.get("url"), **v}

    kept = sorted(items.values(), key=lambda v: (v["pubblicato"] or "", v["numero"] or 0, v["id"]))
    new = {"team": "SETTIMO MILANESE", "provvedimenti": kept}
    if {k: v for k, v in data.items() if k != "generatedAt"} == new:
        print("disciplina.json: nessuna novità")
        return
    new = {"generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), **new}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(new, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"disciplina.json: {len(kept)} provvedimenti")
    for v in kept:
        extra = v["gare"] and f"{v['gare']} gare" or v["fino"] and f"fino al {v['fino']}" or v["infrazione"] and f"{v['infrazione']}ª infr." or ""
        print(f"  {v['doc']} · {v['competizione']} · {v['ruolo']} {v['nome']}: {v['tipo']} {extra}")


if __name__ == "__main__":
    main()
