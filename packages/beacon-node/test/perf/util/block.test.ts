import {readFileSync} from "node:fs";
import {beforeAll, bench, describe} from "@chainsafe/benchmark";
import {deneb, ssz} from "@lodestar/types";

// > yarn benchmark:files packages/beacon-node/test/perf/util/block.test.ts

// serialize block api response
// ✔ serialize block - JSON        216.0330 ops/s    4.628923 ms/op   x1.015         69 runs  0.823 s
// ✔ serialize block - SSZ         9310.120 ops/s    107.4100 us/op   x0.981       3245 runs  0.564 s

describe("serialize block api response", () => {
  let block: deneb.SignedBeaconBlock;

  beforeAll(() => {
    const blockBytes = readFileSync("./block.ssz");
    block = ssz.deneb.SignedBeaconBlock.deserialize(blockBytes);
  });

  bench({
    id: "serialize block - JSON",
    fn: () => {
      JSON.stringify(ssz.deneb.SignedBeaconBlock.toJson(block));
    },
  });

  bench({
    id: "serialize block - SSZ",
    fn: () => {
      Buffer.from(ssz.deneb.SignedBeaconBlock.serialize(block).buffer);
    },
  });
});
