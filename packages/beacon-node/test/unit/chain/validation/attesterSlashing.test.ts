import {describe, it, beforeEach, afterEach, vi} from "vitest";
import {phase0, ssz} from "@lodestar/types";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedState} from "../../../utils/state.js";
import {validateGossipAttesterSlashing} from "../../../../src/chain/validation/attesterSlashing.js";
import {AttesterSlashingErrorCode} from "../../../../src/chain/errors/attesterSlashingError.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";

describe("GossipMessageValidator", () => {
  let chainStub: MockedBeaconChain;
  let opPool: MockedBeaconChain["opPool"];

  beforeEach(() => {
    chainStub = getMockedBeaconChain();
    opPool = chainStub.opPool;

    const state = generateCachedState();
    vi.spyOn(chainStub, "getHeadState").mockReturnValue(state);
    vi.spyOn(opPool, "hasSeenAttesterSlashing");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("validate attester slashing", () => {
    it("should return invalid attester slashing - already exisits", async () => {
      const attesterSlashing = ssz.phase0.AttesterSlashing.defaultValue();
      opPool.hasSeenAttesterSlashing.mockReturnValue(true);

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
