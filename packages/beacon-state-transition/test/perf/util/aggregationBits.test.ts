import {MAX_VALIDATORS_PER_COMMITTEE} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {List, readonlyValues} from "@chainsafe/ssz";
import {expect} from "chai";
import {zipIndexesInBitList} from "../../../src";
import {profilerLogger} from "../../utils/logger";

describe("aggregationBits", function () {
  this.timeout(0);
  const logger = profilerLogger();

  const aggregationBits = Array.from({length: MAX_VALIDATORS_PER_COMMITTEE}, () => true);
  const indexes = Array.from({length: MAX_VALIDATORS_PER_COMMITTEE}, () => 165432);
  const bitlistTree = ssz.phase0.CommitteeBits.createTreeBackedFromStruct(aggregationBits as List<boolean>);

  benchmark({
    id: "readonlyValues",
    maxPerOp: 0.4,
    n: 81920,
    fn: () => Array.from(readonlyValues(bitlistTree)),
  });

  benchmark({
    id: "zipIndexesInBitList",
    maxPerOp: 0.0378,
    n: 81920,
    fn: () => zipIndexesInBitList(indexes, bitlistTree, ssz.phase0.CommitteeBits),
  });

  function benchmark({id, maxPerOp, n, fn}: {id: string; maxPerOp: number; n: number; fn: () => void}): void {
    it(id, () => {
      const start = Date.now();
      for (let i = 0; i < n; i++) {
        fn();
      }
      const total = Date.now() - start;
      const msPerOp = total / n;
      logger.info(id, `${msPerOp} ms/op`);
      expect(msPerOp).to.be.lt(maxPerOp, "ms / op slower than expected");
    });
  }
});
