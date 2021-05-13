import {altair} from "@chainsafe/lodestar-types";
import {config} from "./config";

/* eslint-disable no-console */

const key = "snapshot-json";

export function readSnapshot(): altair.LightClientSnapshot | null {
  try {
    const str = localStorage.getItem(key);
    if (!str) return null;
    const json = JSON.parse(str);
    return config.types.altair.LightClientSnapshot.fromJson(json);
  } catch (e) {
    console.error("Error deserializing snapshot", e);
    return null;
  }
}

export function writeSnapshot(snapshot: altair.LightClientSnapshot): void {
  const json = config.types.altair.LightClientSnapshot.toJson(snapshot);
  localStorage.setItem(key, JSON.stringify(json, null, 2));
}
