// lib/hideNativeSplash.ts
//
// Släpper den native launch-skärmen från en felvy. Normalt gör
// SplashScreenHide (i AppShell) det, men den väntar på AuthGate på "/", och
// AuthGate ligger i själva sidan — kraschar sidan blir AuthGate aldrig klar
// och appen visar svart launch-skärm i 5 s innan felvyn syns. global-error.tsx
// har ingen AppShell alls. Ofarligt på webben och om pluginet saknas.
export async function hideNativeSplash(): Promise<void> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* webb eller plugin saknas — ignorera */
  }
}
