---
name: ios-appflow-build
description: >-
  iOS Appflow/TestFlight builds for NextWatch. Use when preparing Appflow builds,
  fixing TestFlight upload errors, bumping iOS build numbers, adding/syncing
  Capacitor plugins, or working with ios/App, entitlements, or Capacitor native
  iOS config.
---

# iOS Appflow Build (NextWatch)

> Speglad i `.claude/skills/ios-appflow-build/SKILL.md` — uppdatera båda vid ändring.

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

## Nytt Capacitor-plugin = cap sync + ny native-build

När ett plugin läggs till i `package.json` räcker det INTE att deploya webben —
pluginet måste in i iOS-binären:

1. `npx cap sync ios` — registrerar pluginet i `ios/App/CapApp-SPM/Package.swift`
2. Committa `ios/` (+ `package-lock.json`, ev. `patches/`)
3. Starta Appflow iOS App Store-build

Utan steg 1–2 saknas pluginet i binären: JS-modulen laddar (den kommer från
webben) men native-anropen kastar. Symptom: funktionen ser ut att finnas men
misslyckas i runtime. Hände 2026-07 med `@capacitor/local-notifications` —
"Påminn mig" visades men schemaläggningen dog tyst.

## ⚠️ Windows-fälla: cap sync skriver backslashes i Package.swift

`npx cap sync ios` på Windows genererar package-sökvägar med omvända snedstreck:

```swift
.package(name: "CapacitorApp", path: "..\..\..\node_modules\@capacitor\app"),
```

Det knäcker SPM-bygget på Appflows macOS-byggare. **Handrätta alltid diffen till
forward slashes innan commit:**

```swift
.package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),
```

Granska `git diff ios/App/CapApp-SPM/Package.swift` efter varje sync — den enda
avsiktliga ändringen ska vara plugin-rader som läggs till/tas bort, aldrig
sökvägsstilen.

## iOS-specifikt i detta repo

| Fil | Syfte |
|-----|--------|
| `appflow.yml` | Trapeze: sätter buildNumber från `CI_BUILD_NUMBER` för BÅDA targets (`App` + `NotificationService`) — måste vara lika, annars ITMS-90473 |
| `ios/App/App/App.entitlements` | Sign in with Apple, push, Time Sensitive Notifications |
| `ios/App/App.xcodeproj/project.pbxproj` | `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION` — finns i BÅDA targets; ändras versionen i App måste extensionen följa med |
| `ios/App/NotificationService/` | Notification Service Extension (bundle `com.nextwatch.app.NotificationService`): laddar ner payloadens `image` och bifogar den |
| `ios/App/App/PushActionDelegate.swift` | Proxy framför Capacitors NotificationRouter: låsskärmsknapparna (NW_TITLE/NW_SAVED) POSTar `/api/push/action` i bakgrunden |
| `ios/App/App/NWBridgeViewController.swift` | Subklass av CAPBridgeViewController (Main.storyboard pekar hit) som installerar proxyn igen efter att bridgen skapats |
| `ios/App/CapApp-SPM/Package.swift` | SPM-registrering av Capacitor-plugins (via cap sync) |
| `patches/@capacitor-community+apple-sign-in+7.1.0.patch` | SPM Capacitor 8-kompatibilitet |

## Notis-extension och Appflow-signering (sedan 2026-10-14)

Appen har två targets. Appflow signerar extensionen med en EGEN App Store-profil:
Appflow → Build → Signing Certificates → Edit → "Provisioning profiles" ska
innehålla både `com.nextwatch.app` och `com.nextwatch.app.NotificationService`.
Felet "No profiles for '…NotificationService' were found" betyder att den andra
profilen saknas där. Ändras capabilities på `com.nextwatch.app` i Apple-portalen
blir profilen ogiltig — generera om och ladda upp den på nytt i Appflow.

pbxproj-ändringar görs med Ruby-gemet `xcodeproj` (det finns ingen Mac). Behåll
`objectVersion = 60` och vanliga `PBXGroup` — Appflow faller på
`PBXFileSystemSynchronizedRootGroup`.

## Vad som INTE kräver ny build

Appen är en WebView-wrapper (`capacitor.config.ts` pekar `server.url` mot
`https://www.nextwatch.se`). Ändringar i React-komponenter, API-routes, `lib/`
och styling följer med web-deployen automatiskt — även i redan installerade
appar. Ny build krävs bara för: nya/borttagna Capacitor-plugins,
`capacitor.config.ts`, `ios/`-filer (entitlements, Info.plist, pbxproj),
`patches/`, eller npm-paket med native-delar.

## Apple Sign-In checklist

- `App.entitlements` med `com.apple.developer.applesignin`
- Apple Developer: Sign in with Apple på `com.nextwatch.app`
- Vercel env: `APPLE_CLIENT_ID=com.nextwatch.app`
- Deploy webbkod till produktion (appen laddar `https://www.nextwatch.se`)
