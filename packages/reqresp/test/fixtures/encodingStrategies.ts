import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import varint from "varint";
import {LodestarError} from "@lodestar/utils";
import {bellatrix, ssz} from "@lodestar/types";
import {SszSnappyError, SszSnappyErrorCode} from "../../src/encodingStrategies/sszSnappy/errors.js";
import {ContextBytesType, EncodedPayload, EncodedPayloadType, TypeSerializer} from "../../src/types.js";
import {
  sszSnappyPing,
  sszSnappySignedBeaconBlockAltair,
  sszSnappySignedBeaconBlockPhase0,
  sszSnappyStatus,
} from "./messages.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

type SszSnappyTestBlockData<T> = {
  id: string;
  type: TypeSerializer<T>;
  payload: EncodedPayload<T>;
  streamedBody: Uint8Array;
};

/**
 * A real big bellatrix block from goerli-shadow-fork-2 devnet, which is expected to be
 * encoded in multiple chunks.
 */

export const goerliShadowForkBlock13249: SszSnappyTestBlockData<bellatrix.SignedBeaconBlock> = {
  id: "goerli-shadow-fork-block-13249",
  type: ssz.bellatrix.SignedBeaconBlock,
  payload: {
    type: EncodedPayloadType.bytes,
    bytes: fs.readFileSync(path.join(__dirname, "/goerliShadowForkBlock.13249/serialized.ssz")),
    contextBytes: {type: ContextBytesType.ForkDigest, forkSlot: 13249},
  },
  streamedBody: fs.readFileSync(path.join(__dirname, "/goerliShadowForkBlock.13249/streamed.snappy")),
};

export const encodingStrategiesMainnetTestCases = [goerliShadowForkBlock13249];

export const encodingStrategiesTestCases = [
  {id: "Ping type", ...sszSnappyPing},
  {id: "Status type", ...sszSnappyStatus},
  {id: "phase0 SignedBeaconBlock type", ...sszSnappySignedBeaconBlockPhase0},
  {id: "altair SignedBeaconBlock type", ...sszSnappySignedBeaconBlockAltair},
];

export const encodingStrategiesEncodingErrorCases: {
  id: string;
  type: TypeSerializer<unknown>;
  payload: EncodedPayload<unknown>;
  error: LodestarError<any>;
}[] = [
  {
    id: "Bad body",
    type: ssz.phase0.Status,
    payload: {
      type: EncodedPayloadType.ssz,
      data: BigInt(1),
    },
    error: new SszSnappyError({
      code: SszSnappyErrorCode.SERIALIZE_ERROR,
      serializeError: new TypeError("Cannot convert undefined or null to object"),
    }),
  },
];

export const encodingStrategiesDecodingErrorCases: {
  id: string;
  type: TypeSerializer<unknown>;
  error: SszSnappyErrorCode;
  chunks: Buffer[];
}[] = [
  {
    id: "if it takes more than 10 bytes for varint",
    type: ssz.phase0.Status,
    error: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT,
    // Used varint@5.0.2 to generated this hex payload because of https://github.com/chrisdickinson/varint/pull/20
    chunks: [Buffer.from("80808080808080808080808010", "hex")],
  },
  {
    id: "if failed ssz size bound validation",
    type: ssz.phase0.Status,
    error: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE,
    chunks: [Buffer.alloc(12, 0)],
  },
  {
    id: "if it read more than maxEncodedLen",
    type: ssz.phase0.Ping,
    error: SszSnappyErrorCode.TOO_MUCH_BYTES_READ,
    chunks: [Buffer.from(varint.encode(ssz.phase0.Ping.minSize)), Buffer.alloc(100)],
  },
  {
    id: "if failed ssz snappy input malformed",
    type: ssz.phase0.Status,
    error: SszSnappyErrorCode.DECOMPRESSOR_ERROR,
    chunks: [Buffer.from(varint.encode(ssz.phase0.Status.minSize)), Buffer.from("wrong snappy data")],
  },
];
