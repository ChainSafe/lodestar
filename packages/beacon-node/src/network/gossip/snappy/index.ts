import {GossipType} from "../interface.js";
import {ISnappyDecompressor} from "./interface.js";
import {SnappyDecompressor} from "./snappy-js/decompressor.js";
import {SnappyWasmDecompressor} from "./snappy-wasm.js";

/**
 * for decompression, we use different implementations based on topic type
 * snappy-wasm is generally better for larger payloads and snappyjs is better for smaller payloads
 */
export function getSnappyDecompressor(topicType: GossipType, data: Uint8Array): ISnappyDecompressor {
  switch (topicType) {
    case GossipType.beacon_block:
    case GossipType.blob_sidecar:
    case GossipType.data_column_sidecar:
      return new SnappyWasmDecompressor(data);
    default:
      return new SnappyDecompressor(data);
  }
}
