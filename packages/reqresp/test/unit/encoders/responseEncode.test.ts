import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import all from "it-all";
import {pipe} from "it-pipe";
import {LodestarError} from "@lodestar/utils";
import {allForks} from "@lodestar/types";
import {responseEncodeError, responseEncodeSuccess} from "../../../src/encoders/responseEncode.js";
import {RespStatus} from "../../../src/interface.js";
import {EncodedPayload, EncodedPayloadType, ProtocolDefinition} from "../../../src/types.js";
import {ResponseChunk, responseEncodersErrorTestCases, responseEncodersTestCases} from "../../fixtures/encoders.js";
import {blocksToReqRespBlockResponses} from "../../utils/block.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {arrToSource, expectEqualByteChunks} from "../../utils/index.js";
import {beaconConfig} from "../../fixtures/messages.js";

chai.use(chaiAsPromised);

async function* responseEncode(
  responseChunks: ResponseChunk[],
  protocol: ProtocolDefinition<any, any>
): AsyncIterable<Buffer> {
  for (const chunk of responseChunks) {
    if (chunk.status === RespStatus.SUCCESS) {
      if (chunk.payload.type === EncodedPayloadType.bytes) {
        return [chunk.payload.bytes];
      }

      const lodestarResponseBodies = protocol.method.startsWith("beacon_blocks")
        ? blocksToReqRespBlockResponses(([chunk.payload.data] as unknown) as allForks.SignedBeaconBlock[], beaconConfig)
        : [chunk.payload];

      yield* pipe(
        arrToSource(lodestarResponseBodies as EncodedPayload<allForks.SignedBeaconBlock>[]),
        responseEncodeSuccess(protocol)
      );
    } else {
      yield* responseEncodeError(protocol, chunk.status, chunk.errorMessage);
    }
  }
}

describe("encoders / responseEncode", () => {
  describe("valid cases", () => {
    for (const {id, protocol, responseChunks, chunks} of responseEncodersTestCases.filter((f) => !f.skipEncoding)) {
      it(`${id}`, async () => {
        const encodedChunks = await pipe(responseEncode(responseChunks, protocol), all);

        expectEqualByteChunks(
          encodedChunks,
          chunks.map((c) => c.subarray())
        );
      });
    }
  });

  describe("error cases", () => {
    for (const {id, protocol, responseChunks, encodeError} of responseEncodersErrorTestCases.filter(
      (r) => r.encodeError !== undefined && r.responseChunks !== undefined
    )) {
      it(`${id}`, async () => {
        await expectRejectedWithLodestarError(
          pipe(responseEncode(responseChunks as ResponseChunk[], protocol), all),
          encodeError as LodestarError<any>
        );
      });
    }
  });
});
