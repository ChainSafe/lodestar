import {describe, expect, it} from "vitest";
import {LodestarError} from "@lodestar/utils";
import {responseDecode} from "../../../src/encoders/responseDecode.js";
import {ResponseIncoming} from "../../../src/types.js";
import {responseEncodersErrorTestCases, responseEncodersTestCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {arrToSource, onlySuccessResp} from "../../utils/index.js";
import {createMockStream} from "../../utils/mockStream.js";

describe("encoders / responseDecode", () => {
  describe("valid cases", () => {
    it.each(responseEncodersTestCases)("$id", async ({protocol, responseChunks, chunks}) => {
      const {stream} = await createMockStream({source: arrToSource(chunks)});
      const responses = (await Array.fromAsync(responseDecode(protocol, stream))) as ResponseIncoming[];

      const expectedResponses = responseChunks.filter(onlySuccessResp).map((r) => r.payload);
      expect(responses.map((r) => ({...r, data: Buffer.from(r.data)}))).toEqual(
        expectedResponses.map((r) => ({...r, data: Buffer.from(r.data)}))
      );
    });
  });

  describe("error cases", () => {
    it.each(responseEncodersErrorTestCases.filter((r) => r.decodeError !== undefined))(
      "$id",
      async ({protocol, chunks, decodeError}) => {
        const {stream} = await createMockStream({source: arrToSource(chunks as Uint8Array[])});
        await expectRejectedWithLodestarError(
          Array.fromAsync(responseDecode(protocol, stream)),
          decodeError as LodestarError<any>
        );
      }
    );
  });
});
