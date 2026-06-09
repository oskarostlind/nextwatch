---
name: ios-appflow-build
description: >-
  iOS Appflow/TestFlight builds for NextWatch. Use when preparing Appflow builds,
  fixing TestFlight upload errors, bumping iOS build numbers, or working with
  ios/App, entitlements, or Capacitor native iOS config.
---

# iOS Appflow Build (NextWatch)

## Auto build-nummer (primärt — ingen manuell bump behövs)

Appflow kör `npm run appflow:build` som:

1. Sätter `CURRENT_PROJECT_VERSION` via Trapeze + `CI_BUILD_NUMBER` (Appflows auto-inkrement)
2. Kör `npm run build`

Konfiguration: `appflow.yml` + `package.json` script `appflow:build`.

**Du ska INTE manuellt bumpa build-nummer före varje Appflow-build** — Trapeze gör det på build-servern.

Verifiera i Appflow-loggen under `build_pro_app`:

```
▸ run ios buildNumber <N>
▸ updated ios/App/App.xcodeproj/project.pbxproj
```

## Om TestFlight säger "bundle version must be higher"

- **Orsak:** `CI_BUILD_NUMBER` ≤ senast uppladdade build i App Store Connect.
- **Fix:** Öka offset i `appflow:build` i `package.json`:

```json
"appflow:build": "CI_BUILD_NUMBER=$(($CI_BUILD_NUMBER + 10)); if [ \"$CI_PLATFORM\" != \"web\" ]; then npx trapeze run appflow.yml -y --$CI_PLATFORM; fi && npm run build"
```

Byt `10` till ett värde så att `CI_BUILD_NUMBER + offset` > senaste TestFlight-build.

## Manuell bump (sällan)

Endast för lokala tester utan Appflow:

```bash
npm run bump:ios
```

## iOS-specifikt i detta repo

| Fil | Syfte |
|-----|--------|
| `appflow.yml` | Trapeze: sätter buildNumber från `CI_BUILD_NUMBER` |
| `ios/App/App/App.entitlements` | Sign in with Apple |
| `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION` (1.0), `CURRENT_PROJECT_VERSION` |
| `patches/@capacitor-community+apple-sign-in+7.1.0.patch` | SPM Capacitor 8-kompatibilitet |

## Innan du committar iOS-ändringar

1. Kör `npx cap sync ios` om Capacitor-plugins ändrats
2. Committa `ios/` + `patches/` + `package-lock.json`
3. Starta Appflow iOS App Store-build — build-nummer hanteras automatiskt

## Apple Sign-In checklist

- `App.entitlements` med `com.apple.developer.applesignin`
- Apple Developer: Sign in with Apple på `com.nextwatch.app`
- Vercel env: `APPLE_CLIENT_ID=com.nextwatch.app`
- Deploy webbkod till produktion (appen laddar `https://www.nextwatch.se`)
