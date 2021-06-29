import {config} from "@chainsafe/lodestar-config/default";
import {CachedBeaconState, createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {ForkChoice} from "../../../../../src/chain";
import {LocalClock} from "../../../../../src/chain/clock";
import {generateInitialMaxBalances} from "../../../../utils/balances";
import {generateState} from "../../../../utils/state";
import {generateValidators} from "../../../../utils/validator";
import {setupApiImplTestServer} from "../../../../unit/api/impl/index.test";
import {ssz} from "@chainsafe/lodestar-types";
import {MAX_EFFECTIVE_BALANCE, FAR_FUTURE_EPOCH} from "@chainsafe/lodestar-params";
import {itBench, setBenchOpts} from "@dapplion/benchmark";
import {BeaconState} from "../../../../../../beacon-state-transition/src/allForks";

describe("getCommitteeAssignments performance test", () => {
  let state: CachedBeaconState<BeaconState>;
  let indices: number[];

  before(function () {
    this.timeout(60 * 1000);
    const server = setupApiImplTestServer();
    const chainStub = server.chainStub;
    const syncStub = server.syncStub;
    chainStub.clock = server.sandbox.createStubInstance(LocalClock);
    chainStub.forkChoice = server.sandbox.createStubInstance(ForkChoice);
    chainStub.getCanonicalBlockAtSlot.resolves(ssz.phase0.SignedBeaconBlock.defaultValue());
    const dbStub = server.dbStub;

    const numValidators = 200000;
    const numAttachedValidators = 200;

    const validators = generateValidators(numValidators, {
      effectiveBalance: MAX_EFFECTIVE_BALANCE,
      activationEpoch: 0,
      exitEpoch: FAR_FUTURE_EPOCH,
    });
    syncStub.isSynced.returns(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    const _state = generateState(
      {
        slot: 0,
        validators,
        balances: generateInitialMaxBalances(config, numValidators),
      },
      config
    );
    state = createCachedBeaconState(config, _state);
    chainStub.getHeadStateAtCurrentEpoch.resolves(state);

    indices = Array.from({length: numAttachedValidators}, (_, i) => i * 5);

    setBenchOpts({
      maxMs: 10 * 1000,
      minMs: 2 * 1000,
      runs: 1024,
    });
  });

  // the new way of getting attester duties
  itBench({
    id: "getCommitteeAssignments",
    fn: () => {
      const persistentValidators = state.validators.persistent;
      const duties = state.epochCtx.getCommitteeAssignments(0, new Set(indices));
      const data = [];
      for (const duty of duties) {
        const pubkey = persistentValidators.get(duty.validatorIndex)?.pubkey;
        if (!pubkey) throw new Error(`Validator pubkey ${pubkey} not in duties`);
        data.push({...duty, pubkey});
      }
    },
  });
});
