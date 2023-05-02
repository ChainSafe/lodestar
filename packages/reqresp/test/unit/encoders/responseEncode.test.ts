import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import all from "it-all";
import {pipe} from "it-pipe";
import {Protocol} from "../../../src/types.js";
import {responseEncodersTestCases} from "../../fixtures/encoders.js";
import {responseEncode} from "../../utils/response.js";
import {expectEqualByteChunks} from "../../utils/index.js";

chai.use(chaiAsPromised);

describe("encoders / responseEncode", () => {
  describe("valid cases", () => {
    for (const {id, protocol, responseChunks, chunks} of responseEncodersTestCases.filter((f) => !f.skipEncoding)) {
      it(`${id}`, async () => {
        const encodedChunks = await pipe(responseEncode(responseChunks, protocol as Protocol), all);

        expectEqualByteChunks(
          encodedChunks as Uint8Array[],
          chunks.map((c) => c.subarray())
        );
      });
    }
  });
});
