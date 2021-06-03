import sinon from "sinon";

import {config} from "@chainsafe/lodestar-config/default";
import {phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ssz} from "@chainsafe/lodestar-types";

import {BeaconChain} from "../../../../src/chain";
import {StubbedBeaconDb, StubbedChain} from "../../../utils/stub";
import {generateCachedState} from "../../../utils/state";
import {validateGossipAttesterSlashing} from "../../../../src/chain/validation/attesterSlashing";
import {AttesterSlashingErrorCode} from "../../../../src/chain/errors/attesterSlashingError";
import {expectRejectedWithLodestarError} from "../../../utils/errors";
import {List} from "@chainsafe/ssz";

describe("GossipMessageValidator", () => {
  const sandbox = sinon.createSandbox();
  let dbStub: StubbedBeaconDb, chainStub: StubbedChain;

  before(() => {
    chainStub = sandbox.createStubInstance(BeaconChain) as StubbedChain;
    chainStub.forkChoice = sandbox.createStubInstance(ForkChoice);
    chainStub.bls = {verifySignatureSets: async () => true};
    dbStub = new StubbedBeaconDb(sandbox);
    dbStub.attesterSlashing.hasAll.resolves(false);

    const state = generateCachedState();
    chainStub.getHeadState.returns(state);
  });

  afterEach(() => {
    dbStub.attesterSlashing.hasAll.resolves(false);
  });

  after(() => {
    sandbox.restore();
  });

  describe("validate attester slashing", () => {
    it("should return invalid attester slashing - already exisits", async () => {
      const attesterSlashing = ssz.phase0.AttesterSlashing.defaultValue();
      dbStub.attesterSlashing.hasAll.resolves(true);

      await expectRejectedWithLodestarError(
        validateGossipAttesterSlashing(config, chainStub, dbStub, attesterSlashing),
        AttesterSlashingErrorCode.ALREADY_EXISTS
      );
    });

    it("should return invalid attester slashing - invalid", async () => {
      const attesterSlashing = ssz.phase0.AttesterSlashing.defaultValue();

      await expectRejectedWithLodestarError(
        validateGossipAttesterSlashing(config, chainStub, dbStub, attesterSlashing),
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

      await validateGossipAttesterSlashing(config, chainStub, dbStub, attesterSlashing);
    });
  });
});
