import chai, {expect} from "chai";
import chaiAsPromised from "chai-as-promised";
import {pipe} from "it-pipe";
import {LodestarError} from "@lodestar/utils";
import {requestDecode} from "../../../src/encoders/requestDecode.js";
import {requestEncodersCases, requestEncodersErrorCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {arrToSource} from "../../utils/index.js";

chai.use(chaiAsPromised);

describe("encoders / requestDecode", () => {
  describe("valid cases", () => {
    for (const {id, protocol, requestBody, chunks} of requestEncodersCases) {
      it(`${id}`, async () => {
        // TODO: Debug this type error
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const decodedBody = await pipe(arrToSource(chunks), requestDecode(protocol));
        expect(decodedBody).to.equal(requestBody);
      });
    }
  });

  describe("error cases", () => {
    for (const {id, protocol, errorDecode, chunks} of requestEncodersErrorCases.filter((r) => r.errorDecode)) {
      it(`${id}`, async () => {
        await expectRejectedWithLodestarError(
          pipe(arrToSource(chunks), requestDecode(protocol)),
          errorDecode as LodestarError<any>
        );
      });
    }
  });
});
