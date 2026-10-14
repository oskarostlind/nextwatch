# Android-signering (uppladdningsnyckel)

- `nextwatch-upload.jks` + `keystore.properties` = **uppladdningsnyckeln** för Google Play
  (Play App Signing håller den riktiga appsigneringsnyckeln). Båda är gitignorerade.
- **Säkerhetskopiera båda filerna** (t.ex. i lösenordshanteraren). Tappas de bort kan
  uppladdningsnyckeln återställas via Play Console → Appintegritet, men det tar dagar.
- Bygg: `cd android && ./gradlew bundleRelease -PnwVersionCode=<N>` → `app/build/outputs/bundle/release/app-release.aab`.
