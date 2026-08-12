var config = {
    appId: "com.lumentv.app",
    appName: "LumenTV",
    webDir: "dist",
    server: {
        androidScheme: "https",
        iosScheme: "capacitor"
    },
    android: {
        allowMixedContent: true
    },
    ios: {
        contentInset: "automatic"
    }
};
export default config;
