import {config} from "@chainsafe/lodestar-config/default";
import {createCachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {ForkChoice} from "../../../../../src/chain";
import {LocalClock} from "../../../../../src/chain/clock";
import {generateInitialMaxBalances} from "../../../../utils/balances";
import {generateState} from "../../../../utils/state";
import {generateValidators} from "../../../../utils/validator";
import {setupApiImplTestServer} from "../../../../unit/api/impl/index.test";
import {BLSPubkey, ssz} from "@chainsafe/lodestar-types";
import {MAX_EFFECTIVE_BALANCE, FAR_FUTURE_EPOCH} from "@chainsafe/lodestar-params";
import {itBench, setBenchOpts} from "@dapplion/benchmark";

describe("getCommitteeAssignments vs assembleAttesterDuties performance test", async () => {
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
  const state = createCachedBeaconState(config, _state);
  chainStub.getHeadStateAtCurrentEpoch.resolves(state);

  const indices = Array.from({length: numAttachedValidators}, (_, i) => i * 5);

  setBenchOpts({
    maxMs: 10 * 1000,
    minMs: 2 * 1000,
    runs: 1024,
  });

  // the new way of getting attester duties
  itBench("getCommitteeAssignments", () => {
    const validators = state.validators.persistent;
    const validatorData: Map<number, BLSPubkey> = new Map<number, BLSPubkey>();
    for (const index of indices) {
      const validator = validators.get(index);
      if (!validator) {
        throw new Error(`Validator pubkey at index ${index} not in state`);
      }
      validatorData.set(index, validator.pubkey);
    }
    state.epochCtx.getCommitteeAssignments(0, validatorData);
  });

  itBench("getCommitteeAssignments - index2pubkey - more data", () => {
    const validatorData: Map<number, BLSPubkey> = new Map<number, BLSPubkey>();
    indices.forEach((index) => {
      const pubkey = state.index2pubkey[index];
      if (!pubkey) {
        throw new Error(`Validator pubkey at validator index ${index} not found in state.`);
      }
      validatorData.set(index, pubkey.toBytes());
    });
    state.epochCtx.getCommitteeAssignments(0, validatorData);
  });
});
