import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {bellatrix, ssz} from "@chainsafe/lodestar-types";
import {RequestOrIncomingResponseBody, RequestOrResponseType} from "../../../../../../src/network/reqresp/types.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ISszSnappyTestBlockData<T extends RequestOrIncomingResponseBody> {
  id: string;
  type: RequestOrResponseType;
  bytes: Buffer;
  streamedBody: Buffer;
  body?: T;
}

/**
 * A real big bellatrix block from goerli-shadow-fork-2 devnet, which is expected to be
 * encoded in multiple chunks.
 */

export const goerliShadowForkBlock13249: ISszSnappyTestBlockData<bellatrix.SignedBeaconBlock> = {
  id: "goerli-shadow-fork-block-13249",
  type: ssz.bellatrix.SignedBeaconBlock,
  bytes: fs.readFileSync(path.join(__dirname, "/goerliShadowForkBlock.13249/serialized.ssz")),
  streamedBody: fs.readFileSync(path.join(__dirname, "/goerliShadowForkBlock.13249/streamed.snappy")),
};
