import type { CapacitorConfig } from "@capacitor/cli";

// The bundled web app (out/) is served inside the native WebView. At runtime it
// calls the routing API over the network. In development that API is plain HTTP
// on your LAN (e.g. http://192.168.x.x:8000), so we must allow cleartext and
// mixed content. For a production build, point the API at HTTPS and you can turn
// these off. See the "Mobile (Android)" section of web/README-mobile.md.
const config: CapacitorConfig = {
  appId: "com.krakowroutes.app",
  appName: "Ciszej",
  webDir: "out",
  android: {
    allowMixedContent: true,
  },
};

export default config;
