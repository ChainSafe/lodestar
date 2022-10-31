import {pipe} from "it-pipe";
import all from "it-all";
import {Uint8ArrayList} from "uint8arraylist";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {chainConfig} from "@lodestar/config/default";
import {createIBeaconConfig} from "@lodestar/config";
import {fromHex, LodestarError} from "@lodestar/utils";
import {allForks} from "@lodestar/types";
import {
  Method,
  Version,
  Encoding,
  Protocol,
  IncomingResponseBody,
  OutgoingResponseBody,
} from "../../../../../src/network/reqresp/types.js";
import {getResponseSzzTypeByMethod} from "../../../../../src/network/reqresp/types.js";
import {
  SszSnappyError,
  SszSnappyErrorCode,
} from "../../../../../src/network/reqresp/encodingStrategies/sszSnappy/index.js";
import {responseDecode} from "../../../../../src/network/reqresp/encoders/responseDecode.js";
import {
  getForkNameFromResponseBody,
  responseEncodeError,
  responseEncodeSuccess,
} from "../../../../../src/network/reqresp/encoders/responseEncode.js";
import {ResponseError} from "../../../../../src/network/reqresp/response/index.js";
import {RespStatus, ZERO_HASH} from "../../../../../src/constants/index.js";
import {expectIsEqualSszTypeArr} from "../../../../utils/ssz.js";
import {expectRejectedWithLodestarError} from "../../../../utils/errors.js";
import {arrToSource, expectEqualByteChunks} from "../utils.js";
import {
  sszSnappyPing,
  sszSnappySignedBeaconBlockPhase0,
  sszSnappySignedBeaconBlockAltair,
} from "../encodingStrategies/sszSnappy/testData.js";
import {blocksToReqRespBlockResponses} from "../../../../utils/block.js";

type ResponseChunk =
  | {status: RespStatus.SUCCESS; body: IncomingResponseBody}
  | {status: Exclude<RespStatus, RespStatus.SUCCESS>; errorMessage: string};

describe("network / reqresp / encoders / response - Success and error cases", () => {
  const methodDefault = Method.Status;
  const encodingDefault = Encoding.SSZ_SNAPPY;

  // Set the altair fork to happen between the two precomputed SSZ snappy blocks
  const slotBlockPhase0 = sszSnappySignedBeaconBlockPhase0.body.message.slot;
  const slotBlockAltair = sszSnappySignedBeaconBlockAltair.body.message.slot;
  if (slotBlockAltair - slotBlockPhase0 < SLOTS_PER_EPOCH) {
    throw Error("phase0 block slot must be an epoch apart from altair block slot");
  }
  const ALTAIR_FORK_EPOCH = Math.floor(slotBlockAltair / SLOTS_PER_EPOCH);
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIBeaconConfig({...chainConfig, ALTAIR_FORK_EPOCH}, ZERO_HASH);

  const testCases: {
    id: string;
    method?: Method;
    version?: Version;
    encoding?: Encoding;
    chunks?: Uint8ArrayList[];
    responseChunks?: ResponseChunk[];
    // decode only
    decodeError?: LodestarError<any>;
    // encode only
    encodeError?: LodestarError<any>;
    skipEncoding?: boolean;
  }[] = [
    {
      id: "No chunks should be ok",
      method: Method.Ping,
      encoding: Encoding.SSZ_SNAPPY,
      responseChunks: [],
      chunks: [],
    },
    {
      id: "Empty response chunk - Error",
      method: Method.Ping,
      encoding: Encoding.SSZ_SNAPPY,
      decodeError: new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED}),
      chunks: [new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS]))],
      // Not possible to encode this invalid case
    },
    {
      id: "Single chunk - wrong body SSZ type",
      method: Method.Status,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      responseChunks: [{status: RespStatus.SUCCESS, body: BigInt(1)}],
      chunks: [new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])), ...sszSnappyPing.chunks],
      // decode will throw since Ping's Uint64 is smaller than Status min size
      decodeError: new SszSnappyError({code: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE, minSize: 84, sszDataLength: 8}),
      // encode will throw when trying to serialize a Uint64
      encodeError: new SszSnappyError({
        code: SszSnappyErrorCode.SERIALIZE_ERROR,
        serializeError: Error("Cannot convert undefined or null to object"),
      }),
    },
    {
      id: "block v1 without <context-bytes>",
      method: Method.BeaconBlocksByRange,
      version: Version.V1,
      encoding: Encoding.SSZ_SNAPPY,
      responseChunks: [{status: RespStatus.SUCCESS, body: sszSnappySignedBeaconBlockPhase0.body}],
      chunks: [
        // <result>
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])),
        // <encoding-dependent-header> | <encoded-payload>
        ...sszSnappySignedBeaconBlockPhase0.chunks,
      ],
    },
    {
      id: "block v2 with <context-bytes> phase0",
      method: Method.BeaconBlocksByRange,
      version: Version.V2,
      encoding: Encoding.SSZ_SNAPPY,
      responseChunks: [{status: RespStatus.SUCCESS, body: sszSnappySignedBeaconBlockPhase0.body}],
      chunks: [
        // <result>
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])),
        // <context-bytes>
        new Uint8ArrayList(config.forkName2ForkDigest(ForkName.phase0)),
        // <encoding-dependent-header> | <encoded-payload>
        ...sszSnappySignedBeaconBlockPhase0.chunks,
      ],
    },
    {
      id: "block v2 with <context-bytes> altair",
      method: Method.BeaconBlocksByRange,
      version: Version.V2,
      encoding: Encoding.SSZ_SNAPPY,
      responseChunks: [{status: RespStatus.SUCCESS, body: sszSnappySignedBeaconBlockAltair.body}],
      chunks: [
        // <result>
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])),
        // <context-bytes>
        new Uint8ArrayList(config.forkName2ForkDigest(ForkName.altair)),
        // <encoding-dependent-header> | <encoded-payload>
        ...sszSnappySignedBeaconBlockAltair.chunks,
      ],
    },

    {
      id: "Multiple chunks with success",
      method: Method.Ping,
      encoding: Encoding.SSZ_SNAPPY,
      responseChunks: [
        {status: RespStatus.SUCCESS, body: sszSnappyPing.body},
        {status: RespStatus.SUCCESS, body: sszSnappyPing.body},
      ],
      chunks: [
        // Chunk 0 - success
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])),
        ...sszSnappyPing.chunks,
        // Chunk 1 - success
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])),
        ...sszSnappyPing.chunks,
      ],
    },
    {
      id: "Multiple chunks with final error, should error",
      method: Method.Ping,
      encoding: Encoding.SSZ_SNAPPY,
      decodeError: new ResponseError(RespStatus.SERVER_ERROR, ""),
      responseChunks: [
        {status: RespStatus.SUCCESS, body: sszSnappyPing.body},
        {status: RespStatus.SUCCESS, body: sszSnappyPing.body},
        {status: RespStatus.SERVER_ERROR, errorMessage: ""},
      ],
      chunks: [
        // Chunk 0 - success
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])),
        ...sszSnappyPing.chunks,
        // Chunk 1 - success
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])),
        ...sszSnappyPing.chunks,
        // Chunk 2 - error
        new Uint8ArrayList(Buffer.from([RespStatus.SERVER_ERROR])),
      ],
    },
    {
      id: "Decode successfully response_chunk as a single Uint8ArrayList",
      method: Method.Ping,
      encoding: Encoding.SSZ_SNAPPY,
      responseChunks: [
        {status: RespStatus.SUCCESS, body: BigInt(1)},
        {status: RespStatus.SUCCESS, body: BigInt(1)},
      ],
      chunks: [
        // success, Ping payload = BigInt(1)
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS]), ...sszSnappyPing.chunks),
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS]), ...sszSnappyPing.chunks),
      ],
      // It's not able to produce a single concatenated chunk with our encoder
      skipEncoding: true,
    },

    {
      id: "Decode successfully response_chunk as a single concated chunk",
      method: Method.Ping,
      encoding: Encoding.SSZ_SNAPPY,
      responseChunks: [
        {status: RespStatus.SUCCESS, body: BigInt(1)},
        {status: RespStatus.SUCCESS, body: BigInt(1)},
      ],
      chunks: [
        // success, Ping payload = BigInt(1)
        new Uint8ArrayList(
          Buffer.concat([Buffer.from([RespStatus.SUCCESS]), ...sszSnappyPing.chunks.map((c) => c.subarray())])
        ),
        new Uint8ArrayList(
          Buffer.concat([Buffer.from([RespStatus.SUCCESS]), ...sszSnappyPing.chunks.map((c) => c.subarray())])
        ),
      ],
      // It's not able to produce a single concatenated chunk with our encoder
      skipEncoding: true,
    },

    {
      id: "Decode blocks v2 through a fork with multiple types",
      method: Method.BeaconBlocksByRange,
      version: Version.V2,
      encoding: Encoding.SSZ_SNAPPY,
      responseChunks: [
        {status: RespStatus.SUCCESS, body: sszSnappySignedBeaconBlockPhase0.body},
        {status: RespStatus.SUCCESS, body: sszSnappySignedBeaconBlockAltair.body},
      ],
      chunks: [
        // Chunk 0 - success block in phase0 with context bytes
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])),
        new Uint8ArrayList(config.forkName2ForkDigest(ForkName.phase0)),
        ...sszSnappySignedBeaconBlockPhase0.chunks,
        // Chunk 1 - success block in altair with context bytes
        new Uint8ArrayList(Buffer.from([RespStatus.SUCCESS])),
        new Uint8ArrayList(config.forkName2ForkDigest(ForkName.altair)),
        ...sszSnappySignedBeaconBlockAltair.chunks,
      ],
    },

    // Errored requests
    {
      id: "INVALID_REQUEST - no error message",
      decodeError: new ResponseError(RespStatus.INVALID_REQUEST, ""),
      chunks: [new Uint8ArrayList(Buffer.from([RespStatus.INVALID_REQUEST]))],
      responseChunks: [{status: RespStatus.INVALID_REQUEST, errorMessage: ""}],
    },
    {
      id: "SERVER_ERROR -  no error message",
      decodeError: new ResponseError(RespStatus.SERVER_ERROR, ""),
      chunks: [new Uint8ArrayList(Buffer.from([RespStatus.SERVER_ERROR]))],
      responseChunks: [{status: RespStatus.SERVER_ERROR, errorMessage: ""}],
    },
    {
      id: "SERVER_ERROR - with error message",
      decodeError: new ResponseError(RespStatus.SERVER_ERROR, "sNaPpYIzTEST_ERROR"),
      chunks: [
        new Uint8ArrayList(Buffer.from([RespStatus.SERVER_ERROR])),
        new Uint8ArrayList(fromHexBuf("0x0a")),
        new Uint8ArrayList(fromHexBuf("0xff060000734e61507059010e000049b97aaf544553545f4552524f52")),
      ],
      responseChunks: [{status: RespStatus.SERVER_ERROR, errorMessage: "TEST_ERROR"}],
    },
    // This last two error cases are not possible to encode since are invalid. Test decoding only
    {
      id: "SERVER_ERROR - Slice long error message",
      decodeError: new ResponseError(RespStatus.SERVER_ERROR, "TEST_ERROR".padEnd(512, "0").slice(0, 256)),
      chunks: [
        new Uint8ArrayList(Buffer.from([RespStatus.SERVER_ERROR])),
        new Uint8ArrayList(Buffer.from("TEST_ERROR".padEnd(512, "0"))),
      ],
    },
    {
      id: "SERVER_ERROR - Remove non-ascii characters from error message",
      decodeError: new ResponseError(RespStatus.SERVER_ERROR, "TEST_ERROR"),
      chunks: [
        new Uint8ArrayList(Buffer.from([RespStatus.SERVER_ERROR])),
        new Uint8ArrayList(Buffer.from("TEST_ERROR\u03A9")),
      ],
    },
  ];

  async function* responseEncode(responseChunks: ResponseChunk[], protocol: Protocol): AsyncIterable<Buffer> {
    for (const chunk of responseChunks) {
      if (chunk.status === RespStatus.SUCCESS) {
        const lodestarResponseBodies =
          protocol.method === Method.BeaconBlocksByRange || protocol.method === Method.BeaconBlocksByRoot
            ? blocksToReqRespBlockResponses([chunk.body] as allForks.SignedBeaconBlock[], config)
            : [chunk.body];
        yield* pipe(
          arrToSource(lodestarResponseBodies as OutgoingResponseBody[]),
          responseEncodeSuccess(config, protocol)
        );
      } else {
        yield* responseEncodeError(protocol, chunk.status, chunk.errorMessage);
      }
    }
  }

  for (const testData of testCases) {
    const {
      id,
      method = methodDefault,
      version = Version.V1,
      encoding = encodingDefault,
      chunks,
      responseChunks,
      decodeError,
      encodeError,
      skipEncoding,
    } = testData;
    const protocol: Protocol = {method, version, encoding};

    if (chunks) {
      it(`${id} - responseDecode`, async () => {
        const responseDecodePromise = pipe(
          arrToSource(chunks),
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          responseDecode(config, protocol, {onFirstHeader: () => {}, onFirstResponseChunk: () => {}}),
          all
        );

        if (decodeError) {
          await expectRejectedWithLodestarError(responseDecodePromise, decodeError);
        } else if (responseChunks) {
          const responses = await responseDecodePromise;
          const typeArr = responses.map((body) => {
            const forkName = getForkNameFromResponseBody(config, protocol, body);
            return getResponseSzzTypeByMethod(protocol, forkName);
          });
          expectIsEqualSszTypeArr(typeArr, responses, onlySuccessChunks(responseChunks), "Response chunks");
        } else {
          throw Error("Bad testCase");
        }
      });
    }

    if (responseChunks && !skipEncoding) {
      it(`${id} - responseEncode`, async () => {
        const resultPromise = all(responseEncode(responseChunks, protocol));

        if (encodeError) {
          await expectRejectedWithLodestarError(resultPromise, encodeError);
        } else if (chunks) {
          const encodedChunks = await resultPromise;
          expectEqualByteChunks(
            encodedChunks,
            chunks.map((c) => c.subarray())
          );
        } else {
          throw Error("Bad testCase");
        }
      });
    }
  }
});

function onlySuccessChunks(responseChunks: ResponseChunk[]): IncomingResponseBody[] {
  const bodyArr: IncomingResponseBody[] = [];
  for (const chunk of responseChunks) {
    if (chunk.status === RespStatus.SUCCESS) bodyArr.push(chunk.body);
  }
  return bodyArr;
}

function fromHexBuf(hex: string): Buffer {
  return Buffer.from(fromHex(hex));
}
