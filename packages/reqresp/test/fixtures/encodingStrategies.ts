import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Uint8ArrayList} from "uint8arraylist";
import varint from "varint";
import {fromHexString} from "@chainsafe/ssz";
import {altair, bellatrix, phase0, ssz} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {ContextBytesType, EncodedPayload, EncodedPayloadType, TypeSerializer} from "../../src/types.js";
import {SszSnappyError, SszSnappyErrorCode} from "../../src/encodingStrategies/sszSnappy/errors.js";

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

type SszSnappyTestData<T> = {
  id: string;
  type: TypeSerializer<T>;
  payload: {
    type: EncodedPayloadType.ssz;
    data: T;
  };
  /** chunks expected in an async compress version of snappy stream */
  asyncChunks: Buffer[];
  /** chunks expected in a sync compress version of snappy stream  */
  chunks: Uint8ArrayList[];
};

export const sszSnappyPing: SszSnappyTestData<phase0.Ping> = {
  id: "Ping type",
  type: ssz.phase0.Ping,
  payload: {
    type: EncodedPayloadType.ssz,
    data: BigInt(1),
  },
  asyncChunks: [
    "0x08", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x010c00000175de410100000000000000", // snappy frames content
  ]
    .map(fromHexString)
    .map(Buffer.from),
  chunks: ["0x08", "0xff060000734e61507059010c00000175de410100000000000000"].map(
    (s) => new Uint8ArrayList(fromHexString(s))
  ),
};

export const sszSnappyStatus: SszSnappyTestData<phase0.Status> = {
  id: "Status type",
  type: ssz.phase0.Status,
  payload: {
    type: EncodedPayloadType.ssz,
    data: {
      forkDigest: Buffer.alloc(4, 0xda),
      finalizedRoot: Buffer.alloc(32, 0xda),
      finalizedEpoch: 9,
      headRoot: Buffer.alloc(32, 0xda),
      headSlot: 9,
    },
  },
  asyncChunks: [
    "0x54", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x001b0000097802c15400da8a010004090009017e2b001c0900000000000000",
  ]
    .map(fromHexString)
    .map(Buffer.from),
  chunks: ["0x54", "0xff060000734e61507059001b0000097802c15400da8a010004090009017e2b001c0900000000000000"].map(
    (s) => new Uint8ArrayList(fromHexString(s))
  ),
};

export const sszSnappySignedBeaconBlockPhase0: SszSnappyTestData<phase0.SignedBeaconBlock> = {
  id: "phase0 SignedBeaconBlock type",
  type: ssz.phase0.SignedBeaconBlock,
  payload: {
    type: EncodedPayloadType.ssz,
    data: {
      message: {
        slot: 9,
        proposerIndex: 9,
        parentRoot: Buffer.alloc(32, 0xda),
        stateRoot: Buffer.alloc(32, 0xda),
        body: {
          randaoReveal: Buffer.alloc(96, 0xda),
          eth1Data: {
            depositRoot: Buffer.alloc(32, 0xda),
            blockHash: Buffer.alloc(32, 0xda),
            depositCount: 9,
          },
          graffiti: Buffer.alloc(32, 0xda),
          proposerSlashings: [],
          attesterSlashings: [],
          attestations: [],
          deposits: [],
          voluntaryExits: [],
        },
      },
      signature: Buffer.alloc(96, 0xda),
    },
  },
  asyncChunks: [
    "0x9403",
    "0xff060000734e61507059",
    "0x00340000fff3b3f594031064000000dafe01007a010004090009011108fe6f000054feb4008ab4007e0100fecc0011cc0cdc0000003e0400",
  ]
    .map(fromHexString)
    .map(Buffer.from),
  chunks: [
    "0x9403",
    "0xff060000734e6150705900340000fff3b3f594031064000000dafe01007a010004090009011108fe6f000054feb4008ab4007e0100fecc0011cc0cdc0000003e0400",
  ].map((s) => new Uint8ArrayList(fromHexString(s))),
};

export const sszSnappySignedBeaconBlockAltair: SszSnappyTestData<altair.SignedBeaconBlock> = {
  id: "altair SignedBeaconBlock type",
  type: ssz.altair.SignedBeaconBlock,
  payload: {
    type: EncodedPayloadType.ssz,
    data: {
      ...sszSnappySignedBeaconBlockPhase0.payload.data,
      message: {
        ...sszSnappySignedBeaconBlockPhase0.payload.data.message,
        slot: 90009,
        body: {
          ...sszSnappySignedBeaconBlockPhase0.payload.data.message.body,
          syncAggregate: ssz.altair.SyncAggregate.defaultValue(),
        },
      },
    },
  },
  asyncChunks: [
    "0xf803", // length prefix
    "0xff060000734e61507059", // snappy frames header
    "0x003f0000ee14ab0df8031064000000dafe01007a01000c995f0100010100090105ee70000d700054ee44000d44fe0100fecc0011cc0c400100003e0400fe01008e0100",
  ]
    .map(fromHexString)
    .map(Buffer.from),
  chunks: [
    "0xb404",
    "0xff060000734e6150705900420000bab7f8feb4041064000000dafe01007a01000c995f0100010100090105ee70000d700054ee44000d44fe0100fecc0011cc0c7c0100003e0400fe0100fe01007e0100",
  ].map((s) => new Uint8ArrayList(fromHexString(s))),
};

export const encodingStrategiesTestCases: SszSnappyTestData<unknown>[] = [
  sszSnappyPing,
  sszSnappyStatus,
  sszSnappySignedBeaconBlockPhase0,
  sszSnappySignedBeaconBlockAltair,
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
