import {ClientCode, ClientVersion} from "../execution/index.js";

export function getLodestarClientVersion(info?: {version?: string; commit?: string}): ClientVersion {
  return {
    code: ClientCode.LS,
    name: "Lodestar",
    version: info?.version ?? "",
    commit: info?.commit?.slice(0, 8) ?? "",
  };
}
