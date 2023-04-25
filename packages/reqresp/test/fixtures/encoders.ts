import {ForkName} from "@lodestar/params";
import {LodestarError} from "@lodestar/utils";
import {SszSnappyError, SszSnappyErrorCode} from "../../src/encodingStrategies/sszSnappy/index.js";
import {ResponseError} from "../../src/index.js";
import {RespStatus} from "../../src/interface.js";
import {EncodedPayloadBytes, MixedProtocolDefinition} from "../../src/types.js";
import {fromHexBuf} from "../utils/index.js";
import {
  beaconConfig,
  messages,
  sszSnappyPing,
  sszSnappySignedBeaconBlockAltair,
  sszSnappySignedBeaconBlockPhase0,
} from "./messages.js";

export const requestEncodersCases: {
  id: string;
  protocol: MixedProtocolDefinition<any, any>;
  chunks: Uint8Array[];
  requestBody: unknown;
}[] = [
  {
    id: "No body on Metadata",
    protocol: messages.metadata,
    chunks: [],
    requestBody: null,
  },
  {
    id: "Regular request",
    protocol: messages.ping,
    chunks: sszSnappyPing.chunks,
    requestBody: sszSnappyPing.sszPayload.data,
  },
];

export const requestEncodersErrorCases: {
  id: string;
  protocol: MixedProtocolDefinition<any, any>;
  chunks: Uint8Array[];
  requestBody: unknown;
  errorEncode?: LodestarError<any>;
  errorDecode?: LodestarError<any>;
}[] = [
  {
    id: "Bad body",
    protocol: messages.status,
    chunks: [Buffer.from("4")],
    requestBody: null,
    errorDecode: new SszSnappyError({code: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE, minSize: 84, sszDataLength: 52}),
  },
  {
    id: "No body on Status",
    protocol: messages.status,
    chunks: [],
    requestBody: null,
    errorDecode: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
  },
];

export type SuccessResponseChunk = {status: RespStatus.SUCCESS; payload: EncodedPayloadBytes};
export type ErrorResponseChunk = {status: Exclude<RespStatus, RespStatus.SUCCESS>; errorMessage: string};

export type ResponseChunk = SuccessResponseChunk | ErrorResponseChunk;

export const responseEncodersTestCases: {
  id: string;
  protocol: MixedProtocolDefinition<any, any>;
  chunks: Uint8Array[];
  responseChunks: ResponseChunk[];
  skipEncoding?: boolean;
}[] = [
  {
    id: "No chunks should be ok",
    protocol: messages.ping,
    responseChunks: [],
    chunks: [],
  },
  {
    id: "block v1 without <context-bytes>",
    protocol: messages.blocksByRange,
    responseChunks: [
      {
        status: RespStatus.SUCCESS,
        payload: sszSnappySignedBeaconBlockPhase0.binaryPayload,
      },
    ],
    chunks: [
      // <result>
      Buffer.from([RespStatus.SUCCESS]),
      // <encoding-dependent-header> | <encoded-payload>
      ...sszSnappySignedBeaconBlockPhase0.chunks,
    ],
  },
  {
    id: "block v2 with <context-bytes> phase0",
    protocol: messages.blocksByRangeV2,
    responseChunks: [{status: RespStatus.SUCCESS, payload: sszSnappySignedBeaconBlockPhase0.binaryPayload}],
    chunks: [
      // <result>
      Buffer.from([RespStatus.SUCCESS]),
      // <context-bytes>
      beaconConfig.forkName2ForkDigest(ForkName.phase0),
      // <encoding-dependent-header> | <encoded-payload>
      ...sszSnappySignedBeaconBlockPhase0.chunks,
    ],
  },
  {
    id: "block v2 with <context-bytes> altair",
    protocol: messages.blocksByRangeV2,
    responseChunks: [{status: RespStatus.SUCCESS, payload: sszSnappySignedBeaconBlockAltair.binaryPayload}],
    chunks: [
      // <result>
      Buffer.from([RespStatus.SUCCESS]),
      // <context-bytes>
      beaconConfig.forkName2ForkDigest(ForkName.altair),
      // <encoding-dependent-header> | <encoded-payload>
      ...sszSnappySignedBeaconBlockAltair.chunks,
    ],
  },
  {
    id: "Multiple chunks with success",
    protocol: messages.ping,
    responseChunks: [
      {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
      {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
    ],
    chunks: [
      // Chunk 0 - success
      Buffer.from([RespStatus.SUCCESS]),
      ...sszSnappyPing.chunks,
      // Chunk 1 - success
      Buffer.from([RespStatus.SUCCESS]),
      ...sszSnappyPing.chunks,
    ],
  },
  {
    id: "Decode successfully response_chunk as a single Uint8ArrayList",
    protocol: messages.ping,
    responseChunks: [
      {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
      {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
    ],
    chunks: [
      // success, Ping payload = BigInt(1)
      Buffer.from([RespStatus.SUCCESS]),
      ...sszSnappyPing.chunks,
      Buffer.from([RespStatus.SUCCESS]),
      ...sszSnappyPing.chunks,
    ],
    // It's not able to produce a single concatenated chunk with our encoder
    skipEncoding: true,
  },
  {
    id: "Decode successfully response_chunk as a single concated chunk",
    protocol: messages.ping,
    responseChunks: [
      {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
      {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
    ],
    chunks: [
      // success, Ping payload = BigInt(1)

      Buffer.concat([Buffer.from([RespStatus.SUCCESS]), ...sszSnappyPing.chunks.map((c) => c.subarray())]),
      Buffer.concat([Buffer.from([RespStatus.SUCCESS]), ...sszSnappyPing.chunks.map((c) => c.subarray())]),
    ],
    // It's not able to produce a single concatenated chunk with our encoder
    skipEncoding: true,
  },
  {
    id: "Decode blocks v2 through a fork with multiple types",
    protocol: messages.blocksByRangeV2,
    responseChunks: [
      {status: RespStatus.SUCCESS, payload: sszSnappySignedBeaconBlockPhase0.binaryPayload},
      {status: RespStatus.SUCCESS, payload: sszSnappySignedBeaconBlockAltair.binaryPayload},
    ],
    chunks: [
      // Chunk 0 - success block in phase0 with context bytes
      Buffer.from([RespStatus.SUCCESS]),
      beaconConfig.forkName2ForkDigest(ForkName.phase0),
      ...sszSnappySignedBeaconBlockPhase0.chunks,
      // Chunk 1 - success block in altair with context bytes
      Buffer.from([RespStatus.SUCCESS]),
      beaconConfig.forkName2ForkDigest(ForkName.altair),
      ...sszSnappySignedBeaconBlockAltair.chunks,
    ],
  },
];

export const responseEncodersErrorTestCases: {
  id: string;
  protocol: MixedProtocolDefinition<any, any>;
  chunks?: Uint8Array[];
  responseChunks?: ResponseChunk[];
  // decode only
  decodeError?: LodestarError<any>;
  // encode only
  encodeError?: LodestarError<any>;
}[] = [
  {
    id: "Empty response chunk - Error",
    protocol: messages.ping,
    decodeError: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
    chunks: [Buffer.from([RespStatus.SUCCESS])],
    // Not possible to encode this invalid case
  },
  {
    id: "block v2 with <context-bytes> altair",
    protocol: messages.blocksByRange,
    responseChunks: [{status: RespStatus.SUCCESS, payload: sszSnappySignedBeaconBlockAltair.binaryPayload}],
    chunks: [
      // <result>
      Buffer.from([RespStatus.SUCCESS]),
      // <context-bytes>
      beaconConfig.forkName2ForkDigest(ForkName.altair),
      // <encoding-dependent-header> | <encoded-payload>
      ...sszSnappySignedBeaconBlockAltair.chunks,
    ],
  },
  {
    id: "Multiple chunks with final error, should error",
    protocol: messages.ping,
    decodeError: new ResponseError(RespStatus.SERVER_ERROR, ""),
    responseChunks: [
      {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
      {status: RespStatus.SUCCESS, payload: sszSnappyPing.binaryPayload},
      {status: RespStatus.SERVER_ERROR, errorMessage: ""},
    ],
    chunks: [
      // Chunk 0 - success
      Buffer.from([RespStatus.SUCCESS]),
      ...sszSnappyPing.chunks,
      // Chunk 1 - success
      Buffer.from([RespStatus.SUCCESS]),
      ...sszSnappyPing.chunks,
      // Chunk 2 - error
      Buffer.from([RespStatus.SERVER_ERROR]),
    ],
  },
  {
    id: "INVALID_REQUEST - no error message",
    protocol: messages.ping,
    decodeError: new ResponseError(RespStatus.INVALID_REQUEST, ""),
    chunks: [Buffer.from([RespStatus.INVALID_REQUEST])],
    responseChunks: [{status: RespStatus.INVALID_REQUEST, errorMessage: ""}],
  },
  {
    id: "SERVER_ERROR -  no error message",
    protocol: messages.ping,
    decodeError: new ResponseError(RespStatus.SERVER_ERROR, ""),
    chunks: [Buffer.from([RespStatus.SERVER_ERROR])],
    responseChunks: [{status: RespStatus.SERVER_ERROR, errorMessage: ""}],
  },
  {
    id: "SERVER_ERROR - with error message",
    protocol: messages.ping,
    decodeError: new ResponseError(RespStatus.SERVER_ERROR, "sNaPpYIzTEST_ERROR"),
    chunks: [
      Buffer.from([RespStatus.SERVER_ERROR]),
      fromHexBuf("0x0a"),
      fromHexBuf("0xff060000734e61507059010e000049b97aaf544553545f4552524f52"),
    ],
    responseChunks: [{status: RespStatus.SERVER_ERROR, errorMessage: "TEST_ERROR"}],
  },
  // This last two error cases are not possible to encode since are invalid. Test decoding only
  {
    id: "SERVER_ERROR - Slice long error message",
    protocol: messages.ping,
    decodeError: new ResponseError(RespStatus.SERVER_ERROR, "TEST_ERROR".padEnd(512, "0").slice(0, 256)),
    chunks: [Buffer.from([RespStatus.SERVER_ERROR]), Buffer.from("TEST_ERROR".padEnd(512, "0"))],
  },
  {
    id: "SERVER_ERROR - Remove non-ascii characters from error message",
    protocol: messages.ping,
    decodeError: new ResponseError(RespStatus.SERVER_ERROR, "TEST_ERROR"),
    chunks: [Buffer.from([RespStatus.SERVER_ERROR]), Buffer.from("TEST_ERROR\u03A9")],
  },
];
