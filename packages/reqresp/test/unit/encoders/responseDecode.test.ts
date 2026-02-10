import {describe, expect, it} from "vitest";
import {LodestarError} from "@lodestar/utils";
import {responseDecode} from "../../../src/encoders/responseDecode.js";
import {ResponseIncoming} from "../../../src/types.js";
import {responseEncodersErrorTestCases, responseEncodersTestCases} from "../../fixtures/encoders.js";
import {expectRejectedWithLodestarError} from "../../utils/errors.js";
import {arrToSource, onlySuccessResp} from "../../utils/index.js";

describe("encoders / responseDecode", () => {
  describe("valid cases", () => {
    it.each(responseEncodersTestCases)("$id", async ({protocol, responseChunks, chunks}) => {
      const decodeResponses = responseDecode(protocol, {onFirstHeader: () => {}, onFirstResponseChunk: () => {}});
      const responses = (await Array.fromAsync(decodeResponses(arrToSource(chunks)))) as ResponseIncoming[];

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
        const decodeResponses = responseDecode(protocol, {onFirstHeader: () => {}, onFirstResponseChunk: () => {}});
        await expectRejectedWithLodestarError(
          Array.fromAsync(decodeResponses(arrToSource(chunks as Uint8Array[]))),
          decodeError as LodestarError<any>
        );
      }
    );
  });
});
