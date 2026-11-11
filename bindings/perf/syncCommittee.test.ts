import {afterAll, bench, describe} from "@chainsafe/benchmark";
import {ssz} from "@lodestar/types";
import {SecretKey} from "../src/blst.js";
import bindings from "../src/index.js";
import {createStfState, stfConfig} from "../test/stfFixture.js";
import {deterministicBenchmarkSeed} from "./benchmarkSeed.js";

const value = createStfState();
const committeeSize = value.currentSyncCommittee.pubkeys.length;
value.validators = Array.from({length: committeeSize}, (_, index) => ({
  ...value.validators[0],
  pubkey: SecretKey.fromKeygen(deterministicBenchmarkSeed(`sync-committee:${index}`))
    .toPublicKey()
    .toBytes(),
}));
value.balances = value.validators.map(() => 32_000_000_000);
value.previousEpochParticipation = value.validators.map(() => 0);
value.currentEpochParticipation = value.validators.map(() => 0);
value.inactivityScores = value.validators.map(() => 0);
bindings.pubkeys.ensureCapacity(value.validators.length);
const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));

for (const uniqueValidators of [16, committeeSize]) {
  value.currentSyncCommittee.pubkeys = value.currentSyncCommittee.pubkeys.map(
    (_, position) => value.validators[position % uniqueValidators].pubkey
  );
  value.nextSyncCommittee = value.currentSyncCommittee;
  const state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(value), config);

  describe(`sync committee binding - ${committeeSize} positions, ${uniqueValidators} unique validators`, () => {
    afterAll(() => state.release());

    bench({
      fn: () => state.currentSyncCommitteeIndexed,
      id: `full cache - ${uniqueValidators} unique validators`,
    });
    bench({
      fn: () => state.currentSyncCommitteeValidatorIndices,
      id: `indices only - ${uniqueValidators} unique validators`,
    });
  });
}
