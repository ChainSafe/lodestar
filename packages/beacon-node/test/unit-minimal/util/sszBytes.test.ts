import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {getParentBlockHashFromGloasSignedBeaconBlockSerialized} from "../../../src/util/sszBytes.js";

describe("getParentBlockHashFromGloasSignedBeaconBlockSerialized (minimal preset)", () => {
  it("extracts parent block hash using the minimal sync aggregate size", () => {
    const signedBeaconBlock = ssz.gloas.SignedBeaconBlock.defaultValue();
    signedBeaconBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash = Buffer.alloc(32, 0xaa);
    signedBeaconBlock.message.body.voluntaryExits.push(ssz.phase0.SignedVoluntaryExit.defaultValue());
    const bytes = ssz.gloas.SignedBeaconBlock.serialize(signedBeaconBlock);

    expect(getParentBlockHashFromGloasSignedBeaconBlockSerialized(bytes)).toBe(
      toHex(signedBeaconBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash)
    );
  });

  it("returns null for an incomplete bid offset", () => {
    for (const size of [0, 200, 511]) {
      expect(getParentBlockHashFromGloasSignedBeaconBlockSerialized(new Uint8Array(size)), `size ${size}`).toBeNull();
    }
  });
});
