import { registerPlugin } from "@capacitor/core";
import type { NativePlayerPlugin } from "./definitions";

export * from "./definitions";

export const NativePlayer = registerPlugin<NativePlayerPlugin>("NativePlayer", {
  web: () => import("./web").then((module) => new module.NativePlayerWeb())
});
