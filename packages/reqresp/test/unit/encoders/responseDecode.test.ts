import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import all from "it-all";
import {pipe} from "it-pipe";
import {LodestarError} from "@lodestar/utils";
import {responseDecode} from "../../../src/encoders/responseDecode.js";
import {responseEncodersErrorTestCases, responseEncodersTestCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {arrToSource, onlySuccessResp} from "../../utils/index.js";

chai.use(chaiAsPromised);

describe("encoders / responseDecode", () => {
  describe("valid cases", () => {
    for (const {id, protocol, responseChunks, chunks} of responseEncodersTestCases) {
      it(`${id}`, async () => {
        const responses = await pipe(
          arrToSource(chunks),
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          responseDecode(protocol, {onFirstHeader: () => {}, onFirstResponseChunk: () => {}}),
          all
        );

        const expectedResponses = responseChunks.filter(onlySuccessResp).map((r) => r.payload);
        expect(responses).to.deep.equal(expectedResponses);
      });
    }
  });

  describe("error cases", () => {
    for (const {id, protocol, chunks, decodeError} of responseEncodersErrorTestCases.filter(
      (r) => r.decodeError !== undefined
    )) {
      it(`${id}`, async () => {
        await expectRejectedWithLodestarError(
          pipe(
            arrToSource(chunks as Uint8Array[]),
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            responseDecode(protocol, {onFirstHeader: () => {}, onFirstResponseChunk: () => {}}),
            all
          ),
          decodeError as LodestarError<any>
        );
      });
    }
  });
});
