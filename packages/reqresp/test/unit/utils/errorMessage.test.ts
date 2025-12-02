import {Uint8ArrayList} from "uint8arraylist";
import {describe, expect, it} from "vitest";
import {Encoding} from "../../../src/types.js";
import {decodeErrorMessage, encodeErrorMessage} from "../../../src/utils/errorMessage.js";

describe("encode and decode error message", () => {
  // refer to https://github.com/ChainSafe/lodestar/issues/8065#issuecomment-3157266196
  const testCases: {name: string; errorMessage: string}[] = [
    {
      name: "Lighthouse - rate limited",
      errorMessage: "Rate limited. There are already 2 active requests with the same protocol",
    },
    {
      name: "Prysm - rate limited",
      errorMessage: "rate limited",
    },
    {
      name: "Teku - rate limited",
      errorMessage: "Peer has been rate limited",
    },
    {
      name: "NA - rate limited",
      errorMessage: "rate limited",
    },
    // see https://github.com/ChainSafe/lodestar/issues/8110
    {
      name: "NA - Wait n seconds",
      errorMessage: "Wait 2.816488536s",
    },
    {
      name: "Lodestar - Timeout",
      errorMessage: "Timeout",
    },
  ];
  for (const {name, errorMessage} of testCases) {
    it(name, async () => {
      const buffers = await encodeErrorMessage(errorMessage, Encoding.SSZ_SNAPPY);
      const accu: Uint8ArrayList = new Uint8ArrayList();
      for await (const buffer of buffers) {
        accu.append(buffer);
      }

      const encodedMessage = accu.subarray(0);
      const decodedErrorMessage = await decodeErrorMessage(encodedMessage);
      expect(decodedErrorMessage).toBe(errorMessage);
    });
  }
});
