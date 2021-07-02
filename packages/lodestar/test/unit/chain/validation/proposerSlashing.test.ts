import sinon from "sinon";

import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ssz} from "@chainsafe/lodestar-types";

import {BeaconChain} from "../../../../src/chain";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {generateCachedState} from "../../../utils/state";
import {ProposerSlashingErrorCode} from "../../../../src/chain/errors/proposerSlashingError";
import {validateGossipProposerSlashing} from "../../../../src/chain/validation/proposerSlashing";
import {expectRejectedWithLodestarError} from "../../../utils/errors";

describe("validate proposer slashing", () => {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb, chainStub: StubbedChain;

  before(() => {
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    chainStub.bls = {verifySignatureSets: async () => true};
    dbStub = new StubbedBeaconDb(sandbox);

    const state = generateCachedState();
    chainStub.getHeadState.returns(state);
  });

  afterEach(() => {
    dbStub.proposerSlashing.has.resolves(false);
  });

  after(() => {
    sandbox.restore();
  });

  it("should return invalid proposer slashing - existing", async () => {
    const proposerSlashing = ssz.phase0.ProposerSlashing.defaultValue();
    dbStub.proposerSlashing.has.resolves(true);

    await expectRejectedWithLodestarError(
      validateGossipProposerSlashing(chainStub, dbStub, proposerSlashing),
      ProposerSlashingErrorCode.ALREADY_EXISTS
    );
  });

  it("should return invalid proposer slashing - invalid", async () => {
    const proposerSlashing = ssz.phase0.ProposerSlashing.defaultValue();
    // Make it invalid
    proposerSlashing.signedHeader1.message.slot = 1;
    proposerSlashing.signedHeader2.message.slot = 0;

    await expectRejectedWithLodestarError(
      validateGossipProposerSlashing(chainStub, dbStub, proposerSlashing),
      ProposerSlashingErrorCode.INVALID
    );
  });

  it("should return valid proposer slashing", async () => {
    const signedHeader1 = ssz.phase0.SignedBeaconBlockHeader.defaultValue();
    const signedHeader2 = ssz.phase0.SignedBeaconBlockHeader.defaultValue();
    // Make it different, so slashable
    signedHeader2.message.stateRoot = Buffer.alloc(32, 1);

    const proposerSlashing: phase0.ProposerSlashing = {
      signedHeader1: signedHeader1,
      signedHeader2: signedHeader2,
    };

    await validateGossipProposerSlashing(chainStub, dbStub, proposerSlashing);
  });
});
