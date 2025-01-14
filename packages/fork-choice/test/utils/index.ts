import {RootHex} from "@lodestar/types";
import {toHex} from "@lodestar/utils";

const rootStateBytePrefix = 0xaa;
const rootBlockBytePrefix = 0xbb;

export function getStateRoot(slot: number): RootHex {
  const root = Buffer.alloc(32, 0x00);
  root[0] = rootStateBytePrefix;
  root[31] = slot;
  return toHex(root);
}

export function getBlockRoot(slot: number): RootHex {
  const root = Buffer.alloc(32, 0x00);
  root[0] = rootBlockBytePrefix;
  root[31] = slot;
  return toHex(root);
}
