// lib/funnelSteps.ts — stegen i första-besöks-tratten, i den ordning en ny
// användare möter dem, med etiketter för /admin. Namnen skickas av
// funnel(...)-anropen i appen (lib/funnel.ts) — byt aldrig namn på ett steg
// utan att byta här, annars försvinner historiken ur vyn.

export type FunnelStepDef = { name: string; label: string; indent?: boolean };
export type FunnelGroup = { title: string; hint?: string; steps: FunnelStepDef[] };

export const FUNNEL_GROUPS: FunnelGroup[] = [
  {
    title: "Start",
    steps: [
      { name: "first_open", label: "Öppnade appen/sajten första gången" },
      { name: "landing_view", label: "Såg startsidan" },
      { name: "hero_swipe", label: "Swipade på startsidans demokort", indent: true },
      { name: "hero_gate", label: "Nådde ”skapa konto”-kortet", indent: true },
    ],
  },
  {
    title: "Konto & onboarding",
    steps: [
      { name: "cta_signup", label: "Tryckte ”Skapa konto”" },
      { name: "cta_guest", label: "Tryckte ”Fortsätt som gäst”" },
      { name: "guest_created", label: "Gästprofil skapad", indent: true },
      { name: "onboarding_step_1", label: "Onboarding steg 1 (namn, ålder, villkor)" },
      { name: "onboarding_step_2", label: "Onboarding steg 2", indent: true },
      { name: "onboarding_step_3", label: "Onboarding steg 3", indent: true },
      { name: "onboarding_step_4", label: "Onboarding steg 4", indent: true },
      { name: "onboarding_done", label: "Onboarding klar", indent: true },
      { name: "signup_apple", label: "Loggade in med Apple" },
      { name: "signup_email", label: "Registrerade med e-post" },
    ],
  },
  {
    title: "Innan första kortet",
    hint: "Allt som dyker upp mellan att swipen öppnas och att man kan börja swipa.",
    steps: [
      { name: "swipe_view", label: "Kom till swipen" },
      { name: "consent_form", label: "Fick GDPR-samtycket (iOS, AdMob)" },
      { name: "consent_done", label: "…klickade sig igenom", indent: true },
      { name: "att_prompt", label: "Fick ATT-frågan ”Tillåt spårning?” (iOS)" },
      { name: "att_allowed", label: "…tillät", indent: true },
      { name: "att_denied", label: "…nekade", indent: true },
      { name: "push_softask", label: "Fick push-frågan" },
      { name: "push_softask_yes", label: "…tryckte Ja", indent: true },
      { name: "push_softask_later", label: "…tryckte Senare", indent: true },
      { name: "push_granted", label: "…tillät i iOS-dialogen", indent: true },
      { name: "tour_shown", label: "Gestguiden visades" },
      { name: "tour_completed", label: "…gick igenom den", indent: true },
      { name: "tour_skipped", label: "…hoppade över", indent: true },
    ],
  },
  {
    title: "Swipen",
    steps: [
      { name: "deck_ready", label: "Första riktiga kortet visades" },
      { name: "deck_error", label: "Fel när korten laddades", indent: true },
      { name: "deck_empty", label: "Tom kortlek", indent: true },
      { name: "swipe_1", label: "1 swipe" },
      { name: "swipe_3", label: "3 swipes" },
      { name: "swipe_5", label: "5 swipes" },
      { name: "swipe_10", label: "10 swipes" },
      { name: "swipe_25", label: "25 swipes" },
      { name: "swipe_50", label: "50 swipes" },
      { name: "swipe_100", label: "100 swipes" },
      { name: "like_1", label: "Första ”gilla”" },
    ],
  },
  {
    title: "Avbrott under swipen",
    steps: [
      { name: "provider_prompt", label: "Fick frågan om streamingtjänster" },
      { name: "provider_saved", label: "…valde tjänster", indent: true },
      { name: "provider_dismissed", label: "…stängde", indent: true },
      { name: "signup_nudge_watchlist", label: "Fick ”skapa konto” efter 3 gilla" },
      { name: "signup_nudge_swipes", label: "Fick ”skapa konto” efter 25 swipes" },
      { name: "ad_card", label: "Såg ett annonskort (webb)" },
      { name: "ad_interstitial", label: "Såg en helskärmsannons (iOS)" },
      { name: "limit_wall", label: "Slog i swipe-taket" },
    ],
  },
  {
    title: "Resten av appen",
    steps: [
      { name: "view:watchlist", label: "Öppnade bevakningslistan" },
      { name: "view:group", label: "Öppnade grupper" },
      { name: "view:discover", label: "Öppnade upptäck" },
      { name: "view:profile", label: "Öppnade profilen" },
      { name: "view:premium", label: "Öppnade premium" },
    ],
  },
  {
    title: "Kom tillbaka",
    steps: [{ name: "return_visit", label: "Öppnade appen igen en annan dag" }],
  },
];

const LABELS = new Map(FUNNEL_GROUPS.flatMap((g) => g.steps.map((s) => [s.name, s.label] as const)));

export const ALL_FUNNEL_STEPS = FUNNEL_GROUPS.flatMap((g) => g.steps.map((s) => s.name));

/** Etikett för ett stegnamn (även okända/view:-steg). */
export function funnelLabel(name: string | null | undefined): string {
  if (!name) return "Inget steg alls";
  const l = LABELS.get(name);
  if (l) return l.replace(/^…/, "");
  if (name.startsWith("view:")) return `Öppnade ${name.slice(5)}`;
  if (name.startsWith("onboarding_step_")) return `Onboarding steg ${name.slice(16)}`;
  return name;
}

/** Skärm-etikett för exit-platsen (FunnelTracker.section). */
export function screenLabel(at: string | null | undefined): string {
  switch (at) {
    case "start":
      return "Startsidan";
    case "swipe":
      return "Swipen";
    case "onboarding":
      return "Onboarding";
    case "watchlist":
      return "Bevakningslistan";
    case "profile":
      return "Profilen";
    case "premium":
      return "Premium";
    case null:
    case undefined:
    case "":
      return "Okänt";
    default:
      return at;
  }
}
