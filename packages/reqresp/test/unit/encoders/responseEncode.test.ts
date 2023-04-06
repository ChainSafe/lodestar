import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import all from "it-all";
import {pipe} from "it-pipe";
import {LodestarError} from "@lodestar/utils";
import {ResponseChunk, responseEncodersErrorTestCases, responseEncodersTestCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {expectEqualByteChunks} from "../../utils/index.js";
import {responseEncode} from "../../utils/response.js";
import {ProtocolDefinition} from "../../../src/types.js";

chai.use(chaiAsPromised);

describe("encoders / responseEncode", () => {
  describe("valid cases", () => {
    for (const {id, protocol, responseChunks, chunks} of responseEncodersTestCases.filter((f) => !f.skipEncoding)) {
      it(`${id}`, async () => {
        const encodedChunks = await pipe(responseEncode(responseChunks, protocol as ProtocolDefinition<any, any>), all);

        expectEqualByteChunks(
          encodedChunks as Uint8Array[],
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
          pipe(responseEncode(responseChunks as ResponseChunk[], protocol as ProtocolDefinition<any, any>), all),
          encodeError as LodestarError<any>
        );
      });
    }
  });
});
