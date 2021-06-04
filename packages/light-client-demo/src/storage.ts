import {altair, ssz} from "@chainsafe/lodestar-types";

/* eslint-disable no-console */

const key = "snapshot-json";

export function readSnapshot(): altair.LightClientSnapshot | null {
  try {
    const str = localStorage.getItem(key);
    if (!str) return null;
    const json = JSON.parse(str);
    return ssz.altair.LightClientSnapshot.fromJson(json);
  } catch (e) {
    console.error("Error deserializing snapshot", e);
    return null;
  }
}

export function writeSnapshot(snapshot: altair.LightClientSnapshot): void {
  const json = ssz.altair.LightClientSnapshot.toJson(snapshot);
  localStorage.setItem(key, JSON.stringify(json, null, 2));
}
