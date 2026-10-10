import {describe, expect, it} from "vitest";
import {ForkName, SYNC_COMMITTEE_SIZE} from "@lodestar/params";
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

    it(`rejects truncated and out-of-range ${fork} bid offsets`, () => {
      const block = sszTypesFor(fork).SignedBeaconBlock.defaultValue();
      const bytes = sszTypesFor(fork).SignedBeaconBlock.serialize(block);
      const bodyStart = 184;
      const offsetPointer =
        bodyStart + 96 + 32 + 4 * 5 + SYNC_COMMITTEE_SIZE / 8 + 96 + (fork === ForkName.gloas ? 76 : 0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const hashEnd = bodyStart + view.getUint32(offsetPointer, true) + 100 + 32;
      expect(getParentBlockHashFromGloasSignedBeaconBlockSerialized(bytes.subarray(0, hashEnd - 1), fork)).toBeNull();
      for (const offset of [0x7fffffff, 0x80000000, 0xffffffff]) {
        view.setUint32(offsetPointer, offset, true);
        expect(getParentBlockHashFromGloasSignedBeaconBlockSerialized(bytes, fork), `offset ${offset}`).toBeNull();
      }
    });
  }
});
