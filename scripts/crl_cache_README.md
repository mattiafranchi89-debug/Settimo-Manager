# Cache dei documenti CRL Lombardia

Ramo generato automaticamente dalla GitHub Action `Cache comunicati CRL`
(`.github/workflows/crl-cache.yml` su main, script `scripts/crl_cache.py`).
Non modificarlo a mano: viene riscritto due volte al giorno.

- `index.json`: documenti in cache (comunicati ufficiali regionali e programmi
  gare), con data, URL della pagina, allegati, numero di menzioni di
  "SETTIMO MILANESE" e i blocchi di testo che le contengono. `lastRun` è l'ora
  (UTC) dell'ultimo controllo del sito; `errors` gli eventuali errori.
- `docs/<id>/*.txt`: testo completo (pdftotext -layout) del comunicato
  principale, delle classifiche, del programma gare e di ogni altro allegato
  che cita il Settimo Milanese.
- `settimo.md`: riepilogo leggibile di tutte le menzioni.

I documenti più vecchi di 60 giorni vengono rimossi.
