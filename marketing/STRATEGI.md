# NextWatch – organisk tillväxtstrategi

**Utgångsläge:** godkänd på App Store 2026-08-13. Budget 0 kr. ~5–10 h/vecka.
**Mål 90 dagar:** volym av nedladdningar + första betalande Premium-kunderna + synlighet/trovärdighet.

---

## 1. Läget, ärligt

Kategorin "swipa fram film" är **inte** tom. På svenska App Store finns redan NextFlick, MovieSwipe, Movie Finder – Swipe to match, Movies Hub m.fl. De är i stort sett alla:

- engelskspråkiga och US-centrerade (Netflix/Hulu, inte SVT Play/TV4 Play/Viaplay)
- **solo**-swipe med "dela din lista" påklistrat efteråt
- utan riktig gruppmatchning

Och de svenska aktörerna (Filmtopp, PlayPilot, JustWatch) är *guider* – bläddra, filtrera, läsa. Ingen swipe, ingen grupp.

**Där ligger luckan.** NextWatch är den enda som gör alla tre sakerna samtidigt: svensk, gruppbaserad, filtrerad på de tjänster ni faktiskt betalar för.

### Positionering

> **NextWatch är appen som avgör soffbråket. Ni swipar samtidigt, appen visar bara det ni faktiskt kan streama, och när ni gillar samma sak låser matchningen upp. Klart på tre minuter.**

Tagline-kandidater, i prioritetsordning:

1. **"Sluta bråka. Börja titta."**
2. "Ni har 40 minuter kvar av kvällen. Lägg dem på filmen."
3. "Swipa tillsammans. Matcha. Kolla."

Vad vi **inte** säger: "AI-rekommendationer" (alla säger det, ingen tror på det), "upptäck nya filmer" (för vagt), "din personliga streaming-guide" (det är Filmtopps position).

### Målgrupp – tre segment, olika roll

| Segment | Varför de spelar roll |
|---|---|
| **Par 25–40** | Störst volym, störst smärta. Varje användare drar automatiskt med sig 1 till. Kärnan i all content. |
| **Kompisgäng / studentkorridor 18–28** | Högst viralitet per session – en filmkväll = 3–5 nya installationer. TikTok-målgruppen. |
| **Seriekollen 20–35** | Solo-swipar, bygger watchlist, kommer tillbaka. Driver retention och Premium. |

---

## 2. Tillväxtmotorn: produkten *är* kanalen

Med 0 kr budget är betald trafik borta. Det som återstår som skalar är **inbjudningsloopen** – och den är inbyggd i produkten redan:

```
A skapar grupp → delar kod → B installerar → de matchar → båda får värde
     ↑                                                          │
     └──────────────── nästa filmkväll, nytt gäng ←─────────────┘
```

Varje procent bättre loop multiplicerar allt annat vi gör. **Därför är fas 1 inte marknadsföring – det är att laga loopen.**

### Fem blockerare jag hittade i koden (alla gratis att fixa)

**1. Inbjudningslänken tappar koden.** `GroupBar.tsx` delar `/group/swipe?code=XXXX`. En ny användare möts av `AuthGate` → registrering → och koden finns inte kvar efteråt. Varje inbjuden person som inte redan har appen riskerar att landa i en tom app istället för i din grupp. *Fix: spara koden i en pending-invite-cookie och skicka in personen i gruppen direkt efter onboarding.*

**2. Delade länkar ser döda ut.** Det finns **inga** Open Graph-taggar någonstans i kodbasen. När någon klistrar in länken i iMessage, WhatsApp eller Snap syns ingen bild, ingen titel, ingen text – bara en naken URL. Det är den enskilt största gratisförlusten. *Fix: dynamiska OG-taggar, "Gå med i Oskars filmkväll" + genererad bild.*

**3. Ingen delning efter matchning.** Matchningen är kvällens höjdpunkt och den perfekta delningsstunden – och den finns inte. *Fix: delbar matchbild ("Vi matchade på X") med appnamn och länk.*

**4. nextwatch.se är osynlig för Google.** Sidan renderas på klienten bakom `AuthGate`; en crawler ser en tom sida. Titeln är `NextWatch`, beskrivningen `Swipe your next watch` – engelska, noll nyckelord. *Fix: publika, serverrenderade sidor + riktig svensk metadata.*

**5. Ingen `sitemap.ts`, ingen `robots.ts`.** Google vet inte att sajten finns.

> Punkt 1–5 tar mig uppskattningsvis en arbetsdag totalt och kostar 0 kr. Allt annat i den här planen fungerar sämre om de inte är gjorda först.

---

## 3. Kanaler – rankade för 0 kr och 5–10 h/vecka

| # | Kanal | Insats/v | Varför |
|---|---|---|---|
| 1 | **Inbjudningsloopen (produkt)** | 0 h efter fix | Enda kanalen som växer av sig själv |
| 2 | **TikTok + IG Reels, svenska** | 3–4 h | Enda gratiskanalen med riktig räckvidd i målgruppen |
| 3 | **ASO (App Store)** | 1 h engångs + justering | Gratis, sammansatt effekt, konverterar bäst av allt |
| 4 | **SEO-sidor på nextwatch.se** | Jag bygger | Du sitter redan på TMDB-datan. Kompounderar i åratal |
| 5 | **Facebook-grupper + Reddit + Flashback** | 1–2 h | Där svenskar redan frågar "vad ska jag se?" |
| 6 | **PR mot svenska medier** | 2 h engångs | Trovärdighet + backlinks. Gratis |
| 7 | **Apple featuring-nominering** | 30 min | Lotteri, men vinsten är enorm |

**Medvetet bortvalt:** Twitter/X (fel målgrupp i Sverige), LinkedIn för användarvärvning (men bra för PR/build-in-public), YouTube long-form (för dyrt i tid), Google Ads / Apple Search Ads (kostar pengar).

### Om TikTok – det som faktiskt fungerar

Appdemos får inga visningar. Det som får visningar är **igenkänningen**, med appen som pointen i slutet:

- Sketch: bråket om vad man ska se → lösningen
- "Streamingtjänster jag betalar för och aldrig använder"
- Build-in-public: en svensk kille bygger en app själv och blir nekad av Apple två gånger *(du har den storyn på riktigt – den är guld)*
- Filmtips-format där appen bara syns i bakgrunden

Regel: **3–5 posts per vecka i 8 veckor** innan man bedömer kanalen. Färre än så ger ingen data. En video går, de andra 20 gör inte det – det är normalläget, inte ett misslyckande.

---

## 4. 90-dagarsplan

### Fas 1 · Vecka 1–2 · Fundament

| Vad | Vem |
|---|---|
| Laga inbjudningsloopen (pending-invite-cookie) | **Jag** (kod) |
| OG-taggar + dynamisk delningsbild | **Jag** (kod) |
| Delbar matchbild efter matchning | **Jag** (kod) |
| `sitemap.ts` + `robots.ts` + svensk metadata | **Jag** (kod) |
| ASO: titel, undertitel, keywords, beskrivning | **Jag** skriver → **du** klistrar in i App Store Connect |
| Analytics: installs, K-faktor, D1/D7, premium-konvertering | **Jag** sätter upp |
| Skapa TikTok- + Instagram-konto @nextwatch.se | **Du** (5 min) |

### Fas 2 · Vecka 3–6 · Motorn igång

| Vad | Vem |
|---|---|
| 3–4 TikTok/Reels per vecka | **Jag** skriver manus + text + hashtags → **du** filmar & postar |
| Lanseringsvågen: Reddit, Flashback, 5–8 Facebook-grupper | **Jag** skriver → publicerar via din inloggade webbläsare efter ditt ok |
| Pressmeddelande + personliga pitchar till 12 svenska redaktioner | **Jag** skriver → **du** skickar från din mejl |
| Apple featuring-nominering | **Jag** förbereder → **du** skickar in |
| Premium-uppsäljning vid rätt ögonblick (efter matchning) | **Jag** (kod + copy) |

### Fas 3 · Vecka 7–12 · Skala det som funkar

| Vad | Vem |
|---|---|
| Dubbla ner på det TikTok-format som faktiskt tog | **Jag** analyserar → nya manus |
| 20–30 SEO-sidor ("Vad ska man se på SVT Play ikväll", "Bästa serierna på Viaplay") genererade från TMDB | **Jag** (kod + innehåll) |
| Onboarding-optimering utifrån var folk faktiskt hoppar av | **Jag** |
| A/B på Premium-copy och prispunkt | **Jag** föreslår → **du** godkänner |
| Andra PR-vågen med riktiga siffror ("X svenskar använder…") | **Jag** skriver |

---

## 5. Arbetsfördelning – vad jag faktiskt kan göra

**Jag kan göra själv, löpande:**

- Skriva allt innehåll: TikTok-manus, captions, hashtags, Reddit-inlägg, Facebook-posts, pressmeddelanden, journalistmejl, ASO-texter, Premium-copy
- Skriva koden för loop-fixar, OG-taggar, SEO-sidor, delningsbilder, analytics
- Skapa grafik: App Store-screenshots, OG-bilder, matchkort, posters
- **Publicera åt dig** via din inloggade webbläsare (Reddit, Facebook-grupper, Flashback, LinkedIn) – efter att du sagt ok på texten
- Köras som **schemalagd uppgift**, t.ex. varje måndag: producera veckans content, checka KPI, rapportera vad som rör sig

**Bara du kan göra:**

- Filma video (ditt ansikte och din röst presterar mycket bättre än stockmaterial)
- Publicera på TikTok/Instagram (kräver mobilen)
- Godkänna innan något går ut i ditt namn
- Prata med journalister
- App Store Connect

**Viktig begränsning, så du vet:** det finns ingen färdig koppling till TikTok, Instagram eller Meta i din uppsättning. Publicering sker antingen genom din webbläsare (funkar för Reddit, Facebook, LinkedIn, Flashback) eller manuellt av dig (TikTok/IG). Jag hittar inte på att jag kan mer än jag kan.

---

## 6. Mätning

Rimliga mål efter 90 dagar för en solo-byggd app med 0 kr i budget:

| Mått | Mål v12 | Varför just det |
|---|---|---|
| Installationer totalt | 1 500–3 000 | Realistiskt för organiskt + en PR-våg som tar |
| K-faktor (inbjudna per gruppskapare) | > 0,8 | Under 0,5 = loopen läcker fortfarande |
| D7-retention | > 20 % | Under det spelar tillväxt ingen roll |
| Gruppsessioner/vecka | 200+ | Kärnvärdet, inte fåfängemåttet |
| Premium-konvertering | 1,5–3 % | 19 kr/mån är lågt tröskelpris; annonsfritt är svagt köpargument – se nedan |

### Premium: en varning värd att ta

Erbjudandet är idag *annonsfritt + obegränsat swipande + större grupper*. Det är ett **försvarserbjudande** – man betalar för att slippa något. De brukar konvertera runt 1 %.

> ⚠️ **Att fixa innan vi marknadsför Premium:** "Större grupper" står som förmån i `app/premium/page.tsx`, men det finns ingen medlemsgräns någonstans i koden – varken i `group/create`, `group/join` eller `group/members`. Gratisanvändare har alltså redan obegränsade grupper. Att lyfta fram en förmån som inte levereras på köpsidan är precis den ytan som fällde build 27 (riktlinje 2.3.1 om vilseledande metadata). Antingen bygger vi in en faktisk gräns för gratis, eller så tar vi bort punkten. Jag rekommenderar att ta bort den – en gräns på gruppstorlek stryper inbjudningsloopen, som är hela tillväxtmotorn.

Ett starkare erbjudande vore något man betalar för att **få**: t.ex. se hela gruppens matchhistorik, gemensam watchlist som sparas mellan kvällar, notis när något på er lista dyker upp på en tjänst ni har. Ingen brådska – men om Premium står och stampar på under 1 % efter 8 veckor är det erbjudandet som är problemet, inte copyn.

---

## 7. Nästa steg

Säg till så börjar jag. Min rekommendation på ordning:

1. **Jag lagar inbjudningsloopen + OG-taggar den här veckan** (störst effekt, kostar dig noll tid)
2. **Du skapar TikTok/IG-kontot** och lägger in ASO-texterna jag skrivit
3. **Vi kör lanseringsvågen** vecka 3 när loopen håller

Klart att posta redan nu: `CONTENT-BANK.md` och `ASO.md`.
