// lib/guides/content.ts
//
// Handskriven copy för landningssidorna. Sidorna delar renderare men INTE text:
// varje sida har egen intro, egna sektioner och egen FAQ. Det är med flit — en
// generator som bara byter ut ett genrenamn producerar doorway pages, och
// Googles policy mot "scaled content abuse" träffar precis det.
//
// Bakgrund och urval: marketing-videos/nextwatch/marketing/SEO-PLAN.md.
// Kort version: tillfällesfrågorna ("vad ska vi se ikväll", "vilken film ska vi
// se") är obebodda i svensk sök — SERP:en ger en podd, en Facebook-grupp och en
// badrumsblogg. Tjänstkombinationerna är helt obesatta och är dessutom exakt
// vad appen gör, vilket ingen av streamingtjänsterna själva kan svara på.
//
// Texten är medvetet SVENSK och går inte via next-intl. Sidorna finns för att
// ranka på svenska sökfraser; att lyfta in hundratals marknadsföringssträngar i
// messages/*.json (som check-i18n-keys.mjs sedan kräver i båda språken) hade
// kostat mycket och gett noll. Renderaren sätter lang="sv" på artikeln så att
// en besökare med engelsk nw_lang-cookie ändå taggas rätt.

/** En TMDB-fråga, uttryckt i det appen redan filtrerar på. */
export type TitleQuery = {
  /** Tjänstnamn som de står i PROVIDER_MAP (lib/unifiedRecs.ts). */
  providers?: string[];
  /** TMDB-genre-id:n. */
  genres?: number[];
  /** Genre-id:n som utesluts. */
  withoutGenres?: number[];
  /** Max speltid i minuter. */
  maxRuntime?: number;
  /** Minsta antal röster — utan den fylls listan med okända titlar. */
  minVotes?: number;
  /** Minsta snittbetyg. */
  minRating?: number;
  /** Film eller serie. */
  kind?: "movie" | "tv";
  /** Tidigaste premiärår. */
  fromYear?: number;
};

export type FaqItem = { q: string; a: string };

export type Guide = {
  /** URL-segmentet. */
  slug: string;
  /** Sidans <title>. Skrivs mot sökfrasen, inte mot varumärket. */
  title: string;
  /** <h1> — får skilja sig från title, den ska läsas av en människa. */
  heading: string;
  metaDescription: string;
  /** Sökfrasen sidan siktar på. Bara dokumentation, används inte i renderingen. */
  targetQuery: string;
  /** Kampanjkod i App Store-länken (?ct=). */
  campaign: string;
  /** Två till fyra stycken som svarar på frågan innan listan kommer. */
  intro: string[];
  /** Rubrik över titellistan. */
  listHeading: string;
  /** En mening som förklarar hur listan är filtrerad. */
  listNote: string;
  query: TitleQuery;
  /** Extra avsnitt under listan. Här ligger det som gör sidan unik. */
  sections: { heading: string; body: string[] }[];
  faq: FaqItem[];
  /** Slugs i samma familj att länka till. Bygger den interna matrisen. */
  related: string[];
};

// TMDB-genre-id:n (samma som lib/tmdb.ts använder)
const G = {
  action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80,
  documentary: 99, drama: 18, family: 10751, fantasy: 14, history: 36,
  horror: 27, music: 10402, mystery: 9648, romance: 10749, scifi: 878,
  thriller: 53, war: 10752, western: 37,
} as const;

/* ------------------------------------------------------------------ */
/* /vad-ska-vi-se/<tillfälle>                                          */
/* ------------------------------------------------------------------ */

export const OCCASIONS: Guide[] = [
  {
    slug: "ikvall",
    title: "Vad ska vi se ikväll? Så bestämmer ni på 30 sekunder",
    heading: "Vad ska vi se ikväll?",
    metaDescription:
      "Fastnar ni varje gång? Här är metoden som gör slut på förhandlingen, plus högt betygsatta filmer som funkar för de flesta sällskap ikväll.",
    targetQuery: "vad ska vi se ikväll",
    campaign: "web-ikvall",
    intro: [
      "Frågan kommer varje kväll och den är sällan en fråga om utbud. Ni har fem streamingtjänster och tiotusentals titlar. Problemet är att ni är flera, att ingen vill vara den som bestämmer, och att varje förslag riskerar ett nej som känns som en dom över smaken.",
      "Därför slutar det oftast likadant: tjugo minuter av scrollande, tre avfärdade förslag, och till slut något ni redan sett. Enligt vår erfarenhet är det inte valet som tar tid — det är turordningen. Den som föreslår tar en risk, och den som säger nej slipper.",
      "Lösningen är att ta bort turordningen helt. Om alla svarar ja eller nej samtidigt, utan att se varandras svar, finns ingen att övertala och ingen att göra besviken. Kvar blir bara titlarna alla faktiskt sa ja till.",
    ],
    listHeading: "Filmer som fungerar för de flesta sällskap ikväll",
    listNote:
      "Högt betygsatta filmer med brett tilltal, hämtade från TMDB och uppdaterade dagligen. Betyg är TMDB:s användarsnitt.",
    query: { minVotes: 2000, minRating: 7.2, kind: "movie", withoutGenres: [G.horror, G.documentary] },
    sections: [
      {
        heading: "Tre minuter, tre steg",
        body: [
          "Bestäm först om det är film eller serie. Det är det enda beslutet som är värt att diskutera, för det avgör hur kvällen ser ut — en film är en kväll, ett avsnitt är en vana.",
          "Bestäm sedan vad ni orkar. Det finns ingen poäng i att välja en treglasig europeisk drama en tisdag klockan halv tio. Ambitionsnivån ska matcha klockslaget, inte er självbild.",
          "Swipa sedan, alla samtidigt. Ja eller nej på varje titel, utan att se vad de andra svarar. Första gemensamma ja vinner — och ni får aldrig veta vem som sa nej till vad, vilket är hela poängen.",
        ],
      },
      {
        heading: "Varför den som föreslår alltid förlorar",
        body: [
          "Att föreslå en film är att blotta sin smak. Att säga nej kostar ingenting. Det gör förhandlingen asymmetrisk: den entusiastiska personen bränner sitt kapital på tre förslag och slutar föreslå, och sedan sitter alla tysta och scrollar.",
          "Samtidig blind swipe tar bort asymmetrin. Ingen föreslår, alla svarar. Ett nej är anonymt och kostnadsfritt, och ett ja är ett riktigt ja — inte en eftergift för att få sluta leta.",
        ],
      },
    ],
    faq: [
      {
        q: "Hur väljer man film när man är flera och alla vill olika?",
        a: "Låt alla svara samtidigt i stället för i tur och ordning. När ingen ser de andras svar försvinner både grupptrycket och den sociala kostnaden av att säga nej, och det som blir kvar är titlarna alla oberoende av varandra sa ja till.",
      },
      {
        q: "Hur lång tid tar det att bestämma?",
        a: "Ett tjugotal swipes per person räcker oftast, vilket tar under en minut. Det som brukar dra ut på tiden är inte valet utan turordningen — den försvinner när alla svarar parallellt.",
      },
      {
        q: "Vi har olika streamingtjänster. Hur löser man det?",
        a: "Filtrera på tjänsterna gruppen faktiskt har innan ni börjar. Annars lägger ni tid på titlar som någon ändå inte kommer åt, vilket är den vanligaste orsaken till att en matchning känns som en återvändsgränd.",
      },
    ],
    related: ["fredagsmys", "dejtkvall", "nar-man-inte-orkar-tanka"],
  },
  {
    slug: "fredagsmys",
    title: "Film till fredagsmys — trygga val som ingen protesterar mot",
    heading: "Film till fredagsmys",
    metaDescription:
      "Fredagsmys tål inte en film som kräver koncentration. Här är filmer som funkar med tacos, avbrott och halvt uppmärksamma tittare.",
    targetQuery: "fredagsmys film",
    campaign: "web-fredagsmys",
    intro: [
      "Fredagsmys har en egen kravprofil, och den har mycket lite med filmkvalitet att göra. Filmen ska tåla att någon reser sig efter tacos, att samtalet går i gång i tjugo minuter, och att halva sällskapet kollar mobilen i andra akten.",
      "Det betyder att de flesta av årets kritikerhyllade filmer är fel val. En film som straffar avbrott — långsamt uppbyggd spänning, täta dialoger, en tidslinje som hoppar — blir obegriplig så fort någon tappar tråden, och då slocknar kvällen.",
      "Det ni vill ha är en film med tydlig riktning, generös humor och en handling som går att återuppta. Inte enkel — bara förlåtande.",
    ],
    listHeading: "Filmer som tål avbrott",
    listNote:
      "Komedier och äventyr med högt betyg och brett tilltal. Hämtat från TMDB, uppdateras dagligen.",
    query: { genres: [G.comedy, G.adventure], minVotes: 1500, minRating: 6.8, kind: "movie" },
    sections: [
      {
        heading: "Vad som gör en film fredagsmyssäker",
        body: [
          "Den ska ha en tydlig huvudperson med ett tydligt mål. Då kan vem som helst hoppa in efter tio minuters frånvaro och ändå veta vad som står på spel.",
          "Den ska inte kräva textning för att förstås, om någon i rummet ogillar att läsa. Och den ska vara under två timmar — fredagskvällar har en naturlig utgångstid som ingen bestämt men alla känner.",
          "Undvik det ni ser fram emot mest. Den filmen förtjänar er odelade uppmärksamhet en annan kväll, inte en halv publik och kall ost.",
        ],
      },
      {
        heading: "Om ni är fler än tre",
        body: [
          "Ju fler ni är, desto snabbare faller en förhandling isär — antalet möjliga invändningar växer fortare än antalet personer. Med fem personer räcker det att två har en åsikt för att valet ska låsa sig.",
          "Då är samtidig swipe inte bara bekvämare utan nödvändig. Alla svarar på samma titlar parallellt, och först när tillräckligt många sagt ja på samma film dyker den upp som en matchning.",
        ],
      },
    ],
    faq: [
      {
        q: "Vad är en bra film till fredagsmys?",
        a: "En med tydlig handling, generös humor och en speltid under två timmar. Fredagsmys innebär avbrott, och filmen måste tåla att någon missar fem minuter utan att kvällen är förstörd.",
      },
      {
        q: "Film eller serie på fredagen?",
        a: "Är ni fler än två är film oftast enklare — en serie kräver att alla är lika långt komna, och den förhandlingen är värre än filmvalet. Är ni två och redan mitt i något är serie det självklara.",
      },
    ],
    related: ["ikvall", "nar-man-inte-orkar-tanka", "kompisar"],
  },
  {
    slug: "dejtkvall",
    title: "Film till dejtkvällen — utan att det blir pinsamt",
    heading: "Film till dejtkvällen",
    metaDescription:
      "Filmvalet på en dejt säger mer än man vill. Här är filmer som funkar för två, och en metod för att välja utan att någon måste gissa vad den andra vill.",
    targetQuery: "film för två dejtkväll",
    campaign: "web-dejtkvall",
    intro: [
      "Filmvalet på en dejtkväll bär mer vikt än det borde. Det ska signalera smak utan att skryta, vara tillräckligt engagerande för att slippa tystnad, men inte så krävande att ingen vågar säga något på nittio minuter.",
      "Den vanligaste missen är att välja åt den andra. Man gissar vad hen skulle gilla, gissar fel, och sitter sedan halva filmen och läser av reaktioner i stället för att titta.",
      "Enklare: låt båda svara på samma titlar samtidigt. Ingen behöver gissa, ingen behöver vara artig, och det som blir kvar är något ni båda faktiskt sa ja till.",
    ],
    listHeading: "Filmer som fungerar för två",
    listNote:
      "Högt betygsatta filmer med känsla och driv, utan att bli krävande. TMDB-data, uppdateras dagligen.",
    query: { genres: [G.romance, G.drama, G.comedy], minVotes: 1200, minRating: 7.0, kind: "movie" },
    sections: [
      {
        heading: "Undvik de tre vanliga fällorna",
        body: [
          "Den första är att välja sin egen favoritfilm. Att visa någon en film man älskar är att be om ett omdöme, och det är en tung sak att lägga på en dejt.",
          "Den andra är att välja något för långt. Tre timmar är ett åtagande, inte en kväll, och det stänger dörren för allt annat kvällen kunde ha blivit.",
          "Den tredje är att välja för säkert. En helt neutral film ger inget att prata om efteråt, och samtalet efter filmen är ofta den bättre halvan av kvällen.",
        ],
      },
    ],
    faq: [
      {
        q: "Vilken film ska man se på en dejt?",
        a: "En under två timmar, med tillräckligt mycket handling för att bära tystnaden och tillräckligt mycket innehåll för att ge er något att prata om efteråt. Undvik din egen favoritfilm — den kommer med ett underförstått omdöme.",
      },
      {
        q: "Hur väljer vi utan att det blir en förhandling?",
        a: "Svara på samma titlar samtidigt i stället för att föreslå i tur och ordning. Ingen behöver gissa vad den andra vill, och ingen behöver vara artig mot ett dåligt förslag.",
      },
    ],
    related: ["ikvall", "tva", "fredagsmys"],
  },
  {
    slug: "nar-man-inte-orkar-tanka",
    title: "Film när man inte orkar tänka — lättittat som ändå är bra",
    heading: "Film när man inte orkar tänka",
    metaDescription:
      "Slut på energi men vill ändå se något som inte är dåligt? Högt betygsatta filmer under 100 minuter som inte kräver något av dig.",
    targetQuery: "film när man inte orkar tänka",
    campaign: "web-inte-orkar",
    intro: [
      "Det finns kvällar när hjärnan är slut men man ändå inte vill lägga två timmar på något uselt. Det är en smalare kategori än den låter: lättittat är lätt att hitta, bra är lätt att hitta, men båda samtidigt är förvånansvärt svårt.",
      "Problemet med \"lättittat\" som söksätt är att algoritmerna tolkar det som \"populärt\", och populärt är inte samma sak som kravlöst. En actionfilm kan vara utmattande. En komedi kan kräva att man hänger med i snabb dialog.",
      "Kriteriet du egentligen vill ha är: tydlig handling, rimlig längd, och tillräckligt bra hantverk för att du inte ska ångra dig halvvägs.",
    ],
    listHeading: "Bra filmer under 100 minuter",
    listNote:
      "Filtrerat på speltid under 100 minuter och betyg över 6,8 i TMDB. Uppdateras dagligen.",
    query: { maxRuntime: 100, minVotes: 800, minRating: 6.8, kind: "movie", withoutGenres: [G.documentary] },
    sections: [
      {
        heading: "Varför speltid är rätt filter när orken är slut",
        body: [
          "Genre säger förvånansvärt lite om hur krävande en film är. Speltid säger mycket mer: en film under hundra minuter har sällan tid för sidospår, dubbla tidslinjer eller ett persongalleri som måste hållas i huvudet.",
          "Kortare filmer är dessutom mer förlåtande att avbryta. Somnar du efter en timme har du missat en tredjedel, inte hälften — och tröskeln att ta om den är lägre.",
        ],
      },
    ],
    faq: [
      {
        q: "Vad ska man se när man är trött?",
        a: "Något under hundra minuter med en tydlig huvudperson och ett tydligt mål. Speltid är ett bättre filter än genre — korta filmer har sällan sidospår eller tidslinjer att hålla reda på.",
      },
      {
        q: "Finns det bra filmer som är korta?",
        a: "Gott om dem. Listan ovan filtrerar på under hundra minuter och betyg över 6,8 i TMDB, vilket sållar bort både det utdragna och det slarviga.",
      },
    ],
    related: ["ikvall", "fredagsmys"],
  },
];

/* ------------------------------------------------------------------ */
/* /film-for/<sällskap>                                                */
/* ------------------------------------------------------------------ */

export const COMPANIONS: Guide[] = [
  {
    slug: "kompisar",
    title: "Film att se med kompisar — val som håller för ett helt gäng",
    heading: "Film att se med kompisar",
    metaDescription:
      "Ju fler ni är, desto svårare blir valet. Filmer som fungerar i grupp, och en metod som skalar bättre än att alla ropar förslag.",
    targetQuery: "film att se med kompisar",
    campaign: "web-kompisar",
    intro: [
      "Ett filmval med fyra kompisar är inte fyra gånger svårare än med en — det är värre än så. Varje ny person lägger till sina invändningar, och antalet sätt att inte komma överens växer snabbare än antalet personer i rummet.",
      "Därför landar gänget nästan alltid på samma två utvägar: den mest högljudda bestämmer, eller så blir det något alla redan sett för att det är det enda ingen protesterar mot. Båda är förluster, den andra bara tystare.",
      "Det som faktiskt fungerar i grupp är att sluta förhandla och börja rösta — parallellt, och utan att se varandras röster.",
    ],
    listHeading: "Filmer som fungerar i gäng",
    listNote:
      "Action, komedi och äventyr med brett tilltal och högt betyg. Hämtat från TMDB, uppdateras dagligen.",
    query: { genres: [G.action, G.comedy, G.adventure], minVotes: 3000, minRating: 6.9, kind: "movie" },
    sections: [
      {
        heading: "Varför gruppval spårar ur",
        body: [
          "I ett gäng är ett nej gratis och ett ja förpliktigande. Den som säger nej behöver inte motivera sig; den som säger ja har lånat ut sin trovärdighet till valet och får skulden om filmen är dålig.",
          "Resultatet är förutsägbart: efter tre avfärdade förslag slutar folk föreslå, och kvällen glider över i att scrolla i tystnad tills någon ger upp och sätter på något ni sett förut.",
          "Anonym, samtidig röstning vänder på det. Ett ja kostar inget socialt när ingen ser vem som gav det, och en matchning tillhör alla i stället för den som föreslog.",
        ],
      },
      {
        heading: "Sätt tjänsterna först",
        body: [
          "Med fem personer i ett gäng är chansen stor att ni tillsammans har fyra eller fem streamingtjänster, men att ingen enskild har alla. Att välja film innan ni vet vad som faktiskt går att se är en säker väg till en matchning som ingen kan spela upp.",
          "Börja därför med att slå ihop gruppens tjänster till en gemensam lista, och filtrera bort allt annat innan ni ens börjar titta på titlar.",
        ],
      },
    ],
    faq: [
      {
        q: "Hur väljer man film i en stor grupp?",
        a: "Låt alla rösta samtidigt och anonymt på samma titlar i stället för att föreslå i tur och ordning. En förhandling blir exponentiellt svårare med antalet personer; en parallell omröstning gör det inte.",
      },
      {
        q: "Vad gör man när vi har olika streamingtjänster?",
        a: "Slå ihop gruppens tjänster och filtrera på hela uppsättningen. Annars riskerar ni att enas om en titel som bara en av er faktiskt kommer åt.",
      },
    ],
    related: ["tva", "familjen", "fredagsmys"],
  },
  {
    slug: "tva",
    title: "Film för två — när ni har olika smak",
    heading: "Film för två",
    metaDescription:
      "Hen vill ha action, du vill ha drama. Så hittar ni något ni båda faktiskt vill se, i stället för något ingen valde.",
    targetQuery: "film för två olika smak",
    campaign: "web-tva",
    intro: [
      "Två personer med olika smak hamnar sällan i en rak konflikt. De hamnar i en artighetsspiral: du föreslår något du tror att hen vill se, hen säger ja för att vara vänlig, och ni ser en film ingen av er egentligen valde.",
      "Den filmen är värre än en oenighet. En oenighet går att lösa. En artighetskompromiss ger en kväll där båda är milt besvikna och ingen vet varför.",
      "Det som saknas är ett sätt att säga vad man faktiskt vill utan att det blir ett krav på den andra.",
    ],
    listHeading: "Filmer som brukar överbrygga smakskillnader",
    listNote:
      "Filmer med både driv och känsla, högt betygsatta i TMDB. Uppdateras dagligen.",
    query: { genres: [G.drama, G.thriller, G.comedy], minVotes: 2000, minRating: 7.1, kind: "movie" },
    sections: [
      {
        heading: "Skärningen är oftast större än ni tror",
        body: [
          "\"Vi har helt olika smak\" stämmer nästan aldrig när man mäter det. Två personer som beskriver sig som motsatser brukar ha ett tydligt gemensamt fält — det är bara osynligt, eftersom ingen av dem föreslår något utanför sin egen självbild.",
          "Du föreslår drama för att du ser dig som en som gillar drama. Hen föreslår action av samma skäl. Ingen av er föreslår thrillern ni båda hade sagt ja till, för den tillhör ingens identitet.",
          "En blind ja/nej-runda hittar det fältet, just för att den kringgår självbilden. Ni svarar på titlar, inte på genretillhörighet.",
        ],
      },
    ],
    faq: [
      {
        q: "Vi har helt olika filmsmak. Går det att lösa?",
        a: "Nästan alltid. Överlappet mellan två personers smak är i regel större än båda tror — det är bara osynligt, eftersom ingen föreslår något utanför sin egen självbild. En blind ja/nej-runda hittar den gemensamma ytan.",
      },
      {
        q: "Hur undviker vi att alltid se hens val?",
        a: "Sluta föreslå åt varandra. När båda svarar på samma titlar samtidigt och ingen ser den andras svar finns inget utrymme för artighet, och ingen behöver ge efter för att slippa en diskussion.",
      },
    ],
    related: ["dejtkvall", "kompisar", "ikvall"],
  },
  {
    slug: "familjen",
    title: "Film för hela familjen — som faktiskt fungerar för alla åldrar",
    heading: "Film för hela familjen",
    metaDescription:
      "En sjuåring och en fjortonåring vill sällan samma sak. Familjefilmer med högt betyg, och ett sätt att välja där alla får vara med.",
    targetQuery: "familjefilm hela familjen",
    campaign: "web-familjen",
    intro: [
      "Familjefilm är den svåraste kategorin, för spannet är störst. En sjuåring, en fjortonåring och två vuxna ska hitta något som varken är för barnsligt eller för mycket, och de tre kraven drar åt olika håll.",
      "Det vanliga utfallet är att den yngsta får bestämma, eftersom den yngsta protesterar högst. Det ger en kväll där de äldre halvt tittar och halvt sitter med mobilen, vilket gör hela poängen med att se något tillsammans meningslös.",
      "Det som brukar fungera är filmer med dubbla lager — tydliga nog för barnen, med tillräckligt mycket under ytan för att hålla de vuxna kvar.",
    ],
    listHeading: "Familjefilmer med högt betyg",
    listNote:
      "Familj och animerat, filtrerat på högt betyg och brett genomslag i TMDB. Uppdateras dagligen.",
    query: { genres: [G.family, G.animation], minVotes: 2000, minRating: 7.0, kind: "movie" },
    sections: [
      {
        heading: "Låt även de yngsta rösta",
        body: [
          "Ett barn som fått vara med och välja sitter kvar genom hela filmen. Ett barn som blivit överkört börjar förhandla om något annat efter tjugo minuter, och då är kvällen slut oavsett vad som står på skärmen.",
          "Det behöver inte betyda att barnet bestämmer. Det betyder att barnets ja räknas lika mycket som allas andra — och att en titel behöver flera ja för att bli en matchning.",
        ],
      },
      {
        heading: "Åldersgränser i praktiken",
        body: [
          "En rekommenderad åldersgräns är satt för den yngsta rimliga tittaren, inte för genomsnittet i rummet. Har ni stor spridning i åldrar är det den yngsta som sätter taket, inte majoriteten.",
          "NextWatch tillämpar den svenska åldersgränsen efter gruppens yngsta medlem, så att en titel som inte passar aldrig dyker upp som en matchning från början.",
        ],
      },
    ],
    faq: [
      {
        q: "Vad kan hela familjen se tillsammans?",
        a: "Filmer med dubbla lager — tydliga nog för de yngsta, med tillräckligt mycket under ytan för att hålla vuxna kvar. Listan ovan filtrerar på familj och animerat med betyg över 7,0 i TMDB.",
      },
      {
        q: "Hur gör man när barnen vill olika?",
        a: "Låt alla rösta, även de yngsta, och kräv flera ja för att en titel ska räknas som vald. Ett barn som fått vara med och bestämma sitter kvar genom filmen; ett överkört barn förhandlar om något annat efter tjugo minuter.",
      },
    ],
    related: ["kompisar", "fredagsmys"],
  },
];

/* ------------------------------------------------------------------ */
/* /vad-kan-vi-se/<tjänst>-och-<tjänst>                                */
/*                                                                     */
/* Den här sidtypen är planens viktigaste: ingen konkurrent adresserar  */
/* tvärtjänstfrågan, och streamingtjänsterna kan definitionsmässigt     */
/* inte svara på den eftersom de bara känner sin egen katalog.          */
/* ------------------------------------------------------------------ */

export const COMBINATIONS: Guide[] = [
  {
    slug: "netflix-och-viaplay",
    title: "Vad kan vi se om vi har Netflix och Viaplay?",
    heading: "Netflix + Viaplay",
    metaDescription:
      "Du har Netflix, hen har Viaplay. Här är vad ni faktiskt kan se tillsammans — och hur ni hittar det utan att byta flik fyra gånger.",
    targetQuery: "vad kan vi se om vi har netflix och viaplay",
    campaign: "web-netflix-viaplay",
    intro: [
      "Den vanligaste svenska streamingkombinationen är också en av de mest olikartade: Netflix stora internationella katalog mot Viaplays nordiska produktioner och sport. Ni har tillsammans mer än nog att se, och ändå tar valet längre tid än om ni bara haft en tjänst.",
      "Orsaken är att ingen av apparna vet om den andra. Netflix rekommenderar ur Netflix, Viaplay ur Viaplay, och ni får aldrig se en lista där båda katalogerna ligger sida vid sida. Så ni byter flik, tappar tråden och börjar om.",
      "Listan nedan gör det ingen av tjänsterna kan göra: slår ihop båda katalogerna i en vy.",
    ],
    listHeading: "Vad som går att se på Netflix och Viaplay just nu",
    listNote:
      "Titlar som finns på minst en av tjänsterna i Sverige, aktuella just nu och med minst 7,0 i TMDB-betyg. Uppdateras dagligen.",
    query: { providers: ["netflix", "viaplay"], minVotes: 1500, minRating: 7.0, kind: "movie" },
    sections: [
      {
        heading: "Vad kombinationen är stark på",
        body: [
          "Netflix bär bredden: internationella serier, egna produktioner och ett stort utbud av komedi och dokumentär. Viaplay bär det nordiska — svensk och dansk kriminaldrama, och en katalog av filmer som sällan når de amerikanska tjänsterna.",
          "Det gör kombinationen ovanligt bra för kvällar där ni vill ha något svenskt eller nordiskt, men inte vill begränsa er till det.",
        ],
      },
      {
        heading: "Ett filter i stället för två appar",
        body: [
          "Poängen med att filtrera på flera tjänster samtidigt är inte att spara klick. Det är att ni slipper välja tjänst innan ni väljer film — ett beslut som inte betyder något för er men som strukturerar hela kvällen så fort ni öppnar en av apparna.",
          "I NextWatch anger var och en sina tjänster en gång. Därefter visas bara titlar som någon i sällskapet faktiskt kommer åt.",
        ],
      },
    ],
    faq: [
      {
        q: "Kan man söka i Netflix och Viaplay samtidigt?",
        a: "Inte inuti tjänsterna — de känner bara sin egen katalog. Du behöver en tjänsteoberoende app eller sajt som slår ihop katalogerna, vilket är precis vad listan ovan gör.",
      },
      {
        q: "Vad kan vi se om bara en av oss har Viaplay?",
        a: "Allt som finns på någon av era tjänster, förutsatt att ni ser filmen tillsammans hos den som har prenumerationen. NextWatch slår ihop gruppens tjänster till en gemensam lista just av det skälet.",
      },
    ],
    related: ["netflix-och-disney-plus", "viaplay-och-max", "ikvall"],
  },
  {
    slug: "netflix-och-disney-plus",
    title: "Vad kan vi se om vi har Netflix och Disney+?",
    heading: "Netflix + Disney+",
    metaDescription:
      "Netflix bredd och Disney+ familjekatalog i en lista. Vad ni faktiskt kan se tillsammans, sorterat på betyg och uppdaterat dagligen.",
    targetQuery: "vad kan vi se om vi har netflix och disney plus",
    campaign: "web-netflix-disney",
    intro: [
      "Netflix och Disney+ är den vanligaste kombinationen i svenska barnfamiljer, och den täcker två helt olika behov: Disney+ löser eftermiddagen, Netflix löser kvällen.",
      "Problemet uppstår mitt emellan — när hela familjen ska se något tillsammans. Då är Disney+ ofta för ungt och Netflix ofta för vuxet, och att jämföra dem kräver att någon byter app fyra gånger medan resten tappar tålamodet.",
      "Listan nedan lägger båda katalogerna i samma vy, sorterad på betyg i stället för på vad respektive tjänst vill marknadsföra just nu.",
    ],
    listHeading: "Vad som går att se på Netflix och Disney+ just nu",
    listNote:
      "Titlar på minst en av tjänsterna i Sverige, aktuella just nu och med minst 7,0 i TMDB-betyg. Uppdateras dagligen.",
    query: { providers: ["netflix", "disney+"], minVotes: 1500, minRating: 7.0, kind: "movie" },
    sections: [
      {
        heading: "Kombinationens styrka är spannet",
        body: [
          "Disney+ har med Pixar, Marvel och Star Wars en ovanligt djup katalog av filmer som fungerar för flera åldrar samtidigt — den svåraste kategorin att hitta i. Netflix har bredden som gör att de vuxna har något att se när barnen har somnat.",
          "Tillsammans täcker de alltså både familjekvällen och kvällen efter, vilket få andra par av tjänster gör lika bra.",
        ],
      },
    ],
    faq: [
      {
        q: "Räcker Netflix och Disney+ för en barnfamilj?",
        a: "För de flesta, ja. Disney+ täcker de yngre åldrarna djupare än någon annan tjänst, och Netflix täcker resten. Det som saknas är nordiskt utbud och sport.",
      },
      {
        q: "Hur ser vi vad som finns på båda utan att byta app?",
        a: "Använd en tjänsteoberoende lista som filtrerar på båda samtidigt. Tjänsterna själva kan inte visa varandras katalog.",
      },
    ],
    related: ["netflix-och-viaplay", "familjen", "ikvall"],
  },
  {
    slug: "viaplay-och-max",
    title: "Vad kan vi se om vi har Viaplay och Max?",
    heading: "Viaplay + Max",
    metaDescription:
      "Nordisk drama och HBO:s katalog i samma lista. Vad ni kan se med Viaplay och Max tillsammans, sorterat på betyg.",
    targetQuery: "vad kan vi se om vi har viaplay och max",
    campaign: "web-viaplay-max",
    intro: [
      "Viaplay och Max är kombinationen för den som tar tv-serier på allvar. Max bär HBO:s katalog — några av de mest kritikerhyllade serierna som gjorts — och Viaplay bär det nordiska, plus sporten.",
      "Det är också en kombination där rekommendationerna inne i tjänsterna hjälper minst. Båda har starka egna profiler och pushar hårt sitt eget nya, vilket gör att den bästa titeln för just er kväll ofta ligger tre skärmar ner i båda apparna.",
      "En gemensam lista sorterad på betyg i stället för på kampanj löser det.",
    ],
    listHeading: "Vad som går att se på Viaplay och Max just nu",
    listNote:
      "Titlar på minst en av tjänsterna i Sverige, aktuella just nu och med minst 7,0 i TMDB-betyg. Uppdateras dagligen.",
    query: { providers: ["viaplay", "max"], minVotes: 1000, minRating: 7.0, kind: "movie" },
    sections: [
      {
        heading: "Två kataloger som knappt överlappar",
        body: [
          "Till skillnad från de stora amerikanska tjänsterna, som konkurrerar om samma licensierade titlar, har Viaplay och Max väldigt lite gemensamt. Det gör kombinationen ovanligt effektiv — ni betalar sällan två gånger för samma sak.",
          "Baksidan är att valet blir svårare, inte lättare: två distinkta kataloger utan överlapp innebär två helt separata utbud att hålla i huvudet.",
        ],
      },
    ],
    faq: [
      {
        q: "Överlappar Viaplay och Max?",
        a: "Mycket lite. Max bär HBO:s egna produktioner och Viaplay det nordiska plus sport, så ni betalar sällan två gånger för samma titel.",
      },
      {
        q: "Vilken är bäst för serier?",
        a: "Max har den tyngre katalogen av prestigeserier; Viaplay har nordisk kriminaldrama som inte finns någon annanstans. Vilken som är bäst beror helt på kvällen — vilket är skälet att titta på båda i samma lista.",
      },
    ],
    related: ["netflix-och-viaplay", "netflix-och-disney-plus", "kompisar"],
  },
];

export const ALL_GUIDES = [...OCCASIONS, ...COMPANIONS, ...COMBINATIONS];

/** Sökväg för en guide, oavsett familj. */
export function guidePath(slug: string): string {
  if (OCCASIONS.some((g) => g.slug === slug)) return `/vad-ska-vi-se/${slug}`;
  if (COMPANIONS.some((g) => g.slug === slug)) return `/film-for/${slug}`;
  if (COMBINATIONS.some((g) => g.slug === slug)) return `/vad-kan-vi-se/${slug}`;
  return "/";
}

export function findGuide(slug: string): Guide | undefined {
  return ALL_GUIDES.find((g) => g.slug === slug);
}
