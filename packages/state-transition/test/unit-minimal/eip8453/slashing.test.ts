import {describe, expect, it} from "vitest";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {eip8453} from "@lodestar/types";
import {EMPTY_CHECKPOINT, Eip8453Harness, range} from "./harness.js";

const N = 64;

describe("eip8453 attester slashings", () => {
  function data(height: number, fill: number, timeout = false, finality = EMPTY_CHECKPOINT): eip8453.AttestationData {
    return {target: {height, root: new Uint8Array(32).fill(fill)}, timeout, finality};
  }

  it("slashes a double target vote at the same height", () => {
    const h = new Eip8453Harness(N);
    h.advanceTo(1);
    const slashing: eip8453.AttesterSlashing = {
      attestation1: h.slashingAttestation(1, range(0, 4), data(3, 0xaa)),
      attestation2: h.slashingAttestation(1, range(2, 6), data(3, 0xbb)),
    };
    h.produceBlock(1, {attesterSlashings: [slashing]});
    const validators = h.state.validators.getAllReadonlyValues();
    expect(validators.slice(2, 4).every((v) => v.slashed)).toBe(true);
    expect(validators.filter((v) => v.slashed).length).toBe(2);
    expect(validators[2].exitEpoch).not.toBe(FAR_FUTURE_EPOCH);
  });

  it("slashes a timeout against a finality lock at the same height", () => {
    const h = new Eip8453Harness(N);
    h.advanceTo(1);
    const lock = {height: 3, root: new Uint8Array(32).fill(0xaa)};
    const slashing: eip8453.AttesterSlashing = {
      // a finality vote for height 3 ...
      attestation1: h.slashingAttestation(1, range(0, 4), data(4, 0xcc, false, lock)),
      // ... and a timeout at height 3
      attestation2: h.slashingAttestation(1, range(0, 4), data(3, 0xaa, true)),
    };
    h.produceBlock(1, {attesterSlashings: [slashing]});
    expect(h.state.validators.getAllReadonlyValues().filter((v) => v.slashed).length).toBe(4);
  });

  it("rejects non-slashable pairs and bad signatures", () => {
    const h = new Eip8453Harness(N);
    h.advanceTo(1);
    // same target, different timeout bit: not slashable
    expect(() =>
      h.produceBlock(1, {
        attesterSlashings: [
          {
            attestation1: h.slashingAttestation(1, range(0, 4), data(3, 0xaa)),
            attestation2: h.slashingAttestation(1, range(0, 4), data(3, 0xaa, true)),
          },
        ],
      })
    ).toThrow(/not slashable/);
    // double vote but no intersecting validators
    expect(() =>
      h.produceBlock(1, {
        attesterSlashings: [
          {
            attestation1: h.slashingAttestation(1, range(0, 4), data(3, 0xaa)),
            attestation2: h.slashingAttestation(1, range(4, 8), data(3, 0xbb)),
          },
        ],
      })
    ).toThrow(/did not result/);
    // bad signature
    const bad = h.slashingAttestation(1, range(0, 4), data(3, 0xbb));
    bad.signature = h.slashingAttestation(1, range(0, 4), data(3, 0xcc)).signature;
    expect(() =>
      h.produceBlock(1, {
        attesterSlashings: [{attestation1: h.slashingAttestation(1, range(0, 4), data(3, 0xaa)), attestation2: bad}],
      })
    ).toThrow(/invalid/);
  });
});
