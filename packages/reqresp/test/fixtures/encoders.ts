import {ForkName} from "@lodestar/params";
import {LodestarError} from "@lodestar/utils";
import {SszSnappyError, SszSnappyErrorCode} from "../../src/encodingStrategies/sszSnappy/index.js";
import {ResponseError} from "../../src/index.js";
import {RespStatus} from "../../src/interface.js";
import {ContextBytesType, MixedProtocol, ResponseIncoming} from "../../src/types.js";
import {fromHexBuf} from "../utils/index.js";
import {
  beaconConfig,
  getEmptyHandler,
  sszSnappyAltairMetadata,
  sszSnappyPhase0Metadata,
  sszSnappyPing,
  sszSnappySignedBeaconBlockAltair,
  sszSnappySignedBeaconBlockPhase0,
} from "./messages.js";
import {customProtocol, pingProtocol} from "./protocols.js";

const pingNoHandler = pingProtocol(getEmptyHandler());

export const requestEncodersCases: {
  id: string;
  protocol: MixedProtocol;
  chunks: Uint8Array[];
  requestBody: Uint8Array;
}[] = [
  {
    id: "No body on Metadata",
    protocol: customProtocol({noRequest: true}),
    chunks: [],
    requestBody: new Uint8Array(),
  },
  {
    id: "Regular request",
    protocol: pingNoHandler,
    chunks: sszSnappyPing.chunks,
    requestBody: sszSnappyPing.binaryPayload.data,
  },
];

export const requestEncodersErrorCases: {
  id: string;
  protocol: MixedProtocol;
  chunks: Uint8Array[];
  requestBody: unknown;
  errorDecode: LodestarError<any>;
}[] = [
  {
    id: "Bad body",
    protocol: customProtocol({requestMinSize: 84}),
    chunks: [Buffer.from("4")],
    requestBody: null,
    errorDecode: new SszSnappyError({code: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE, minSize: 84, sszDataLength: 52}),
  },
  {
    id: "No body on Status",
    protocol: customProtocol({}),
    chunks: [],
    requestBody: null,
    errorDecode: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
  },
];

export type SuccessResponseChunk = {status: RespStatus.SUCCESS; payload: ResponseIncoming};
export type ErrorResponseChunk = {status: Exclude<RespStatus, RespStatus.SUCCESS>; errorMessage: string};

export type ResponseChunk = SuccessResponseChunk | ErrorResponseChunk;

export const responseEncodersTestCases: {
  id: string;
  protocol: MixedProtocol;
  chunks: Uint8Array[];
  responseChunks: ResponseChunk[];
  skipEncoding?: boolean;
}[] = [
  {
    id: "No chunks should be ok",
    protocol: pingNoHandler,
    responseChunks: [],
    chunks: [],
  },
  {
    id: "phase0 metadata",
    protocol: customProtocol({}),
    responseChunks: [
      {
        status: RespStatus.SUCCESS,
        payload: sszSnappyPhase0Metadata.binaryPayload,
      },
    ],
    chunks: [
      // <result>
      Buffer.from([RespStatus.SUCCESS]),
      // <encoding-dependent-header> | <encoded-payload>
      ...sszSnappyPhase0Metadata.chunks,
    ],
  },
  {
    id: "altair metadata",
    protocol: customProtocol({version: 2}),
    responseChunks: [
      {
        status: RespStatus.SUCCESS,
        payload: sszSnappyAltairMetadata.binaryPayload,
      },
    ],
    chunks: [
      // <result>
      Buffer.from([RespStatus.SUCCESS]),
      // <encoding-dependent-header> | <encoded-payload>
      ...sszSnappyAltairMetadata.chunks,
    ],
  },
  {
    id: "block v1 without <context-bytes>",
    protocol: customProtocol({contextBytesType: ContextBytesType.Empty, version: 1}),
    responseChunks: [
      {
        status: RespStatus.SUCCESS,
        payload: {...sszSnappySignedBeaconBlockPhase0.binaryPayload, protocolVersion: 1},
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
    protocol: customProtocol({contextBytesType: ContextBytesType.ForkDigest, version: 2}),
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
    protocol: customProtocol({contextBytesType: ContextBytesType.ForkDigest, version: 2}),
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
    protocol: pingNoHandler,
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
    protocol: pingNoHandler,
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
    id: "Decode successfully response_chunk as a single concatenated chunk",
    protocol: pingNoHandler,
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
    protocol: customProtocol({contextBytesType: ContextBytesType.ForkDigest, version: 2}),
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
  protocol: MixedProtocol;
  chunks?: Uint8Array[];
  responseChunks?: ResponseChunk[];
  // decode only
  decodeError?: LodestarError<any>;
  // encode only
  encodeError?: LodestarError<any>;
}[] = [
  {
    id: "Empty response chunk - Error",
    protocol: pingNoHandler,
    decodeError: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
    chunks: [Buffer.from([RespStatus.SUCCESS])],
    // Not possible to encode this invalid case
  },
  {
    id: "block v2 with <context-bytes> altair",
    protocol: customProtocol({contextBytesType: ContextBytesType.ForkDigest, version: 2}),
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
    protocol: pingNoHandler,
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
    protocol: pingNoHandler,
    decodeError: new ResponseError(RespStatus.INVALID_REQUEST, ""),
    chunks: [Buffer.from([RespStatus.INVALID_REQUEST])],
    responseChunks: [{status: RespStatus.INVALID_REQUEST, errorMessage: ""}],
  },
  {
    id: "SERVER_ERROR -  no error message",
    protocol: pingNoHandler,
    decodeError: new ResponseError(RespStatus.SERVER_ERROR, ""),
    chunks: [Buffer.from([RespStatus.SERVER_ERROR])],
    responseChunks: [{status: RespStatus.SERVER_ERROR, errorMessage: ""}],
  },
  {
    id: "SERVER_ERROR - with error message",
    protocol: pingNoHandler,
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
    protocol: pingNoHandler,
    decodeError: new ResponseError(RespStatus.SERVER_ERROR, "TEST_ERROR".padEnd(512, "0").slice(0, 256)),
    chunks: [Buffer.from([RespStatus.SERVER_ERROR]), Buffer.from("TEST_ERROR".padEnd(512, "0"))],
  },
  {
    id: "SERVER_ERROR - Remove non-ascii characters from error message",
    protocol: pingNoHandler,
    decodeError: new ResponseError(RespStatus.SERVER_ERROR, "TEST_ERROR"),
    chunks: [Buffer.from([RespStatus.SERVER_ERROR]), Buffer.from("TEST_ERROR\u03A9")],
  },
];
