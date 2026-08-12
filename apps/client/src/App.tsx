import { useEffect, useRef, useState } from "react";
import { api, authStore } from "./lib/api";
import { getOrCreateDeviceId, getPlatform } from "./lib/platform";
import { navigate, useHashRoute } from "./lib/router";
import { installLgNavigation } from "./lib/lgNavigation";
import { clearPlaybackMemory, readLastPlayback } from "./lib/playbackMemory";
import { TopNav } from "./components/TopNav";
import { Loading } from "./components/Loading";
import { AuthScreen } from "./screens/AuthScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { SearchScreen } from "./screens/SearchScreen";
import { ItemScreen } from "./screens/ItemScreen";
import { PlayerScreen } from "./screens/PlayerScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { GroupsScreen } from "./screens/GroupsScreen";

export default function App() {
  const route = useHashRoute();
  const [authState, setAuthState] = useState<"checking" | "authenticated" | "anonymous">(
    authStore.getToken() ? "checking" : "anonymous"
  );
  const initializedTokenRef = useRef<string | null>(null);

  useEffect(() => {
    document.body.dataset.platform = getPlatform();
    return installLgNavigation();
  }, [route.name]);

  useEffect(() => {
    if (!authStore.getToken()) {
      setAuthState("anonymous");
      return;
    }

    let active = true;
    api.me()
      .then(() => {
        if (active) setAuthState("authenticated");
      })
      .catch(() => {
        if (!active) return;
        initializedTokenRef.current = null;
        authStore.clear();
        clearPlaybackMemory();
        setAuthState("anonymous");
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const token = authStore.getToken();
    if (authState !== "authenticated" || !token || initializedTokenRef.current === token) return;
    initializedTokenRef.current = token;

    const platform = getPlatform();
    void api.registerDevice({
      id: getOrCreateDeviceId(),
      name: platform === "webos" ? "LG TV" : navigator.platform || "Dispositivo",
      platform,
      capabilities: {
        userAgent: navigator.userAgent,
        hevcHint: platform === "ios" || platform === "webos"
      }
    }).catch(() => {});

    if (platform === "webos" && route.name === "home") {
      const autoResume = window.localStorage.getItem("lumentv.auto.resume.playback") !== "false";
      const lastPlayback = readLastPlayback();
      if (autoResume && lastPlayback) {
        navigate(`player/${lastPlayback.sourceType}/${lastPlayback.id}`);
      }
    }
  }, [authState, route.name]);

  function authenticated() {
    setAuthState("authenticated");
    navigate("home", true);
  }

  function logout() {
    initializedTokenRef.current = null;
    authStore.clear();
    clearPlaybackMemory();
    setAuthState("anonymous");
    window.location.hash = "";
  }

  if (authState === "checking") return <Loading label="Verifica account" />;
  if (authState === "anonymous") return <AuthScreen onAuthenticated={authenticated} />;

  const isPlayer = route.name === "player";
  return (
    <div className={isPlayer ? "app app--player" : "app"}>
      {!isPlayer && <TopNav onLogout={logout} />}
      {route.name === "home" && <HomeScreen />}
      {route.name === "setup" && <SetupScreen />}
      {route.name === "search" && <SearchScreen />}
      {route.name === "groups" && <GroupsScreen />}
      {route.name === "group" && <GroupsScreen groupId={route.id} />}
      {route.name === "settings" && <SettingsScreen />}
      {route.name === "item" && <ItemScreen id={route.id} />}
      {route.name === "player" && <PlayerScreen sourceType={route.sourceType} id={route.id} />}
    </div>
  );
}
