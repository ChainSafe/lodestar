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

    const pendingPartialWithdrawals = Array.from({length: 1000}, (_, i) =>
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
  //   id: "getPendingBalanceToWithdraw - singe call",
  //   fn: () => {
  //     getPendingBalanceToWithdraw2(state, 90);
  //   },
  // });
  // itBench({
  //   id: "getPendingBalanceToWithdraw - multiple calls same index",
  //   fn: () => {
  //     getPendingBalanceToWithdraw2(state, 90);
  //     getPendingBalanceToWithdraw2(state, 90);
  //     getPendingBalanceToWithdraw2(state, 90);
  //     getPendingBalanceToWithdraw2(state, 90);
  //   },
  // });
  itBench({
    id: "getPendingBalanceToWithdraw - multiple calls different index",
    fn: () => {
      getPendingBalanceToWithdraw1(state, 90);
      getPendingBalanceToWithdraw1(state, 190);
      getPendingBalanceToWithdraw1(state, 290);
      getPendingBalanceToWithdraw1(state, 390);
    },
  });
});

// ✔ getPendingBalanceToWithdraw - singe call                             29641.05 ops/s    33.73700 us/op   x0.233      72987 runs   2.52 s
// ✔ getPendingBalanceToWithdraw - multiple calls same index              4212.548 ops/s    237.3860 us/op        -       3821 runs   1.11 s
// ✔ getPendingBalanceToWithdraw - multiple calls different index         5039.586 ops/s    198.4290 us/op   x0.359       7108 runs   1.59 s
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

//  ✔ getPendingBalanceToWithdraw - singe call                            7202.432 ops/s    138.8420 us/op   x4.115       9422 runs   1.47 s
//  ✔ getPendingBalanceToWithdraw - multiple calls same index             1685.860 ops/s    593.1690 us/op   x2.499       4083 runs   2.93 s
//  ✔ getPendingBalanceToWithdraw - multiple calls different index        1806.727 ops/s    553.4870 us/op        -       2552 runs   1.92 s
function getPendingBalanceToWithdraw2(state: CachedBeaconStateElectra, validatorIndex: ValidatorIndex): number {
  return state.pendingPartialWithdrawals
    .getAllReadonly()
    .filter((item) => item.validatorIndex === validatorIndex)
    .reduce((total, item) => total + Number(item.amount), 0);
}
