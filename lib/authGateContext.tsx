"use client";

// Delad "är appen redo att visa rätt förstaskärm?"-status.
//
// Problemet den löser: på landningen ("/") vet vi inte förrän ett klientanrop
// svarat om besökaren egentligen är inloggad (SSR:en kan ha missat cookien vid
// kallstart i WKWebView, se SessionPersistence.tsx). Tills dess ska varken
// inloggningsvyn (HeroDeck) eller den native launch-skärmen försvinna — se
// AuthGate.tsx (skriver `ready`) och SplashScreenHide.tsx (läser `ready`).
//
// Alla andra sidor har inget att vänta på: AppShell sätter `initiallyReady`
// till true för dem direkt vid första rendering, så de beter sig precis som
// innan den här ändringen.

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type AuthGateState = {
  ready: boolean;
  markReady: () => void;
};

const AuthGateContext = createContext<AuthGateState | null>(null);

export function AuthGateProvider({
  children,
  initiallyReady,
}: {
  children: ReactNode;
  initiallyReady: boolean;
}) {
  const [ready, setReady] = useState(initiallyReady);
  const markReady = useCallback(() => setReady(true), []);

  return (
    <AuthGateContext.Provider value={{ ready, markReady }}>{children}</AuthGateContext.Provider>
  );
}

/** Utanför providern (borde inte hända) — fail-open till "redo". */
export function useAuthGate(): AuthGateState {
  const ctx = useContext(AuthGateContext);
  if (!ctx) return { ready: true, markReady: () => {} };
  return ctx;
}
