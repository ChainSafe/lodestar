import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {bellatrix, ssz} from "@lodestar/types";
import {ContextBytesType, EncodedPayload, EncodedPayloadType, TypeSerializer} from "../../src/types.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type ISszSnappyTestBlockData<T> = {
  id: string;
  serializer: TypeSerializer<T>;
  payload: EncodedPayload<T>;
  streamedBody: Uint8Array;
};

/**
 * A real big bellatrix block from goerli-shadow-fork-2 devnet, which is expected to be
 * encoded in multiple chunks.
 */

export const goerliShadowForkBlock13249: ISszSnappyTestBlockData<bellatrix.SignedBeaconBlock> = {
  id: "goerli-shadow-fork-block-13249",
  serializer: ssz.bellatrix.SignedBeaconBlock,
  payload: {
    type: EncodedPayloadType.bytes,
    bytes: fs.readFileSync(path.join(__dirname, "/goerliShadowForkBlock.13249/serialized.ssz")),
    contextBytes: {type: ContextBytesType.ForkDigest, forkSlot: 13249},
  },
  streamedBody: fs.readFileSync(path.join(__dirname, "/goerliShadowForkBlock.13249/streamed.snappy")),
};
