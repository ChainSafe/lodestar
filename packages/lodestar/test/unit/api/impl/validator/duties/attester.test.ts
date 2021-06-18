import {SinonStubbedInstance} from "sinon";
import {config} from "@chainsafe/lodestar-config/default";
import {createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {ForkChoice, IBeaconChain} from "../../../../../../src/chain";
import {LocalClock} from "../../../../../../src/chain/clock";
import {FAR_FUTURE_EPOCH} from "../../../../../../src/constants";
import {generateInitialMaxBalances} from "../../../../../utils/balances";
import {generateState} from "../../../../../utils/state";
import {IBeaconSync} from "../../../../../../src/sync";
import {generateValidators} from "../../../../../utils/validator";
import {StubbedBeaconDb} from "../../../../../utils/stub";
import {setupApiImplTestServer, ApiImplTestModules} from "../../index.test";
import {ssz} from "@chainsafe/lodestar-types";
import {MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";
import {assembleAttesterDuty} from "../../../../../../src/chain/factory/duties";
import {expect} from "chai";
import {AttesterDuty} from "../../../../../../../api/src/routes/validator";

describe("getCommitteeAssignments vs assembleAttesterDuties performance test", function () {
  this.timeout(0);
  let chainStub: SinonStubbedInstance<IBeaconChain>,
    syncStub: SinonStubbedInstance<IBeaconSync>,
    dbStub: StubbedBeaconDb;

  let server: ApiImplTestModules;

  let indices: number[];
  let totalPerfGCA = 0,
    totalPerfAAD = 0;
  const numRuns = 1;

  before(function () {
    server = setupApiImplTestServer();
    chainStub = server.chainStub;
    syncStub = server.syncStub;
    chainStub.clock = server.sandbox.createStubInstance(LocalClock);
    chainStub.forkChoice = server.sandbox.createStubInstance(ForkChoice);
    chainStub.getCanonicalBlockAtSlot.resolves(ssz.phase0.SignedBeaconBlock.defaultValue());
    dbStub = server.dbStub;

    const numValidators = 20000;

    const validators = generateValidators(numValidators, {
      effectiveBalance: MAX_EFFECTIVE_BALANCE,
      activationEpoch: 0,
      exitEpoch: FAR_FUTURE_EPOCH,
    });
    syncStub.isSynced.returns(true);
    server.sandbox.stub(chainStub.clock, "currentEpoch").get(() => 0);
    server.sandbox.stub(chainStub.clock, "currentSlot").get(() => 0);
    dbStub.block.get.resolves({message: {stateRoot: Buffer.alloc(32)}} as any);
    const state = generateState(
      {
        slot: 0,
        validators,
        balances: generateInitialMaxBalances(config, numValidators),
      },
      config
    );
    const cachedState = createCachedBeaconState(config, state);
    chainStub.getHeadStateAtCurrentEpoch.resolves(cachedState);

    indices = Array.from({length: numValidators}, (_, i) => i);
  });

  after(() => {
    console.log("number of runs: ", numRuns);
    console.log("assembleAttesterDuty batch performance avg: ", totalPerfAAD / numRuns);
    console.log("getCommitteeAssignments performance avg: ", totalPerfGCA / numRuns);
  });

  for (let i = 0; i < numRuns; i++) {
    it("performance comparison", async () => {
      const state = await chainStub.getHeadStateAtCurrentEpoch();

      // the new way of getting attester duties
      let start = Date.now();
      const newDuties = state.epochCtx.getCommitteeAssignments(
        0,
        state.validators.map((validator, k) => {
          const index = indices[k];
          return {pubkey: validator.pubkey, index};
        })
      );
      totalPerfGCA += Date.now() - start;

      // the old way of getting the attester duties
      const oldDuties: AttesterDuty[] = [];
      start = Date.now();
      for (const validatorIndex of indices) {
        const validator = state.validators[validatorIndex];
        const duty = assembleAttesterDuty(config, {pubkey: validator.pubkey, index: validatorIndex}, state.epochCtx, 0);
        if (duty) oldDuties.push(duty);
      }
      totalPerfAAD += Date.now() - start;

      // verify that both the old and new ways get the same data
      newDuties.sort((x, y) => x.validatorIndex - y.validatorIndex);
      oldDuties.sort((x, y) => x.validatorIndex - y.validatorIndex);
      expect(newDuties).to.deep.equal(oldDuties);
    });
  }
});
