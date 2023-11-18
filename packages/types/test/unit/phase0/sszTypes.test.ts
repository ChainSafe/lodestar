import {expect} from "chai";
import {intToBytes} from "@lodestar/utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {AttestationData, AttestationDataBytes8, Checkpoint, CheckpointBytes8} from "../../../src/phase0/sszTypes.js";
import {phase0} from "../../../src/types.js";

describe("CheckpointBytes8", () => {
  const epochs = [0, 1_000_000, Number.MAX_SAFE_INTEGER];

  for (const epoch of epochs) {
    it(`epoch ${epoch}`, () => {
      const root = Buffer.alloc(32, 0x00);
      const cp0 = {
        epoch,
        root,
      };
      const cp1 = {
        epoch: intToBytes(epoch, 8),
        root,
      };
      expect(Checkpoint.hashTreeRoot(cp0)).to.be.deep.equal(CheckpointBytes8.hashTreeRoot(cp1));
      expect(Checkpoint.serialize(cp0)).to.be.deep.equal(CheckpointBytes8.serialize(cp1));
    });
  }
});

describe("AttestationDataBytes8", () => {
  const epochs = [0, 1_000_000, Number.MAX_SAFE_INTEGER];
  const root = Buffer.alloc(32, 0x00);
  for (const epoch of epochs) {
    it(`epoch ${epoch}`, () => {
      const slot = SLOTS_PER_EPOCH * epoch;
      const attestationData: phase0.AttestationData = {
        slot,
        index: 0,
        beaconBlockRoot: root,
        source: {
          epoch,
          root,
        },
        target: {
          epoch,
          root,
        },
      };

      const attestationDataBytes8: phase0.AttestationDataBytes8 = {
        slot: intToBytes(slot, 8),
        index: intToBytes(0, 8),
        beaconBlockRoot: root,
        source: {
          epoch: intToBytes(epoch, 8),
          root,
        },
        target: {
          epoch: intToBytes(epoch, 8),
          root,
        },
      };

      expect(AttestationData.hashTreeRoot(attestationData)).to.be.deep.equal(
        AttestationDataBytes8.hashTreeRoot(attestationDataBytes8)
      );

      expect(AttestationData.serialize(attestationData)).to.be.deep.equal(
        AttestationDataBytes8.serialize(attestationDataBytes8)
      );
    });
  }
});
