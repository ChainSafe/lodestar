import {describe, expect, it} from "vitest";
import {blsImplementation, deserializePublicKey, serializePublicKey, verifyAggregate} from "#light-client-bls";
import {message, publicKey, signature} from "../utils/lightClientBls.js";

describe("light client Node.js BLS implementation", () => {
  it("uses lodestar-z", () => {
    expect(blsImplementation).toBe("lodestar-z");
  });

  it("verifies a sync committee signature", () => {
    const deserializedPublicKey = deserializePublicKey(publicKey);

    expect(serializePublicKey(deserializedPublicKey)).toEqual(publicKey);
    expect(verifyAggregate([deserializedPublicKey], message, signature)).toBe(true);
  });
});
