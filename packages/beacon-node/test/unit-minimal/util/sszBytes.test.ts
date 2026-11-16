import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {getParentPayloadRootFromGloasSignedBeaconBlockSerialized} from "../../../src/util/sszBytes.js";

describe("getParentPayloadRootFromGloasSignedBeaconBlockSerialized (minimal preset)", () => {
  for (const fork of [ForkName.gloas, ForkName.heze] as const) {
    it(`extracts parent payload root from a ${fork} signed beacon block`, () => {
      const signedBeaconBlockType = sszTypesFor(fork).SignedBeaconBlock;
      const signedBeaconBlock = signedBeaconBlockType.defaultValue();
      // Distinct neighbours so reading the wrong bid field cannot pass
      const bid = signedBeaconBlock.message.body.signedExecutionPayloadBid.message;
      bid.parentBlockHash = Buffer.alloc(32, 0xaa);
      bid.parentPayloadRoot = Buffer.alloc(32, 0xab);
      bid.parentBlockRoot = Buffer.alloc(32, 0xbb);
      signedBeaconBlock.message.body.voluntaryExits.push(ssz.phase0.SignedVoluntaryExit.defaultValue());
      const bytes = signedBeaconBlockType.serialize(signedBeaconBlock);

      expect(getParentPayloadRootFromGloasSignedBeaconBlockSerialized(bytes, fork)).toBe(toHex(bid.parentPayloadRoot));
    });
  }

  it("returns null for an incomplete bid offset", () => {
    for (const size of [0, 200, 511]) {
      expect(
        getParentPayloadRootFromGloasSignedBeaconBlockSerialized(new Uint8Array(size), ForkName.gloas),
        `size ${size}`
      ).toBeNull();
    }
  });
});
