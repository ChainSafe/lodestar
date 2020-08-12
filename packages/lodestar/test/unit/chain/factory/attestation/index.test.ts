import sinon, {SinonStub} from "sinon";
import {generateState} from "../../../../utils/state";
import {expect} from "chai";
import {TreeBacked} from "@chainsafe/ssz";
import {BeaconState, AttestationData} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {EpochContext} from "@chainsafe/lodestar-beacon-state-transition";

import * as attestationDataProduction from "../../../../../src/chain/factory/attestation/data";
import {assembleAttestation} from "../../../../../src/chain/factory/attestation";
import {generateEmptyBlock} from "../../../../utils/block";
import {generateAttestationData} from "../../../../utils/attestation";
import {generateValidators} from "../../../../utils/validator";

describe("assemble attestation", function () {

  const sandbox = sinon.createSandbox();
  let assembleAttestationDataStub: SinonStub<[
    IBeaconConfig, TreeBacked<BeaconState>, Uint8Array, number, number
  ], Promise<AttestationData>>;

  beforeEach(() => {
    assembleAttestationDataStub = sandbox.stub(
      attestationDataProduction,
      "assembleAttestationData"
    );
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should produce attestation", async function () {
    const state = generateState({
      genesisTime: Math.floor(Date.now() / 1000) - config.params.SECONDS_PER_SLOT,
      slot: 1,
      validators: generateValidators(config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT, {
        activationEpoch: 0,
        effectiveBalance: config.params.MAX_EFFECTIVE_BALANCE
      }),
      balances: Array.from({length: config.params.MIN_GENESIS_ACTIVE_VALIDATOR_COUNT},
        () => config.params.MAX_EFFECTIVE_BALANCE),
    });
    const epochCtx = new EpochContext(config);
    epochCtx.loadState(state);
    const attestationData = generateAttestationData(1, 3);
    assembleAttestationDataStub.resolves(attestationData);
    const validatorIndex = epochCtx.getBeaconCommittee(2, 0)[0];
    const blockRoot = config.types.BeaconBlock.hashTreeRoot(generateEmptyBlock());
    const result = await assembleAttestation(
      epochCtx, state, blockRoot, validatorIndex, 0, 2,
    );
    //TODO: try to test if validator bit is correctly set
    expect(result).to.not.be.null;
    expect(result.data).to.be.equal(attestationData);
    expect(state.slot).to.be.equal(1);
    expect(assembleAttestationDataStub.calledOnceWith(config, state, blockRoot, 2, 0));
  });

});
