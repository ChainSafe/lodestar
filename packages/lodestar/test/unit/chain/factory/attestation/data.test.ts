import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/minimal";
import {assembleAttestationData} from "../../../../../src/chain/factory/attestation/data";
import {generateCachedState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateValidators} from "../../../../utils/validator";
import {generateInitialMaxBalances} from "../../../../utils/balances";
import {IEpochShuffling} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util";

describe("assemble attestation data", function () {
  it("should produce attestation", async function () {
    const cachedState = generateCachedState({
      genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
      validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
        activationEpoch: 0,
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
      }),
      balances: generateInitialMaxBalances(config),
    });
    cachedState.currentShuffling = {epoch: 0} as IEpochShuffling;
    const blockRoot = config.types.BeaconBlock.hashTreeRoot(generateEmptyBlock());
    const result = await assembleAttestationData(cachedState, blockRoot, 2, 1);
    expect(result).to.not.be.null;
  });
});
