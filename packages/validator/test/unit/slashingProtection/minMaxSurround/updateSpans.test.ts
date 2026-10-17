import {describe, expect, it, vi} from "vitest";
import {MinMaxSurround, MinMaxSurroundAttestation} from "../../../../src/slashingProtection/minMaxSurround/index.js";
import {DistanceStoreMemory, emptyPubkey, storeToSpansPerEpoch} from "./utils.js";

const updateSpansTests: {
  name: string;
  attestation: MinMaxSurroundAttestation;
  spansByEpoch: {[source: number]: [number, number]};
}[] = [
  {
    name: "Distance of 2 should update min spans accordingly",
    attestation: {sourceEpoch: 2, targetEpoch: 4},
    spansByEpoch: {
      // [minSpan, maxSpan]
      0: [4, 0],
      1: [3, 0],
      3: [0, 1],
    },
  },
  {
    name: "Distance of 4 should update max spans accordingly",
    attestation: {sourceEpoch: 0, targetEpoch: 5},
    spansByEpoch: {
      1: [0, 4],
      2: [0, 3],
      3: [0, 2],
      4: [0, 1],
    },
  },
];

describe("Update spans test", () => {
  it("does not persist min spans when preparing max spans fails", async () => {
    const store = new DistanceStoreMemory();
    const failure = new Error("read failed");
    vi.spyOn(store.maxSpan, "get").mockRejectedValueOnce(failure);
    const minMaxSurround = new MinMaxSurround(store);
    await expect(minMaxSurround.insertAttestation(emptyPubkey, {sourceEpoch: 2, targetEpoch: 4})).rejects.toBe(failure);
    expect(await storeToSpansPerEpoch(store)).toEqual({});
  });

  it.each([false, true])("staged updates match sequential inserts, reversed: %s", async (reverse) => {
    const sequentialStore = new DistanceStoreMemory();
    const stagedStore = new DistanceStoreMemory();
    const sequential = new MinMaxSurround(sequentialStore, {maxEpochLookback: 2});
    const staged = new MinMaxSurround(stagedStore, {maxEpochLookback: 2});
    const existing = [{sourceEpoch: 5, targetEpoch: 9}];
    const additions = [
      {sourceEpoch: 3, targetEpoch: 5},
      {sourceEpoch: 4, targetEpoch: 7},
      {sourceEpoch: 6, targetEpoch: 10},
      {sourceEpoch: 8, targetEpoch: 12},
    ];
    if (reverse) additions.reverse();
    for (const attestation of existing) {
      await sequential.insertAttestation(emptyPubkey, attestation);
      await staged.insertAttestation(emptyPubkey, attestation);
    }
    const before = await storeToSpansPerEpoch(stagedStore);
    const updates = await staged.prepareAttestations(emptyPubkey, additions);
    expect(await storeToSpansPerEpoch(stagedStore)).toEqual(before);
    for (const attestation of additions) await sequential.insertAttestation(emptyPubkey, attestation);
    await stagedStore.setBatch(emptyPubkey, updates);
    expect(await storeToSpansPerEpoch(stagedStore)).toEqual(await storeToSpansPerEpoch(sequentialStore));
  });

  for (const {name, attestation: att, spansByEpoch} of updateSpansTests) {
    it(name, async () => {
      const store = new DistanceStoreMemory();
      const minMaxSurround = new MinMaxSurround(store);

      await minMaxSurround.assertNoSurround(emptyPubkey, att);
      await minMaxSurround.insertAttestation(emptyPubkey, att);

      const spansByEpochResult = await storeToSpansPerEpoch(store);
      expect(spansByEpochResult).toEqual(spansByEpoch);
    });
  }
});
