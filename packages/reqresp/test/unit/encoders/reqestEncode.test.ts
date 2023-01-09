import all from "it-all";
import {pipe} from "it-pipe";
import {LodestarError} from "@lodestar/utils";
import {requestEncode} from "../../../src/encoders/requestEncode.js";
import {requestEncodersCases, requestEncodersErrorCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {expectEqualByteChunks} from "../../utils/index.js";

describe("encoders / requestEncode", () => {
  describe("valid cases", () => {
    for (const {id, protocol, requestBody, chunks} of requestEncodersCases) {
      it(`${id}`, async () => {
        const encodedChunks = await pipe(requestEncode(protocol, requestBody), all);
        expectEqualByteChunks(
          encodedChunks,
          chunks.map((c) => c.subarray())
        );
      });
    }
  });

  describe("error cases", () => {
    for (const {id, protocol, requestBody, errorEncode} of requestEncodersErrorCases.filter((r) => r.errorEncode)) {
      it(`${id}`, async () => {
        await expectRejectedWithLodestarError(
          pipe(requestEncode(protocol, requestBody), all),
          errorEncode as LodestarError<any>
        );
      });
    }
  });
});
