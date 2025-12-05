import {GossipType} from "../interface.js";
import {ISnappyDecompressor} from "./interface.js";
import {SnappyDecompressor} from "./snappy-js/decompressor.js";
import {SnappyWasmDecompressor} from "./snappy-wasm.js";

export function getSnappyDecompressor(topicType: GossipType, data: Uint8Array): ISnappyDecompressor {
  switch (topicType) {
    case GossipType.beacon_attestation:
      return new SnappyDecompressor(data);
    default:
      return new SnappyWasmDecompressor(data);
  }
}
