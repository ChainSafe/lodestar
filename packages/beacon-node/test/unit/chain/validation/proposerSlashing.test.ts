import {describe, it, beforeEach, afterEach, vi} from "vitest";
import {phase0, ssz} from "@lodestar/types";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateCachedState} from "../../../utils/state.js";
import {ProposerSlashingErrorCode} from "../../../../src/chain/errors/proposerSlashingError.js";
import {validateGossipProposerSlashing} from "../../../../src/chain/validation/proposerSlashing.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";

describe("validate proposer slashing", () => {
  let chainStub: MockedBeaconChain;
  let opPool: MockedBeaconChain["opPool"];

  beforeEach(() => {
    chainStub = getMockedBeaconChain();
    opPool = chainStub.opPool;

    const state = generateCachedState();
    vi.spyOn(chainStub, "getHeadState").mockReturnValue(state);
    vi.spyOn(opPool, "hasSeenProposerSlashing");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return invalid proposer slashing - existing", async () => {
    const proposerSlashing = ssz.phase0.ProposerSlashing.defaultValue();
    opPool.hasSeenProposerSlashing.mockReturnValue(true);

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
