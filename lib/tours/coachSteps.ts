import type { CoachTourStep } from "./types";

export const FRIENDS_TOUR_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "friends-add",
    target: "friends-add",
    title: "Lägg till vänner",
    body: "Sök på användarnamn här och skicka en vänförfrågan.",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "friends-requests",
    target: "friends-requests",
    title: "Förfrågningar",
    body: "Inkommande vänförfrågningar dyker upp här — acceptera eller avvisa dem.",
    placement: "top",
  },
  {
    mode: "coach",
    id: "friends-list",
    target: "friends-list",
    title: "Det här låser vänner upp",
    body: "Bjud in vänner till en grupp för att swipa tillsammans, eller tipsa dem om filmer och serier.",
    placement: "top",
  },
];

export const GROUPS_TOUR_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "group-join-create",
    target: "group-join-create",
    title: "Skapa eller gå med",
    body: "Skapa en ny grupp och dela koden, eller gå med i en vän grupps kod.",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "group-invite",
    target: "group-invite",
    title: "Bjud in vänner",
    body: "Lägg till vänner i gruppen så kan ni swipa tillsammans.",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "group-settings",
    target: "group-settings",
    title: "Inställningar",
    body: "Ställ in vilka genrer ni swipar på och hur många som behöver gilla en titel för match.",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "group-start-swipe",
    target: "group-start-swipe",
    title: "Swipa tillsammans",
    body: "Starta gruppswipen — ni röstar tillsammans tills tillräckligt många gillar samma titel.",
    placement: "bottom",
  },
];

export const WATCHLIST_TOUR_STEPS: CoachTourStep[] = [
  {
    mode: "coach",
    id: "watchlist-intro",
    target: "watchlist-tabs",
    title: "Din watchlist",
    body: "Titlar du gillar i swipen samlas under Watchlist. Betyg-fliken visar allt du redan sett och betygsatt.",
    placement: "bottom",
  },
  {
    mode: "coach",
    id: "watchlist-grid",
    target: "watchlist-grid",
    title: "Så hamnar titlar här",
    body: "Swipa höger på en titel du vill se, så sparas den automatiskt i den här listan.",
    placement: "top",
  },
  {
    mode: "coach",
    id: "watchlist-rate",
    title: "Betygsätt det du sett",
    body: "Tryck på en titel och välj Betygsätt — då flyttas den till Betyg-fliken med ditt betyg.",
    placement: "center",
  },
  {
    mode: "coach",
    id: "watchlist-watch",
    title: "Kolla nu",
    body: "Öppna en titel och tryck Kolla nu för att gå direkt till streamingtjänsten du har den på.",
    placement: "center",
  },
];
