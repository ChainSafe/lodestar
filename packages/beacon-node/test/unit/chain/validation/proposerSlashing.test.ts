import sinon, {SinonStubbedInstance} from "sinon";

import {ForkChoice} from "@lodestar/fork-choice";
import {phase0, ssz} from "@lodestar/types";

import {BeaconChain} from "../../../../src/chain/index.js";
import {StubbedChainMutable} from "../../../utils/stub/index.js";
import {generateCachedState} from "../../../utils/state.js";
import {ProposerSlashingErrorCode} from "../../../../src/chain/errors/proposerSlashingError.js";
import {validateGossipProposerSlashing} from "../../../../src/chain/validation/proposerSlashing.js";
import {OpPool} from "../../../../src/chain/opPools/index.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {BlsVerifierMock} from "../../../utils/mocks/bls.js";

type StubbedChain = StubbedChainMutable<"forkChoice" | "bls">;

describe("validate proposer slashing", () => {
  const sandbox = sinon.createSandbox();
  let chainStub: StubbedChain;
  let opPool: OpPool & SinonStubbedInstance<OpPool>;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    chainStub.bls = new BlsVerifierMock(true);
    opPool = sandbox.createStubInstance(OpPool) as OpPool & SinonStubbedInstance<OpPool>;
    (chainStub as {opPool: OpPool}).opPool = opPool;

    const state = generateCachedState();
    chainStub.getHeadState.returns(state);
  });

  after(() => {
    sandbox.restore();
  });

  it("should return invalid proposer slashing - existing", async () => {
    const proposerSlashing = ssz.phase0.ProposerSlashing.defaultValue();
    opPool.hasSeenProposerSlashing.returns(true);

    await expectRejectedWithLodestarError(
      validateGossipProposerSlashing(chainStub, proposerSlashing),
      ProposerSlashingErrorCode.ALREADY_EXISTS
    );
  });

  it("should return invalid proposer slashing - invalid", async () => {
    const proposerSlashing = ssz.phase0.ProposerSlashing.defaultValue();
    // Make it invalid
    proposerSlashing.signedHeader1.message.slot = BigInt(1);
    proposerSlashing.signedHeader2.message.slot = BigInt(0);

    await expectRejectedWithLodestarError(
      validateGossipProposerSlashing(chainStub, proposerSlashing),
      ProposerSlashingErrorCode.INVALID
    );
  });

  it("should return valid proposer slashing", async () => {
    const signedHeader1 = ssz.phase0.SignedBeaconBlockHeaderBigint.defaultValue();
    const signedHeader2 = ssz.phase0.SignedBeaconBlockHeaderBigint.defaultValue();
    // Make it different, so slashable
    signedHeader2.message.stateRoot = Buffer.alloc(32, 1);

    const proposerSlashing: phase0.ProposerSlashing = {
      signedHeader1: signedHeader1,
      signedHeader2: signedHeader2,
    };

    await validateGossipProposerSlashing(chainStub, proposerSlashing);
  });
});
