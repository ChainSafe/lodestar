import sinon, {SinonStubbedInstance} from "sinon";

import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ssz} from "@chainsafe/lodestar-types";

import {BeaconChain} from "../../../../src/chain/index.js";
import {StubbedChain} from "../../../utils/stub/index.js";
import {generateCachedState} from "../../../utils/state.js";
import {validateGossipAttesterSlashing} from "../../../../src/chain/validation/attesterSlashing.js";
import {AttesterSlashingErrorCode} from "../../../../src/chain/errors/attesterSlashingError.js";
import {OpPool} from "../../../../src/chain/opPools/index.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";

describe("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let chainStub: StubbedChain;
  let opPool: OpPool & SinonStubbedInstance<OpPool>;

  beforeEach(() => {
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    chainStub.bls = {verifySignatureSets: async () => true};
    opPool = sandbox.createStubInstance(OpPool) as OpPool & SinonStubbedInstance<OpPool>;
    (chainStub as {opPool: OpPool}).opPool = opPool;

    const state = generateCachedState();
    chainStub.getHeadState.returns(state);
  });

  after(() => {
    sandbox.restore();
  });

  describe("validate attester slashing", () => {
    it("should return invalid attester slashing - already exisits", async () => {
      const attesterSlashing = ssz.phase0.AttesterSlashing.defaultValue();
      opPool.hasSeenAttesterSlashing.returns(true);

      await expectRejectedWithLodestarError(
        validateGossipAttesterSlashing(chainStub, attesterSlashing),
        AttesterSlashingErrorCode.ALREADY_EXISTS
      );
    });

    it("should return invalid attester slashing - invalid", async () => {
      const attesterSlashing = ssz.phase0.AttesterSlashing.defaultValue();

      await expectRejectedWithLodestarError(
        validateGossipAttesterSlashing(chainStub, attesterSlashing),
        AttesterSlashingErrorCode.INVALID
      );
    });

    it("should return valid attester slashing", async () => {
      const attestationData = ssz.phase0.AttestationDataBigint.defaultValue();
      const attesterSlashing: phase0.AttesterSlashing = {
        attestation1: {
          data: attestationData,
          signature: Buffer.alloc(96, 0),
          attestingIndices: [0],
        },
        attestation2: {
          data: {...attestationData, slot: BigInt(1)}, // Make it different so it's slashable
          signature: Buffer.alloc(96, 0),
          attestingIndices: [0],
        },
      };

      await validateGossipAttesterSlashing(chainStub, attesterSlashing);
    });
  });
});
