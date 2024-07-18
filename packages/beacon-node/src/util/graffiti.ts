import {GRAFFITI_SIZE} from "../constants/index.js";
import { ClientCode, ClientVersion } from "../execution/index.js";

/**
 * Parses a graffiti UTF8 string and returns a 32 bytes buffer right padded with zeros
 */
export function toGraffitiBuffer(graffiti: string): Buffer {
  return Buffer.concat([Buffer.from(graffiti, "utf8"), Buffer.alloc(GRAFFITI_SIZE, 0)], GRAFFITI_SIZE);
}

export function getLodestarClientVersion(info?: {version: string, commit: string}): ClientVersion {
  return {
    code: ClientCode.LS,
    name: "Lodestar",
    version: info?.version ?? "",
    commit: info?.commit?.slice(0, 2) ?? "",
  };
}