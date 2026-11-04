# HikeJournal – javna spletna stran

Predstavitvena stran z gumbom **Odpri aplikacijo**, ki vodi na `app/`. Objavljena na GitHub Pages.

```
index.html     predstavitev
img/           posnetki zaslona aplikacije
app/           zgrajena Flutter web aplikacija (ustvari jo build_site.ps1)
.nojekyll      GitHub Pages naj datotek ne obdeluje z Jekyllom
```

## Objava (enkrat)

1. Na GitHubu ustvari **javni** repozitorij, npr. `hikejournal-site`.
   Ime mora biti drugačno od zasebnega `HikeJournal`, ker je del naslova strani.
2. V tej mapi:
   ```powershell
   git init -b main
   git add -A
   git commit -m "Spletna stran"
   git remote add origin https://github.com/anzeti-hike/hikejournal-site.git
   git push -u origin main
   ```
3. Repozitorij → **Settings → Pages → Build and deployment**: *Deploy from a branch*, `main`, `/ (root)` → **Save**.
4. Stran je čez minuto na `https://anzeti-hike.github.io/hikejournal-site/`.

## Aplikacija v `app/`

V mapi **HikeJournalDev** (potrebuješ `config.json` z `GOOGLE_CLIENT_ID`):

```powershell
.\build_site.ps1 -SiteRepo "hikejournal-site"
```

Skripta zgradi aplikacijo z `--base-href /hikejournal-site/app/` in jo skopira sem v `app/`. Nato tukaj `git add -A`, commit, push.
Če repozitorij poimenuješ drugače, uporabi to ime v `-SiteRepo`.

V Google Cloud mora biti med *Authorized JavaScript origins* `https://anzeti-hike.github.io`.

## Kaj je javno

Vse v tem repozitoriju vidi vsak, tudi zgrajena aplikacija. Google Client ID in MapTiler ključ sta v zgrajeni kodi vidna.
To je pri spletnih aplikacijah normalno: Client ID ni skrivnost, MapTiler ključ pa na cloud.maptiler.com omeji na `anzeti-hike.github.io`.
Tvoji pohodi, slike in videi **niso** tukaj, ampak na tvojem Google Drive.
