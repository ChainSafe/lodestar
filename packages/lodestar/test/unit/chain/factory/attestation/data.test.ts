import sinon, {SinonStubbedInstance} from "sinon";
import {expect} from "chai";
import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {assembleAttestationData} from "../../../../../src/chain/factory/attestation/data";
import {generateState} from "../../../../utils/state";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateValidators} from "../../../../utils/validator";

describe("assemble attestation data", function () {

  it("should produce attestation", async function () {
    const state = generateState({
      genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
      validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
        activationEpoch: 0,
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
      }),
      balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
        () => config.params.MAX_EFFECTIVE_BALANCE),
    });
    const blockRoot = config.types.BeaconBlock.hashTreeRoot(generateEmptyBlock());
    const result = await assembleAttestationData(config, state, blockRoot, 2, 1);
    expect(result).to.not.be.null;
  });

});
