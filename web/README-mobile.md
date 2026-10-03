# Mobile (Android) via Capacitor

The web app is wrapped with [Capacitor](https://capacitorjs.com/) so it can run as
a native Android app: the exported static site (`out/`) is bundled into a native
WebView, and MapLibre + the routing fetch work exactly as in the browser.

## Prerequisites

- **Node 22+** (Capacitor 8's CLI requires it).
- **Java 21** (`java -version`).
- **Android SDK** with an installed platform matching `android/variables.gradle`
  (`compileSdkVersion`, currently **35**) and build-tools. Set `ANDROID_HOME`:
  ```bash
  export ANDROID_HOME="$HOME/Android/Sdk"
  export ANDROID_SDK_ROOT="$HOME/Android/Sdk"
  ```
- For installing to a device/emulator: `adb` (in `$ANDROID_HOME/platform-tools`).

> If your SDK only has a different platform installed, change `compileSdkVersion`
> and `targetSdkVersion` in `android/variables.gradle` to a version you have
> (e.g. `34`), or install the platform with `sdkmanager "platforms;android-35"`.

## The one thing you MUST configure: the API URL

A phone cannot reach your computer's `localhost`. Before building, point the app at
your computer's LAN address by creating `web/.env.local`:

```bash
# find your LAN IP (Linux):  ip route get 1.1.1.1 | awk '{print $7; exit}'
echo 'NEXT_PUBLIC_API_URL=http://192.168.1.50:8000' > web/.env.local   # <-- your IP
```

This value is baked into the static build, so **rebuild after changing it**.

On the API side, run it bound to all interfaces so the phone can connect, and keep
the CORS defaults (which already allow the Capacitor WebView origin
`https://localhost`):

```bash
cd api && .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
# or:  make api-lan
```

Your phone and computer must be on the same Wi-Fi.

## Build a debug APK

```bash
# from web/ (Node 22 active):
npm run build            # static export -> out/
npx cap sync android     # copy out/ into the native project
cd android && ./gradlew assembleDebug
# APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

Or, from the repo root:

```bash
make mobile-apk          # export + sync + assembleDebug
```

Install it on a connected device:

```bash
adb install -r web/android/app/build/outputs/apk/debug/app-debug.apk
```

Or open the project in Android Studio to run/debug on an emulator or device:

```bash
cd web && npx cap open android     # or:  make mobile-open
```

## How it was set up (for reference)

1. `output: 'export'` in `next.config.ts` so `next build` emits a static `out/`.
2. `npm i @capacitor/core @capacitor/android` + `@capacitor/cli` (dev).
3. `npx cap init "Krakow Routes" com.krakowroutes.app --web-dir out`.
4. `npx cap add android`.
5. `android:usesCleartextTraffic="true"` added to the `AndroidManifest.xml`
   `<application>` so the app may call the plain-HTTP dev API; with `allowMixedContent`
   set in `capacitor.config.ts`. For a production HTTPS API you can remove both.

## Notes & limitations

- The MapLibre worker files in `public/maplibre/` are bundled into `out/` by the
  `prebuild` copy step, so the map renders inside the WebView without a network
  round-trip for the worker.
- iOS is not set up here, but the same flow applies: `npx cap add ios` (needs
  macOS + Xcode). The CORS default already includes `capacitor://localhost` for iOS.
- For a store-ready release build you'd configure signing and run
  `./gradlew assembleRelease`; that's out of scope for this skeleton.
