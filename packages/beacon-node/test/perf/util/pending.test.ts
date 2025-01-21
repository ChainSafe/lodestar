import {itBench} from "@dapplion/benchmark";
import {generatePerfTestCachedStateAltair} from "../../../../state-transition/test/perf/util.js";
import {CachedBeaconStateElectra} from "@lodestar/state-transition";
import {ssz, ValidatorIndex} from "@lodestar/types";

// > yarn benchmark:files packages/beacon-node/test/perf/util/pending.test.ts

describe("getPendingBalanceToWithdraw", () => {
  let state: CachedBeaconStateElectra;
  before(function () {
    this.timeout("5min");
    state = generatePerfTestCachedStateAltair({
      goBackOneSlot: false,
      vc: 10000,
    }) as unknown as CachedBeaconStateElectra;

    const pendingPartialWithdrawals = Array.from({length: 10000}, (_, i) =>
      ssz.electra.PendingPartialWithdrawal.toViewDU({
        validatorIndex: i,
        amount: BigInt(i * 1000),
        withdrawableEpoch: 10000,
      })
    );
    state.pendingPartialWithdrawals = ssz.electra.BeaconState.fields.pendingPartialWithdrawals.toViewDU([]);
    for (const item of pendingPartialWithdrawals) {
      state.pendingPartialWithdrawals.push(item);
    }
    state.pendingPartialWithdrawals.commit();
  });
  // itBench({
  //   id: "getPendingBalanceToWithdraw - singe call early index",
  //   fn: () => {
  //     getPendingBalanceToWithdraw2(state, 90);
  //   },
  // });
  // itBench({
  //   id: "getPendingBalanceToWithdraw - singe call late index",
  //   fn: () => {
  //     getPendingBalanceToWithdraw2(state, 9999);
  //   },
  // });
  // itBench({
  //   id: "getPendingBalanceToWithdraw - multiple calls same index",
  //   fn: () => {
  //     getPendingBalanceToWithdraw1(state, 90);
  //     getPendingBalanceToWithdraw1(state, 90);
  //     getPendingBalanceToWithdraw1(state, 90);
  //     getPendingBalanceToWithdraw1(state, 90);
  //     getPendingBalanceToWithdraw1(state, 90);
  //   },
  // });
  // itBench({
  //   id: "getPendingBalanceToWithdraw - multiple calls different index",
  //   fn: () => {
  //     getPendingBalanceToWithdraw2(state, 90);
  //     getPendingBalanceToWithdraw2(state, 190);
  //     getPendingBalanceToWithdraw2(state, 290);
  //     getPendingBalanceToWithdraw2(state, 390);
  //     getPendingBalanceToWithdraw2(state, 5000);
  //     getPendingBalanceToWithdraw2(state, 9999);
  //   },
  // });
  // itBench({
  //   id: "getPendingBalanceToWithdraw - multiple calls full range",
  //   fn: () => {
  //     for (let i = 0; i < 10000; i++) {
  //       getPendingBalanceToWithdraw2(state, i);
  //     }
  //   },
  // });
});

// ✔ getPendingBalanceToWithdraw - singe call early index                 1919.128 ops/s    521.0700 us/op        -        968 runs   1.01 s
// ✔ getPendingBalanceToWithdraw - singe call late index                  1830.476 ops/s    546.3060 us/op        -       1292 runs   1.21 s
// ✔ getPendingBalanceToWithdraw - multiple calls same index              406.8484 ops/s    2.457918 ms/op        -        125 runs  0.810 s
// ✔ getPendingBalanceToWithdraw - multiple calls different index         342.1865 ops/s     2.922383 ms/op       -        105 runs  0.808 s
// ✔ getPendingBalanceToWithdraw - multiple calls full range             0.2107368 ops/s    4.745255  s/op        -         12 runs   61.8 s
function getPendingBalanceToWithdraw1(state: CachedBeaconStateElectra, validatorIndex: ValidatorIndex): number {
  let total = 0;
  for (let i = 0; i < state.pendingPartialWithdrawals.length; i++) {
    const item = state.pendingPartialWithdrawals.get(i);
    if (item.validatorIndex === validatorIndex) {
      total += Number(item.amount);
    }
  }
  return total;
}

//  ✔ getPendingBalanceToWithdraw - singe call early index                464.4678 ops/s    2.153002 ms/op        -        708 runs   2.03 s
//  ✔ getPendingBalanceToWithdraw - singe call late index                 485.1491 ops/s    2.061222 ms/op        -        444 runs   1.42 s
//  ✔ getPendingBalanceToWithdraw - multiple calls same index             104.1376 ops/s    9.602679 ms/op        -         34 runs  0.829 s
//  ✔ getPendingBalanceToWithdraw - multiple calls different index        83.56981 ops/s    11.96604 ms/op        -         37 runs  0.952 s
//  ✔ getPendingBalanceToWithdraw - multiple calls full range           0.05011216 ops/s    19.95524  s/op        -          2 runs   60.1 s
function getPendingBalanceToWithdraw2(state: CachedBeaconStateElectra, validatorIndex: ValidatorIndex): number {
  return state.pendingPartialWithdrawals
    .getAllReadonly()
    .filter((item) => item.validatorIndex === validatorIndex)
    .reduce((total, item) => total + Number(item.amount), 0);
}
