import {describe, it, expect} from "vitest";
import {hashBalancesTree} from "../../../src/phase0/balances";
import {Balances} from "../../../src/phase0/sszTypes";
import {toHexString} from "@chainsafe/ssz";

describe("compute balances root", () => {
  const numBalances = [32, 33, 34, 35];

  for (const numBalance of numBalances) {
    it(`should compute balances root with ${numBalance} balances`, () => {
      const balances = Array.from({length: numBalance}, () => 32 * 1e9);
      const viewDU = Balances.toViewDU(balances);
      const expectedRoot = Balances.hashTreeRoot(balances);
      hashBalancesTree(viewDU.node);
      expect(toHexString(viewDU.node.root)).toEqual(toHexString(expectedRoot));
    });
  }
});
