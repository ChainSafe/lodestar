import fs from "node:fs";
import path from "node:path";
import {describe, it, expect, beforeAll} from "vitest";
import {BeaconState, Epoch, phase0, RootHex, Slot, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {XDelta3Codec} from "../../../../../src/chain/historicalState/utils/xdelta3.js";
import {generateState} from "../../../../utils/state.js";
import {IBinaryDiffCodec} from "../../../../../src/chain/historicalState/types.js";

const testsCases: {title: string; base: () => Uint8Array; changed: () => Uint8Array}[] = [
  {
    title: "Simple string",
    base: () => Uint8Array.from(Buffer.from("Lodestar")),
    changed: () => Uint8Array.from(Buffer.from("Lodestar Shines")),
  },
  {
    title: "Array of numbers",
    base: () => Uint8Array.from([10, 11, 12, 13, 14, 15]),
    changed: () => Uint8Array.from([10, 11, 12, 14, 15, 16, 17, 18]),
  },
  {
    title: "An attestation",
    base: () => ssz.phase0.Attestation.serialize(ssz.phase0.Attestation.defaultValue()),
    changed: () =>
      ssz.phase0.Attestation.serialize(
        attestationFromValues(
          4_000_000,
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          200_00,
          "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
        )
      ),
  },
  {
    title: "Phase 0 beacon state",
    base: () => {
      const state = generateState({slot: 0});
      return ssz.phase0.BeaconState.serialize(state.toValue() as BeaconState<ForkName.phase0>);
    },
    changed: () => {
      const state = generateState({slot: 0});
      state.balances.set(0, state.balances.get(0) + 1000);
      state.commit();
      return ssz.phase0.BeaconState.serialize(state.toValue() as BeaconState<ForkName.phase0>);
    },
  },
  {
    title: "Sepolia state",
    base: () => {
      return Buffer.from(
        fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/binaryDiff/source.txt"), "utf8"),
        "hex"
      );
    },
    changed: () => {
      return Buffer.from(
        fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/binaryDiff/input.txt"), "utf8"),
        "hex"
      );
    },
  },
];

const binaryValue = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "utf8"));

describe("BinaryDiffCodec", () => {
  let codec: IBinaryDiffCodec;
  let multiDiffData: Record<string, {value: Uint8Array; diff: Uint8Array}>;

  beforeAll(async () => {
    codec = new XDelta3Codec();
    await codec.init();

    multiDiffData = {
      snapshot: {
        value: binaryValue("initial value"),
        diff: Buffer.alloc(0),
      },
      diff1: {
        value: binaryValue("initial value + diff 1"),
        diff: codec.compute(binaryValue("initial value"), binaryValue("initial value + diff 1")),
      },
      diff2: {
        value: binaryValue("initial value + diff 1 + diff 2"),
        diff: codec.compute(binaryValue("initial value + diff 1"), binaryValue("initial value + diff 1 + diff 2")),
      },
      diff3: {
        value: binaryValue("initial value + diff 1 + diff 2 + diff 3"),
        diff: codec.compute(
          binaryValue("initial value + diff 1 + diff 2"),
          binaryValue("initial value + diff 1 + diff 2 + diff 3")
        ),
      },
    };
  });

  it.each(testsCases)("$title", ({base, changed}) => {
    const _base = base();
    const _changed = changed();

    const delta = codec.compute(_base, _changed);
    const result = codec.apply(_base, delta);

    expect(delta).toBeInstanceOf(Uint8Array);
    expect(delta).not.toHaveLength(0);
    expect(Buffer.from(result).toString("hex")).toStrictEqual(Buffer.from(_changed).toString("hex"));
  });

  describe("multiple diffs", () => {
    it("should produce valid value for one diff", () => {
      expect(codec.apply(multiDiffData.snapshot.value, multiDiffData.diff1.diff)).toEqual(multiDiffData.diff1.value);
    });

    it("should produce valid value for two diffs", () => {
      expect(
        codec.apply(codec.apply(multiDiffData.snapshot.value, multiDiffData.diff1.diff), multiDiffData.diff2.diff)
      ).toEqual(multiDiffData.diff2.value);
    });

    it("should produce valid value for three diffs", () => {
      expect(
        codec.apply(
          codec.apply(codec.apply(multiDiffData.snapshot.value, multiDiffData.diff1.diff), multiDiffData.diff2.diff),
          multiDiffData.diff3.diff
        )
      ).toEqual(multiDiffData.diff3.value);
    });
  });
});

function attestationFromValues(
  slot: Slot,
  blockRoot: RootHex,
  targetEpoch: Epoch,
  targetRoot: RootHex
): phase0.Attestation {
  const attestation = ssz.phase0.Attestation.defaultValue();
  attestation.data.slot = slot;
  attestation.data.beaconBlockRoot = fromHex(blockRoot);
  attestation.data.target.epoch = targetEpoch;
  attestation.data.target.root = fromHex(targetRoot);
  return attestation;
}
