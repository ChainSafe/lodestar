import {expect} from "chai";
import {DistanceStoreMemory, storeToSpansPerEpoch, emptyPubkey} from "./utils";
import {Att, MinMaxSurround} from "../../../../src/slashingProtection/minMaxSurround";

const updateSpansTests: {
  name: string;
  att: Att;
  spansByEpoch: {[source: number]: [number, number]};
}[] = [
  {
    name: "Distance of 2 should update min spans accordingly",
    att: {source: 2, target: 4},
    spansByEpoch: {
      // [minSpan, maxSpan]
      0: [4, 0],
      1: [3, 0],
      3: [0, 1],
    },
  },
  {
    name: "Distance of 4 should update max spans accordingly",
    att: {source: 0, target: 5},
    spansByEpoch: {
      1: [0, 4],
      2: [0, 3],
      3: [0, 2],
      4: [0, 1],
    },
  },
];

describe("Update spans test", () => {
  for (const {name, att, spansByEpoch} of updateSpansTests) {
    it(name, async () => {
      const store = new DistanceStoreMemory();
      const minMaxSurround = new MinMaxSurround(store);

      await minMaxSurround.assertNoSurround(emptyPubkey, att);
      await minMaxSurround.insertAttestation(emptyPubkey, att);

      const spansByEpochResult = await storeToSpansPerEpoch(store);
      expect(spansByEpochResult).to.deep.equal(spansByEpoch);
    });
  }
});
