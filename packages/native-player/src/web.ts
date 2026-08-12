import { WebPlugin } from "@capacitor/core";
import type { NativePlayerOpenOptions, NativePlayerPlugin, NativePlayerResult } from "./definitions";

export class NativePlayerWeb extends WebPlugin implements NativePlayerPlugin {
  async open(_options: NativePlayerOpenOptions): Promise<NativePlayerResult> {
    throw this.unavailable("Il player nativo è disponibile solo su iOS e Android");
  }
}
