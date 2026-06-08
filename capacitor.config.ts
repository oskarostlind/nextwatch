import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'se.nextwatch.app',
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
};

export default config;
