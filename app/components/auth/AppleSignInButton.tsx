"use client";

import * as React from "react";
import { Capacitor } from "@capacitor/core";
import { useTranslations } from "next-intl";

export default function AppleSignInButton({ disabled = false }: { disabled?: boolean } = {}) {
  const t = useTranslations("auth");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onAppleSignIn() {
    setLoading(true);
    setError(null);

    try {
      if (Capacitor.getPlatform() !== "ios") {
        setError(t("appleIosOnly"));
        return;
      }

      const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
      const result = await SignInWithApple.authorize({
        clientId: "com.nextwatch.app",
        redirectURI: `${window.location.origin}/api/auth/apple/callback`,
        scopes: "email name",
      });

      const identityToken = result.response?.identityToken;
      if (!identityToken) {
        setError("Apple gav ingen identitetstoken.");
        return;
      }

      // Namn/e-post levereras av AuthenticationServices ENBART vid den allra
      // första auktoriseringen — därefter är fälten tomma för alltid. Apple
      // kräver (guideline 4) att vi tar emot dem här i stället för att be
      // användaren skriva in dem igen, så de skickas med till servern direkt.
      const identity = result.response as {
        givenName?: string | null;
        familyName?: string | null;
        email?: string | null;
        authorizationCode?: string | null;
      };

      const res = await fetch("/api/auth/apple", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          identityToken,
          givenName: identity.givenName ?? null,
          familyName: identity.familyName ?? null,
          email: identity.email ?? null,
          // Behövs för att kunna återkalla kopplingen vid kontoradering
          // (Apple TN3194) — servern byter den mot ett refresh token.
          authorizationCode: identity.authorizationCode ?? null,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        redirect?: string;
      };

      if (!res.ok || !data.ok) {
        setError(data.message ?? "Apple-inloggning misslyckades");
        return;
      }

      window.location.href = data.redirect ?? "/swipe";
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Apple-inloggning misslyckades";
      if (!msg.toLowerCase().includes("cancel")) {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void onAppleSignIn()}
        disabled={loading || disabled}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white py-2 font-medium text-black transition hover:bg-white/90 disabled:opacity-60"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
          <path
            fill="currentColor"
            d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"
          />
        </svg>
        {loading ? "Loggar in…" : "Logga in med Apple"}
      </button>
      {error && <p className="text-center text-sm text-red-400">{error}</p>}
    </div>
  );
}
