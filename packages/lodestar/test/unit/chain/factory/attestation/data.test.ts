import {expect} from "chai";
import {MAX_EFFECTIVE_BALANCE} from "@chainsafe/lodestar-params";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {config} from "@chainsafe/lodestar-config/minimal";
import {assembleAttestationData} from "../../../../../src/chain/factory/attestation/data";
import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateValidators} from "../../../../utils/validator";
import {generateInitialMaxBalances} from "../../../../utils/balances";

describe("assemble attestation data", function () {
  it("should produce attestation", function () {
    const state = generateState({
      genesisTime: Math.floor(Date.now() / 1000) - config.SECONDS_PER_SLOT,
      validators: generateValidators(config.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
        activationEpoch: 0,
        effectiveBalance: MAX_EFFECTIVE_BALANCE,
      }),
      balances: generateInitialMaxBalances(config),
    });
    const blockRoot = ssz.phase0.BeaconBlock.hashTreeRoot(generateEmptyBlock());
    const result = assembleAttestationData(config, state as CachedBeaconState<phase0.BeaconState>, blockRoot, 2, 1);
    expect(result).to.not.be.null;
  });
});
