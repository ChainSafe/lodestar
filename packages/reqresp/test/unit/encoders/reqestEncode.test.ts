import all from "it-all";
import {pipe} from "it-pipe";
import {requestEncode} from "../../../src/encoders/requestEncode.js";
import {requestEncodersCases} from "../../fixtures/encoders.js";
import {expectEqualByteChunks} from "../../utils/index.js";

describe("encoders / requestEncode", () => {
  describe("valid cases", () => {
    for (const {id, protocol, requestBody, chunks} of requestEncodersCases) {
      it(`${id}`, async () => {
        const encodedChunks = await pipe(requestEncode(protocol, requestBody), all);
        expectEqualByteChunks(
          encodedChunks as Uint8Array[],
          chunks.map((c) => c.subarray())
        );
      });
    }
  });
});
