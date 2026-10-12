import {bytesToInt, intToBytes} from "@lodestar/utils";
import {ClientCode, ClientVersion} from "../execution/index.js";

export function getLodestarClientVersion(info?: {version?: string; commit?: string}): ClientVersion {
  return {
    code: ClientCode.LS,
    name: "Lodestar",
    version: info?.version ?? "",
    // engine_getClientVersionV1 defines commit as 4 bytes, so builds without git data must not send an empty one
    commit: info?.commit ? info.commit.slice(0, 8) : "00000000",
  };
}

/**
 * Serializes a custody group count value into a Uint8Array suitable for the the ENR field `cgc`.
 */
export function serializeCgc(cgc: number): Uint8Array {
  return intToBytes(cgc, Math.ceil(Math.log2(cgc + 1) / 8), "be");
}

export function deserializeCgc(cgcBytes: Uint8Array): number {
  return bytesToInt(cgcBytes, "be");
}
