export type GuideStep = {
  /** data-guide-attribut utan hakparenteser, t.ex. "swipe-card" */
  target?: string;
  title: string;
  body: string;
  placement?: "top" | "bottom" | "center";
};

export const SWIPE_GUIDE_STEPS: GuideStep[] = [
  {
    title: "Välkommen till NextWatch",
    body: "Här får du rekommendationer anpassade efter din smak. Swipa för att hitta nästa titel att titta på.",
    placement: "center",
  },
  {
    target: "swipe-card",
    title: "Gilla",
    body: "Dra kortet åt höger för att gilla — titeln sparas i din watchlist.",
    placement: "bottom",
  },
  {
    target: "swipe-card",
    title: "Nope",
    body: "Dra åt vänster om titeln inte känns rätt. Den döljs en tid så du slipper se den igen.",
    placement: "bottom",
  },
  {
    target: "swipe-card",
    title: "Sett",
    body: "Dra uppåt om du redan sett titeln. Du kan betygsätta den efteråt.",
    placement: "bottom",
  },
  {
    target: "swipe-card",
    title: "Mer info",
    body: "Tryck på kortet för att vända det och läsa mer om filmen eller serien.",
    placement: "bottom",
  },
  {
    target: "action-dock",
    title: "Knapparna",
    body: "Eller använd knapparna: Nej, Info, Ångra och Gilla.",
    placement: "top",
  },
];

export const NAV_GUIDE_STEPS: GuideStep[] = [
  {
    target: "nav-swipe",
    title: "Rekommendationer",
    body: "Din personliga swipe-feed med filmer och serier.",
    placement: "top",
  },
  {
    target: "nav-group",
    title: "Grupp & vänner",
    body: "Skapa eller gå med i en grupp och lägg till vänner.",
    placement: "top",
  },
  {
    target: "nav-discover",
    title: "Discover",
    body: "Bläddra och filtrera titlar efter genre och typ.",
    placement: "top",
  },
  {
    target: "nav-watchlist",
    title: "Watchlist",
    body: "Allt du gillat och dina betyg samlade på ett ställe.",
    placement: "top",
  },
  {
    target: "nav-profile",
    title: "Profil",
    body: "Inställningar, tjänster och ditt konto.",
    placement: "top",
  },
];

export const GROUP_GUIDE_STEPS: GuideStep[] = [
  {
    target: "group-tabs",
    title: "Grupp eller vänner",
    body: "Växla mellan gruppswiping och att hitta vänner.",
    placement: "bottom",
  },
  {
    target: "group-create-join",
    title: "Skapa eller gå med",
    body: "Skapa en ny grupp eller gå med med en kod du fått av en vän.",
    placement: "bottom",
  },
  {
    target: "group-start-swipe",
    title: "Gruppswipe",
    body: "När ni är i en grupp — starta gruppswipe här. Ni röstar tillsammans tills ni matchar.",
    placement: "bottom",
  },
  {
    target: "friends-search",
    title: "Lägg till vänner",
    body: "Sök på användarnamn och skicka en vänförfrågan.",
    placement: "bottom",
  },
];
