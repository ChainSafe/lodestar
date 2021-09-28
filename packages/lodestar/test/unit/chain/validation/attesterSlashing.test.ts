import sinon, {SinonStubbedInstance} from "sinon";

import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ssz} from "@chainsafe/lodestar-types";

import {BeaconChain} from "../../../../src/chain";
import {StubbedChain} from "../../../utils/stub";
import {generateCachedState} from "../../../utils/state";
import {validateGossipAttesterSlashing} from "../../../../src/chain/validation/attesterSlashing";
import {AttesterSlashingErrorCode} from "../../../../src/chain/errors/attesterSlashingError";
import {OpPool} from "../../../../src/chain/opPools";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {List} from "@chainsafe/ssz";

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
      const attestationData = ssz.phase0.AttestationData.defaultValue();
      const attesterSlashing: phase0.AttesterSlashing = {
        attestation1: {
          data: attestationData,
          signature: Buffer.alloc(96, 0),
          attestingIndices: [0] as List<number>,
        },
        attestation2: {
          data: {...attestationData, slot: 1}, // Make it different so it's slashable
          signature: Buffer.alloc(96, 0),
          attestingIndices: [0] as List<number>,
        },
      };

      await validateGossipAttesterSlashing(chainStub, attesterSlashing);
    });
  });
});
