import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {getParentBlockHashFromGloasSignedBeaconBlockSerialized} from "../../../src/util/sszBytes.js";

describe("getParentBlockHashFromGloasSignedBeaconBlockSerialized (minimal preset)", () => {
  for (const fork of [ForkName.gloas, ForkName.heze] as const) {
    it(`extracts parent block hash from a ${fork} signed beacon block`, () => {
      const signedBeaconBlockType = sszTypesFor(fork).SignedBeaconBlock;
      const signedBeaconBlock = signedBeaconBlockType.defaultValue();
      signedBeaconBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash = Buffer.alloc(32, 0xaa);
      signedBeaconBlock.message.body.voluntaryExits.push(ssz.phase0.SignedVoluntaryExit.defaultValue());
      const bytes = signedBeaconBlockType.serialize(signedBeaconBlock);

      expect(getParentBlockHashFromGloasSignedBeaconBlockSerialized(bytes, fork)).toBe(
        toHex(signedBeaconBlock.message.body.signedExecutionPayloadBid.message.parentBlockHash)
      );
    });
  }
});
