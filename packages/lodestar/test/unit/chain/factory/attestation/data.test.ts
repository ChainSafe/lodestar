import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {assembleAttestationData} from "../../../../../src/chain/factory/attestation/data";
import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateValidators} from "../../../../utils/validator";
import {generateInitialMaxBalances} from "../../../../utils/balances";

describe("assemble attestation data", function () {
  it("should produce attestation", async function () {
    const state = generateState({
      genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
      validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
        activationEpoch: 0,
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE,
      }),
      balances: generateInitialMaxBalances(config),
    });
    const blockRoot = config.types.BeaconBlock.hashTreeRoot(generateEmptyBlock());
    const result = await assembleAttestationData(config, state, blockRoot, 2, 1);
    expect(result).to.not.be.null;
  });
});
