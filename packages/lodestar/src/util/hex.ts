import {RootHex} from "@chainsafe/lodestar-types";

export function bufferToHex(buffer: Buffer): RootHex {
  return "0x" + buffer.toString("hex");
}

export function hexToBuffer(v: string): Buffer {
  return Buffer.from(v.replace("0x", ""));
}
