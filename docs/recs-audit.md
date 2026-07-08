# Rekommendationsmotor — audit & fixar (2026-07)

Kanonisk pipeline: `lib/unifiedRecs.ts` → `computeUnifiedRecs`.

## Pipeline (kort)

1. Ladda profil, ratings, watchlist (+ gruppmedlemmar i gruppläge)
2. TMDB `/discover` med provider-filter och (film) SE-certifiering
3. Exkludera `watchKeys` (swipes/betyg + watchlist)
4. **V1:** genre + TMDB-kvalitet + recency
5. **V2:** taste seeds → keywords/skådespelare
6. **MMR** diversifiering (λ=0.3)

## Signal → exkludering / smak

| Signal | Exkluderas? | Smak-seed |
|--------|-------------|-----------|
| Swipe like | Ja (tills recycle) | watchlist 1.0; like 0.85 om ej watchlist |
| Swipe dislike | Ja (tills recycle) | -0.5 |
| Swipe sett | Ja (tills recycle) | -0.15 |
| Betyg 7–10 | Ja | 0.25–1.0 |
| Betyg 1–4 | Ja | -0.25 till -1.0 |
| Betyg 5–6 | Ja | -0.12 / -0.06 (svag negativ) |
| RATE_DISMISSED | Ja | — |
| Watchlist | Ja (alltid) | 1.0 (negativ seed vinner över positiv) |

## Fixar (steg 7 audit)

- **decision** används för smak (dislike/like/seen)
- **mergeSeedWeight:** negativ signal vinner över watchlist/favorit
- **/api/rate** rensar `rating` vid ny swipe
- **Grupp:** alla medlemmars ratings + watchlists för exkludering och smak
- **recycleAfterDays** på profil — titlar kan komma tillbaka efter N dagar
- **Solo åldersfilter** på filmer (SE-cert)
- **Större pool:** 60 kandidater, 8 TMDB-sidor, top 50 till V2, fler seeds
- **strictProviders:** `true` när grupp har manuell provider-lista
- **Swipe-gräns** räknar bara like/dislike/seen (inte import/dismiss)
- **TMDB_READ_TOKEN** som fallback

## Kvarvarande begränsningar

- TV-serier har inget åldersfilter i TMDB discover
- Provider-intersection (AND) över medlemmar — ej implementerat (OR via TMDB)
- `GroupVote` påverkar inte recs (medvetet — votes är gruppspecifika per session)
