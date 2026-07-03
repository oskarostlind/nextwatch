import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nextwatch.app',
  appName: 'Nextwatch',
  // NextWatch är en server-driven Next.js-app (API-routes, middleware, cookies()).
  // Den kan INTE statiskt exporteras, så native-skalet laddar den hostade appen
  // via server.url istället för en bundlad export. "www" är bara en lokal
  // fallback-mapp (med index.html) som krävs av Capacitors copy-steg.
  webDir: 'www',
  server: {
    url: 'https://www.nextwatch.se',
    cleartext: false,
  },
  plugins: {
    PushNotifications: {
      // Visa notiser även när appen är i förgrunden.
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      // launchAutoHide: false håller kvar native launch-skärmen (svart + logga)
      // tills JS explicit döljer den (se app/components/client/SplashScreenHide.tsx).
      // Utan detta döljer iOS launch-skärmen så fort WKWebView:ns view-controller
      // laddats – long innan den fjärrladdade sidan (server.url) hunnit rendera
      // något, vilket visar sig som en vit blixt (WKWebView:ns default-bakgrund).
      launchAutoHide: false,
      backgroundColor: '#000000',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
