import {MutableVector} from "@chainsafe/persistent-ts";
import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {newZeroedArray} from "../../../src/index.js";

describe("effectiveBalanceIncrements", () => {
  setBenchOpts({noThreshold: true});

  const vc = 300_000;
  const uint8Array = new Uint8Array(vc);
  const mv = MutableVector.from(newZeroedArray(vc));

  itBench(`effectiveBalanceIncrements clone Uint8Array ${vc}`, () => {
    uint8Array.slice(0);
  });

  itBench(`effectiveBalanceIncrements clone MutableVector ${vc}`, () => {
    mv.clone();
  });

  itBench(`effectiveBalanceIncrements rw all Uint8Array ${vc}`, () => {
    for (let i = 0; i < vc; i++) {
      uint8Array[i]++;
    }
  });

  itBench(`effectiveBalanceIncrements rw all MutableVector ${vc}`, () => {
    for (let i = 0; i < vc; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      mv.set(i, mv.get(i)! + 1);
    }
  });
});
