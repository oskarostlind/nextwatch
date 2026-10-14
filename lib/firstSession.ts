"use client";

// lib/firstSession.ts — "nya flödet" (2026-10-15): den första sessionen för en
// NY enhet som en enkel stegmaskin. Spec + vem som äger vad: docs/nya-flodet.md.
//
//   deck ──(10 swipes)──▶ ai ──▶ save ──▶ paywall* ──▶ push ──▶ invite ──▶ done
//   * paywall bara för A/B-varianten "paywall" och bara om användaren inte redan är premium.
//
// Leken (app/swipe/page_client.tsx) rapporterar swipes med recordFsSwipe().
// Varje ark/kort (app/components/firstSession/*) läser useFirstSession() och
// kallar advanceFs(<sitt steg>) när det är klart eller stängs. Inget här får
// påverka befintliga användare: bara enheter som markerats eligible (nya
// enheter sedan lanseringen) går igenom flödet.
//
// Per enhet i localStorage, best effort (privat läge → flödet hoppas över).

import { useSyncExternalStore } from "react";

export type FsStep = "deck" | "ai" | "save" | "paywall" | "push" | "invite" | "done";
export type FsLike = { tmdbId: number; mediaType: "movie" | "tv"; title: string; poster?: string | null };
export type FsState = {
  step: FsStep;
  swipes: number;
  likes: FsLike[];
  eligible: boolean;
  /** A/B: "paywall" visar den mjuka betalväggen efter spara, "control" hoppar över den. */
  variant: "paywall" | "control";
  startedAt: number;
};

export const FS_EVENT = "nw:first-session";
export const AI_REVEAL_AT = 10;
const KEY = "nw_fs_v1";
const ORDER: FsStep[] = ["deck", "ai", "save", "paywall", "push", "invite", "done"];

const EMPTY: FsState = { step: "done", swipes: 0, likes: [], eligible: false, variant: "control", startedAt: 0 };
let cache: FsState | null = null;

function read(): FsState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    cache = raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<FsState>) } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: FsState): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* privat läge */
  }
  try {
    window.dispatchEvent(new Event(FS_EVENT));
  } catch {
    /* SSR */
  }
}

export function getFs(): FsState {
  if (typeof window === "undefined") return EMPTY;
  return read();
}

/**
 * Markera enheten som ny (anropas en gång av den som skapar gästprofilen /
 * kallstarten). En enhet som redan har ett tillstånd rörs inte.
 */
export function startFirstSession(): void {
  if (typeof window === "undefined") return;
  const cur = read();
  if (cur.eligible || cur.startedAt) return;
  const variant: FsState["variant"] = Math.random() < 0.5 ? "paywall" : "control";
  write({ step: "deck", swipes: 0, likes: [], eligible: true, variant, startedAt: Date.now() });
}

/** Leken rapporterar varje swipe (solo). Vid AI_REVEAL_AT går flödet till "ai". */
export function recordFsSwipe(like: FsLike | null): void {
  const cur = getFs();
  if (!cur.eligible || cur.step !== "deck") return;
  const swipes = cur.swipes + 1;
  const likes = like ? [...cur.likes, like].slice(-20) : cur.likes;
  write({ ...cur, swipes, likes, step: swipes >= AI_REVEAL_AT ? "ai" : "deck" });
}

/**
 * Gå vidare från `from`. Anropas av steget självt när det är klart (eller
 * stängs). `isPremium` gör att betalväggen hoppas över.
 */
export function advanceFs(from: FsStep, opts?: { isPremium?: boolean }): void {
  const cur = getFs();
  if (!cur.eligible || cur.step !== from) return;
  let i = ORDER.indexOf(from) + 1;
  while (ORDER[i] === "paywall" && (cur.variant !== "paywall" || opts?.isPremium)) i++;
  write({ ...cur, step: ORDER[Math.min(i, ORDER.length - 1)] });
}

/** Avsluta flödet direkt (t.ex. inloggning på befintligt konto). */
export function endFirstSession(): void {
  const cur = getFs();
  if (!cur.eligible) return;
  write({ ...cur, step: "done" });
}

function subscribe(cb: () => void): () => void {
  const on = () => cb();
  window.addEventListener(FS_EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(FS_EVENT, on);
    window.removeEventListener("storage", on);
  };
}

export function useFirstSession(): FsState {
  return useSyncExternalStore(subscribe, getFs, () => EMPTY);
}
