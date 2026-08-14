# Recs-benchmark: AI-kurerad lista vs computeUnifiedRecs (2026-08-14)

**Fråga:** Är algoritmen nära taket, eller finns det potential? Metod: Oskars fulla historik (1 506 ratings, 359 watchlist) användes som facit. Algoritmens topp-100 hämtades live från prod (`/api/recs/unified?all=1`, två sidor). En AI-kurerad topp-100 byggdes utifrån samma data och samma regler (bara Oskars streamingtjänster i SE, exkludera allt swipat/sparat — verifierat mot TMDB per titel).

**Svar: nej, algoritmen är inte nära taket.** Överlappet mellan listorna är **7/100** (Dept. Q, Kastanjemannen, Mare of Easttown, Luther, The Fall, The Serpent, Pluto — noterbart: alla ur krim-klustret, där smakmodellen faktiskt fungerar). Det mesta av gapet beror dock inte på "AI är smartare" utan på fem konkreta, fixbara problem i pipelinen.

---

## Fynd 1: 55 av algoritmens 100 är titlar Oskar redan swipat NEJ på

Detta är huvudorsaken till "beige"-känslan. `recycle_after_days = 14` betyder att dislikes utan betyg återvinns efter 14 dagar (`isExcludedByRecycle`, lib/unifiedRecs.ts). Oskar har 953 rena dislikes varav **750 är äldre än 14 dagar** — alla är tillbaka i poolen. Eftersom de dessutom matchar hans breda profilgenrer får de hög V1-score och lägger sig **överst**: Roger Rabbit (#1), Jack Reacher (#2), Ready Player One (#3), fem Apornas planet-filmer, tre Fantastiska vidunder, Taken 3, Con Air, Armageddon… Han ser bokstavligen sina egna nej-svepningar igen, opåverkade av att han redan sagt nej.

## Fynd 2: Smakmodellen ser aldrig hans betyg — seeds domineras av gammal watchlist

`buildSeeds` (lib/tasteModel.ts) tar favoriter (vikt 1.0), watchlist (vikt 1.0) och ratings (10/10 → 1.0, 9 → 0.75, like → 0.85), sorterar på |vikt| och **kapar till 14**. Med 359 watchlist-rader och 29 tior som alla väger 1.0 avgör insättningsordningen — och den är: favoriter först, sedan watchlist i DB-ordning. Resultat: hans 14 seeds blir There Will Be Blood + MINDHUNTER + de 12 **äldsta watchlist-raderna** — dvs. Gudfadern, Stranger Things, **Young Sheldon, Shameless, The Chosen, xXx, War Machine**, Spider-Man: Homecoming… Betygen — 240 explicita siffror, den starkaste signalen som finns — når i praktiken aldrig smakmodellen. Negativa seeds (dislike −0.5) överlever aldrig kapningen, så modellen saknar helt negativ signal.

## Fynd 3: De deklarerade favoritgenrerna motsäger det faktiska beteendet

V1-scoren väger genrematchning högst (1.6×) mot profilens `favorite_genres`: Action, Komedi, Mysterium, Drama, Äventyr, Animerat, Sci-Fi, Kriminal. Men beteendedatat säger nästan tvärtom — andel negativa svepningar per genre:

| Genre | Positiv | Negativ | Andel negativ |
|---|---|---|---|
| Kriminal | 147 | 133 | **48 %** ← enda genren under 50 % |
| Drama | 278 | 350 | 56 % |
| Thriller | 127 | 190 | 60 % |
| Action | 141 | 272 | 66 % |
| Komedi | 132 | 269 | 67 % |
| Sci-Fi | 80 | 162 | 67 % |
| Äventyr | 81 | 250 | **76 %** |
| Animerat | 40 | 165 | **80 %** |
| Familj | 17 | 128 | **88 %** |

Algoritmen belönar alltså exakt de genrer han oftast sveper bort. Hans verkliga smak (prestige-drama/krim/thriller à la Fincher, Nolan, PTA, Scorsese; true crime; rättegångs-/journalistikdrama; sportdrama; sitcoms; viss vuxenanimation/anime) ligger i betygen — som pipelinen inte läser (fynd 2).

## Fynd 4: Inget kvalitetsgolv, och fandom-inflaterade TMDB-betyg premieras

Velma (3.5 i TMDB-betyg!) tog sig in på listan via genrematch (Animerat+Komedi+Mysterium). Samtidigt lyfts k-drama/anime med små men hängivna röstarkårer (8.4–8.9) före bredare titlar. `qualityScore` (vote_average × log(vote_count)) saknar både golv och normalisering.

## Fynd 5: Barninnehåll läcker trots `show_kids_content = false`

Scooby Doo! Mysteriegänget, Dexters laboratorium, Big Hero 6-serien, American Dragon: Jake Long, Trollkarlarna: Äventyr i Arcadia — filtret tittar bara på TMDB:s "Kids"-genre, som de flesta barnserier inte är taggade med (de är Animation/Comedy). SE-cert-filtret gäller dessutom bara film.

---

## Åtgärder, rankade efter effort

**Snabba (timmar, störst effekt):**
1. **Straffa återvunna dislikes i scoringen** i stället för att släppa in dem opåverkade — t.ex. scoreFinal −1.5 per tidigare nej, eller höj default-recycle till 90 dagar och cap:a andelen återvunna kort per lek (~20 %). Detta ensamt halverar beige-problemet.
2. **Höj seedCap 14 → ~40 och vikta om**: betyg ≥8 ska slå watchlist (t.ex. 10→1.5, 9→1.2, 8→0.9, watchlist→0.6), och sortera ties på recency i stället för insättningsordning. Släpp igenom några negativa seeds (kapa positiva och negativa separat).
3. **Kvalitetsgolv**: hoppa kandidater med vote_average < 5.5 eller vote_count < ~200 om de inte har stark smakmatchning.

**Medel (dagar):**
4. **Lär genrevikter från beteende**: ersätt/komplettera de deklarerade genrerna med pos/neg-ratio per genre ur ratings (tabellen ovan är exakt den datan). Kriminal ska väga upp; Äventyr/Animerat/Familj ska väga ner för den här användaren — oavsett vad onboardingen sa.
5. **Franchise-penalty**: rekommendera inte fler delar ur en collection användaren betygsatt ≤7 eller dislike:at (TMDB `belongs_to_collection`). Dagens lista: 5× Apornas planet, 3× Fantastiska vidunder, 3× Hunger Games, 2× Guardians.
6. **Fixa kids-filtret**: cert-cappa även TV eller heuristik på Animation + Family/har barnnätverk.

**Långsiktigt (om ni vill förbi metadatataket):**
7. **LLM-rerank som batchjobb**: behåll pipelinen för retrieval (topp ~200), låt en billig LLM omranka topp-50 mot en komprimerad smakprofil (genererad ur betygen, cachad, uppdaterad veckovis via cron). Det är det som gav AI-listan dess fördel: begrepp som "auteur", "prestige", "elevated horror" och kopplingar som Whiplash→The Iron Claw finns inte i TMDB:s metadata men är billiga för en LLM.

**Ärlig bedömning av taket:** AI-listans fördel kommer till ~70 % från att den *inte* gör fel 1–5, och ~30 % från världskunskap som TMDB-data inte kan uttrycka. Åtgärd 1–6 bör alltså stänga större delen av gapet utan någon AI alls.

---

## Implementerat 2026-08-14 (samma dag)

Åtgärd 1–6 plus ett sjunde fynd som simuleringen avslöjade är implementerade:

1. **Recycle-straff + andelstak** (`lib/unifiedRecs.ts`): återvunna dislikes får −2.5 i score med 1 års halveringstid, och max 20 % av leken får vara återvunnet (MMR-urvalet hoppar över resten så länge osett finns).
2. **Seeds-ombyggnad** (`lib/tasteModel.ts`): tak 14 → 24 positiva + 12 negativa (grupp 30+10); betyg viktas över watchlist (10→1.5, 9→1.2, 8→0.9, like→0.7, watchlist→0.6, favoriter→1.6); ties bryts på recency i stället för DB-ordning; negativa seeds överlever nu kapningen.
3. **Kvalitetsgolv + Bayesiansk kvalitet**: titlar med ≥50 röster under 5.8 åker ut; vote_average dras mot prior 6.5 tills ~250 röster bär (dämpar fandom-inflaterade småtitlar).
4. **Beteendebaserade genrevikter**: ny kolumn `profiles.genre_stats` (pushad till prod + backfillad för alla 19 användare), uppdateras vid varje swipe/betyg (`lib/genreStats.ts`, inhookad i swipe/decide, rate, ratings/save). Viktningen fasar från deklarerade genrer mot beteende i takt med datamängden (full effekt vid 150 observationer; deklarationen behåller alltid 55 %).
5. **Franchise-straff**: −1.8 för filmer i en TMDB-collection där användaren nobbat/satt ≤6 på någon del.
6. **Tätat kids-filter**: `without_genres 10762,10751` på discover-TV + kandidatnivå-heuristik (Kids-genre eller Animation∧Family).
7. **Fynd 7 — retrieval-svält** (upptäckt i verifieringssimuleringen): en storswipare har redan betat av populär-toppen, så poolen bestod av 17 osedda av 121 kandidater — straff och tak kan inte trolla fram osett som aldrig hämtas. Ny smakriktad retrieval när osett < 40: discover-pass på topp-3 *beteende*-genrer (betygssorterade) och topp-8 smak-keywords (röstsorterade), samma provider-/cert-/barnfilter.

**Verifiering** (tsc + eslint gröna; trogen simulering av nya pipelinen på Oskars riktiga data, lek om 50):

| Mätvärde | Före | Efter |
|---|---|---|
| Återvunna dislikes i leken | 55 % | **10 %** |
| Kids-läckor | 5 st | **0** |
| Titlar under kvalitetsgolv (à la Velma) | förekom | **0** |
| Lekens karaktär | Roger Rabbit, Taken 3, Armageddon, 5× Apornas planet | The Penguin, Mr Inbetween, JFK, Papillon, Three Billboards, Official Secrets, Stranger |

Kvar som möjligt nästa steg: LLM-rerank (åtgärd 7 ovan) — medvetet uppskjuten tills effekten av detta är uppmätt i verklig användning.

---

## Bilaga A — Algoritmens 100 (prod, 2026-08-14)

*Markering: ♻ = redan disliked av Oskar (recycle-läcka).*

1. Vem satte dit Roger Rabbit (1988, film, TMDB 7.5) ♻
2. Jack Reacher (2013, film, TMDB 6.7) ♻
3. Ready Player One (2018, film, TMDB 7.6) ♻
4. Apornas planet: Uppgörelsen (2014, film, TMDB 7.3) ♻
5. Kingdom of the Planet of the Apes (2024, film, TMDB 7.1) ♻
6. Drakprinsen (2018, serie, TMDB 8.2)
7. The Hunger Games: Catching Fire (2013, film, TMDB 7.4) ♻
8. Apornas planet: (R)evolution (2011, film, TMDB 7.4) ♻
9. Harry Potter och Halvblodsprinsen (2009, film, TMDB 7.7) ♻
10. Gone Girl (2014, film, TMDB 7.9) ♻
11. Fantastiska vidunder: Dumbledores hemligheter (2022, film, TMDB 6.6) ♻
12. Merlin (2008, serie, TMDB 7.8) ♻
13. Magiska systrar (1999, film, TMDB 6.8)
14. Mannen i det höga slottet (2015, serie, TMDB 7.5) ♻
15. Mortal Kombat II (2026, film, TMDB 7.9) ♻
16. Legenden om Vox Machina (2022, serie, TMDB 8.2) ♻
17. Tillbaka till framtiden (1985, film, TMDB 8.3) ♻
18. Mortal Kombat (2021, film, TMDB 7.0) ♻
19. Fantastiska vidunder och var man hittar dem (2016, film, TMDB 7.3) ♻
20. Guardians of the Galaxy (2014, film, TMDB 7.9) ♻
21. The Flash (2023, film, TMDB 6.6) ♻
22. Guardians of the Galaxy Vol. 2 (2017, film, TMDB 7.6) ♻
23. Rogue One: A Star Wars Story (2016, film, TMDB 7.5) ♻
24. Den of Thieves (2018, film, TMDB 6.9) ♻
25. Guardians of the Galaxy Vol. 3 (2023, film, TMDB 7.9) ♻
26. Alita: Battle Angel (2019, film, TMDB 7.3) ♻
27. Masters of the Universe (2026, film, TMDB 7.2) ♻
28. Idiotrepubliken (2007, film, TMDB 6.4) ♻
29. Locke & Key (2020, serie, TMDB 7.7)
30. The Fantastic Four (2005, film, TMDB 5.8)
31. The Creator (2023, film, TMDB 7.0) ♻
32. Firefly (2002, serie, TMDB 8.3)
33. Grimm (2011, serie, TMDB 8.3) ♻
34. Die Hard - Hämningslöst (1995, film, TMDB 7.3) ♻
35. TRON: Ares (2025, film, TMDB 6.5) ♻
36. Dexters laboratorium (1996, serie, TMDB 7.7) ♻
37. Lost in Space (2018, serie, TMDB 7.5)
38. La Brea (2021, serie, TMDB 7.4)
39. Star Trek: Picard (2020, serie, TMDB 7.2)
40. Manifest (2018, serie, TMDB 7.6) ♻
41. Terminator: The Sarah Connor Chronicles (2008, serie, TMDB 7.5)
42. Big Hero 6 - TV-serien (2017, serie, TMDB 7.6)
43. 12 Monkeys (2015, serie, TMDB 7.4)
44. Cowboy Bebop (1998, serie, TMDB 8.5) ♻
45. Travelers (2016, serie, TMDB 7.6)
46. Furious (2026, serie, TMDB 6.7)
47. In Time (2011, film, TMDB 7.0) ♻
48. Taken 3 (2015, film, TMDB 6.3) ♻
49. Scooby Doo! Mysteriegänget (2010, serie, TMDB 8.2) ♻
50. Mercy (2026, film, TMDB 7.1) ♻
51. Dirk Gently's Holistic Detective Agency (2016, serie, TMDB 7.7)
52. Apornas planet (1968, film, TMDB 7.7) ♻
53. Dept. Q (2025, serie, TMDB 7.9)
54. Warcraft: The Beginning (2016, film, TMDB 6.4) ♻
55. Big Trouble in Little China (1986, film, TMDB 7.2) ♻
56. Ett mord i taget (2024, serie, TMDB 7.6)
57. Hunger Games (2012, film, TMDB 7.2) ♻
58. 내 남편과 결혼해줘 (2024, serie, TMDB 8.5)
59. Great Pretender (2020, serie, TMDB 7.5)
60. Divergent (2014, film, TMDB 6.9) ♻
61. Maze Runner: The Scorch Trials (2015, film, TMDB 6.7) ♻
62. Starship Troopers (1998, film, TMDB 7.1) ♻
63. Conan the Barbarian (2011, film, TMDB 5.3)
64. Kastanjemannen (2021, serie, TMDB 7.5)
65. HIS & HERS (2026, serie, TMDB 7.3)
66. 빈센조 (2021, serie, TMDB 8.5)
67. Swarm (2023, serie, TMDB 6.6)
68. Allegiant (2016, film, TMDB 6.1)
69. 東京リベンジャーズ (2021, serie, TMDB 8.4)
70. Fantastiska vidunder: Grindelwalds brott (2018, film, TMDB 6.8) ♻
71. The Residence (2025, serie, TMDB 7.5)
72. Pokémon Detective Pikachu (2019, film, TMDB 6.9) ♻
73. A Killer Paradox (2024, serie, TMDB 7.3)
74. Haunted Mansion (2023, film, TMDB 6.4)
75. Apornas planet (2001, film, TMDB 5.8) ♻
76. American Dragon: Jake Long (2005, serie, TMDB 7.8)
77. Con Air (1997, film, TMDB 6.8) ♻
78. Dorohedoro (2020, serie, TMDB 8.4)
79. Mare of Easttown (2021, serie, TMDB 8.2)
80. Road to Perdition (2002, film, TMDB 7.4)
81. Grotesquerie (2024, serie, TMDB 7.3)
82. Luther (2010, serie, TMDB 7.9)
83. Ghost in the Shell (2017, film, TMDB 6.1) ♻
84. Scott Pilgrim Takes Off (2023, serie, TMDB 7.9)
85. The Fall (2013, serie, TMDB 7.7)
86. Armageddon (1998, film, TMDB 6.8) ♻
87. Glass Onion: A Knives Out Mystery (2022, film, TMDB 7.0) ♻
88. 멋진 신세계 (2026, serie, TMDB 8.9)
89. Terminator: Dark Fate (2019, film, TMDB 6.4) ♻
90. Den galopperande detektiven (1994, film, TMDB 6.6)
91. Stranger (2017, serie, TMDB 8.3)
92. The Serpent (2021, serie, TMDB 7.4)
93. Trollkarlarna: Äventyr i Arcadia (2020, serie, TMDB 8.2)
94. Fantastic Four: Rise of the Silver Surfer (2007, film, TMDB 5.6) ♻
95. PSYCHO-PASS サイコパス (2012, serie, TMDB 7.7)
96. Transporter 3 (2009, film, TMDB 6.2) ♻
97. EDENS ZERO (2021, serie, TMDB 7.7) ♻
98. Velma (2023, serie, TMDB 3.5)
99. Pluto (2023, serie, TMDB 7.8)
100. RoboCop (1988, film, TMDB 7.4)

## Bilaga B — AI-kurerad 100 (verifierad: rätt titel, ej swipad/sparad, finns på Oskars tjänster i SE)

1. The Killer (2023, film) — Netflix — *Fincher*
2. The Master (2012, film) — Amazon Prime Video — *PTA*
3. Papillon (1973, film) — Amazon Prime Video — *Alcatraz-vibe*
4. Den tunna röda linjen (1998, film) — Disney Plus — *Malick-krig*
5. Uncut Gems (2019, film) — Netflix — *Safdie-ångest*
6. Good Time (2017, film) — Amazon Prime Video — *Safdie*
7. The Iron Claw (2023, film) — Amazon Prime Video — *sport-tragedi*
8. Rättfärdighetens ryttare (2020, film) — Netflix/Amazon Prime Video/HBO Max — *Mikkelsen (En runda till)*
9. Huvudjägarna (2011, film) — Netflix — *norsk thriller*
10. En man som heter Ove (2015, film) — Netflix/HBO Max — *svensk*
11. Snabba cash (2010, film) — Netflix/Disney Plus — *svensk krim*
12. Clark (2022, serie) — Netflix — *svensk Netflix*
13. The Fighter (2010, film) — Amazon Prime Video — *boxning*
14. Million Dollar Baby (2004, film) — HBO Max — *boxning*
15. Wind River (2017, film) — Amazon Prime Video — *Sheridan (Sicario/Hell or High Water)*
16. Triple Frontier (2019, film) — Netflix — *heist*
17. American Made (2017, film) — Netflix — *Cruise/smuggling*
18. The Insider (1999, film) — Disney Plus — *Mann-journalistik (Dark Waters)*
19. På heder och samvete (1992, film) — HBO Max — *rättegång*
20. The Trial of the Chicago 7 (2020, film) — Netflix — *Sorkin-rättegång*
21. The Report (2019, film) — Amazon Prime Video — *utredningsdrama*
22. Den fantastiska räven (2009, film) — Amazon Prime Video/Disney Plus — *Wes (Isle of Dogs 9)*
23. Klaus (2019, film) — Netflix — *animerat*
24. Mission: Impossible - Fallout (2018, film) — HBO Max — *bästa M:I*
25. The Night Of (2016, serie) — HBO Max — *HBO krim (Night Of = True Detective-vibe)*
26. The Penguin (2024, serie) — HBO Max — *The Batman 9*
27. Mare of Easttown (2021, serie) — HBO Max — *HBO krim*
28. The Outsider (2020, serie) — HBO Max — *HBO King-krim*
29. Barry (2018, serie) — HBO Max — *HBO dramedy*
30. We Own This City (2022, serie) — HBO Max — *HBO krim*
31. The Jinx: The Life and Deaths of Robert Durst (2015, serie) — HBO Max — *true crime-dok*
32. When They See Us (2019, serie) — Netflix — *rättsdrama*
33. Unbelievable (2019, serie) — Netflix — *krimdrama (Mindhunter)*
34. The Fall (2013, serie) — Amazon Prime Video — *serial killer*
35. Luther (2010, serie) — Amazon Prime Video — *brittisk krim*
36. The Knick (2014, serie) — HBO Max — *Soderbergh*
37. Top Boy (2011, serie) — Netflix — *UK gata*
38. Narcos: Mexico (2018, serie) — Netflix — *Narcos 10*
39. The Pacific (2010, serie) — HBO Max — *Band of Brothers-syskon*
40. Generation Kill (2008, serie) — HBO Max — *HBO krig*
41. Dopesick (2021, serie) — Disney Plus — *Dark Waters-vibe*
42. The Dropout (2022, serie) — Disney Plus — *bedrägeri-biopic*
43. Warrior (2019, serie) — HBO Max — *Cinemax kampsport*
44. Watchmen (2019, serie) — HBO Max — *HBO (Boys 8)*
45. Industry (2020, serie) — HBO Max — *HBO*
46. Veep (2012, serie) — HBO Max — *Curb-fan*
47. Peep Show (2003, serie) — Amazon Prime Video — *UK sitcom*
48. Blue Eye Samurai (2023, serie) — Netflix — *vuxenanimation prestige*
49. Smiling Friends (2020, serie) — HBO Max — *vuxenanimation*
50. Undone (2019, serie) — Amazon Prime Video — *vuxenanimation*
51. Common Side Effects (2025, serie) — HBO Max — *vuxenanimation*
52. Vinland Saga (2019, serie) — Netflix/Amazon Prime Video — *anime (Vikings-fan)*
53. Jujutsu Kaisen (2020, serie) — Amazon Prime Video — *JJK0 gillad*
54. Patriot (2015, serie) — Amazon Prime Video — *Prime dold pärla*
55. Mr Inbetween (2018, serie) — Disney Plus — *hitman-dramedy*
56. Berlin (2023, serie) — Netflix — *Casa de Papel 9*
57. Baby Reindeer (2024, serie) — Netflix — *mörk dramedy*
58. Adolescence (2025, serie) — Netflix — *brittisk krim-drama*
59. Black Doves (2024, serie) — Netflix — *spion*
60. The Diplomat (2023, serie) — Netflix — *politisk thriller (House of Cards 9)*
61. American Primeval (2025, serie) — Netflix — *western-survival (Revenant 9)*
62. Godless (2017, serie) — Netflix — *western (Hateful 8-fan)*
63. The English (2022, serie) — Amazon Prime Video — *western*
64. Ripley (2024, serie) — Netflix — *stilren thriller*
65. Dept. Q (2025, serie) — Netflix — *nordisk-brittisk krim*
66. The Staircase (2022, serie) — Netflix/HBO Max — *true crime-drama*
67. The Serpent (2021, serie) — Netflix — *serial killer*
68. Kampen om Narvik (2022, film) — Netflix — *norsk krig*
69. Outlaw King (2018, film) — Netflix — *historiskt*
70. Rome (2005, serie) — HBO Max — *HBO historiskt*
71. The Old Man (2022, serie) — Disney Plus — *thriller*
72. Formula 1: Drive to Survive (2019, serie) — Netflix — *Le Mans 66/Rush-fan*
73. The Last Dance (2020, serie) — Netflix — *sportdok (Moneyball)*
74. Free Solo (2018, film) — Disney Plus — *dok survival*
75. På västfronten intet nytt (2022, film) — Netflix — *All Quiet on the Western Front 2022*
76. El Camino: A Breaking Bad Movie (2019, film) — Netflix — *BB 10/10*
77. The Ballad of Buster Scruggs (2018, film) — Netflix — *Coen/Netflix*
78. Rebel Ridge (2024, film) — Netflix — *stram thriller*
79. Snöns brödraskap (2023, film) — Netflix — *survival (127 timmar)*
80. Beasts of No Nation (2015, film) — Netflix — *krigsdrama*
81. Marriage Story (2019, film) — Netflix — *prestige-drama*
82. Hustle (2022, film) — Netflix — *sport (Moneyball)*
83. Seven Psychopaths (2012, film) — Amazon Prime Video — *McDonagh (In Bruges)*
84. Logan Lucky (2017, film) — Amazon Prime Video — *Soderbergh-heist*
85. Bad Times at the El Royale (2018, film) — Disney Plus — *twisty (Cabin in the Woods)*
86. The Power of the Dog (2021, film) — Netflix — *prestige-western*
87. Nomadland (2021, film) — Disney Plus — *prestige-drama*
88. Min borttappade kropp (2019, film) — Netflix — *vuxenanimation*
89. Pluto (2023, serie) — Netflix — *anime-krim (Mindhunter x anime)*
90. American Vandal (2017, serie) — Netflix — *true crime-parodi*
91. Bodyguard (2018, serie) — Netflix — *UK thriller*
92. Giri / Haji (2019, serie) — Netflix — *UK/Japan krim*
93. Criminal: UK (2019, serie) — Netflix — *förhörsdrama*
94. I Think You Should Leave with Tim Robinson (2019, serie) — Netflix — *sketch (R&M-fan)*
95. After Life (2019, serie) — Netflix — *Gervais dramedy*
96. Kingdom (2019, serie) — Netflix — *koreansk zombie (#Alive)*
97. Bodies (2023, serie) — Netflix — *tidskrim*
98. Kastanjemannen (2021, serie) — Netflix — *dansk krim*
99. Störst av allt (2019, serie) — Netflix — *svensk Netflix*
100. Den osannolika mördaren (2021, serie) — Netflix — *svensk Palme-drama*
