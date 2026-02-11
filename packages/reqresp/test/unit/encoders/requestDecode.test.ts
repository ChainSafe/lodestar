import {describe, expect, it} from "vitest";
import {requestDecode} from "../../../src/encoders/requestDecode.js";
import {requestEncodersCases, requestEncodersErrorCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {arrToSource} from "../../utils/index.js";
import {createMockStream} from "../../utils/mockStream.js";

describe("encoders / requestDecode", () => {
  describe("valid cases", () => {
    it.each(requestEncodersCases)("$id", async ({protocol, requestBody, chunks}) => {
      const {stream} = await createMockStream({source: arrToSource(chunks)});
      const decodedBody = await requestDecode(protocol, stream);
      expect(decodedBody).toEqual(requestBody);
    });
  });

  describe("error cases", () => {
    it.each(requestEncodersErrorCases.filter((r) => r.errorDecode))("$id", async ({protocol, errorDecode, chunks}) => {
      const {stream} = await createMockStream({source: arrToSource(chunks)});
      await expectRejectedWithLodestarError(requestDecode(protocol, stream), errorDecode);
    });
  });
});
