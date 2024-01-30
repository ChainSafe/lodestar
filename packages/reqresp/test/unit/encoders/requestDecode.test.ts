import {describe, it, expect} from "vitest";
import {pipe} from "it-pipe";
import {requestDecode} from "../../../src/encoders/requestDecode.js";
import {requestEncodersCases, requestEncodersErrorCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {arrToSource} from "../../utils/index.js";

describe("encoders / requestDecode", () => {
  describe("valid cases", () => {
    it.each(requestEncodersCases)("$id", async ({protocol, requestBody, chunks}) => {
      const decodedBody = await pipe(arrToSource(chunks), requestDecode(protocol));
      expect(decodedBody).toEqual(requestBody);
    });
  });

  describe("error cases", () => {
    it.each(requestEncodersErrorCases.filter((r) => r.errorDecode))("$id", async ({protocol, errorDecode, chunks}) => {
      await expectRejectedWithLodestarError(pipe(arrToSource(chunks), requestDecode(protocol)), errorDecode);
    });
  });
});
