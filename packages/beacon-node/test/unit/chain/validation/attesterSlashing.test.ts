import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig as chainConfigDef} from "@lodestar/config/default";
import {aggregateSerializedPublicKeys} from "@lodestar/native/blst";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {FAR_FUTURE_EPOCH} from "@lodestar/params";
import {BeaconStateView, SignatureSetType, interopSecretKey} from "@lodestar/state-transition";
import {phase0, ssz} from "@lodestar/types";
import {AttesterSlashingErrorCode} from "../../../../src/chain/errors/attesterSlashingError.js";
import {validateGossipAttesterSlashing} from "../../../../src/chain/validation/attesterSlashing.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateCachedState} from "../../../utils/state.js";

describe("GossipMessageValidator", () => {
  let chainStub: MockedBeaconChain;
  let opPool: MockedBeaconChain["opPool"];
  const config = createBeaconConfig(chainConfigDef, Buffer.alloc(32, 0xaa));

  beforeEach(() => {
    chainStub = getMockedBeaconChain({config});
    opPool = chainStub.opPool;

    const state = new BeaconStateView(generateCachedState());
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

    it("resolves an unfinalized inactive participant before batch verification", async () => {
      const state = new BeaconStateView(generateCachedState());
      const pendingIndex = state.validatorCount;
      const pendingPubkey = interopSecretKey(pendingIndex + 100)
        .toPublicKey()
        .toBytes();
      state.cachedState.validators.push(
        ssz.phase0.Validator.toViewDU({
          ...ssz.phase0.Validator.defaultValue(),
          pubkey: pendingPubkey,
          activationEpoch: FAR_FUTURE_EPOCH,
          activationEligibilityEpoch: FAR_FUTURE_EPOCH,
          exitEpoch: FAR_FUTURE_EPOCH,
        })
      );
      pubkeyCache.addCandidate(pendingIndex, pendingPubkey);
      chainStub.getHeadState.mockReturnValue(state);
      const data = ssz.phase0.AttestationDataBigint.defaultValue();
      const slashing: phase0.AttesterSlashing = {
        attestation1: {data, attestingIndices: [0, pendingIndex], signature: new Uint8Array(96)},
        attestation2: {
          data: {...data, slot: 1n},
          attestingIndices: [0, pendingIndex],
          signature: new Uint8Array(96),
        },
      };

      await validateGossipAttesterSlashing(chainStub, slashing);

      const expectedPubkey = aggregateSerializedPublicKeys([state.getValidator(0).pubkey, pendingPubkey]).toBytes();
      expect(chainStub.bls.verifySignatureSets).toHaveBeenCalledWith(
        [
          expect.objectContaining({type: SignatureSetType.single, pubkey: expectedPubkey}),
          expect.objectContaining({type: SignatureSetType.single, pubkey: expectedPubkey}),
        ],
        {batchable: true, priority: false}
      );
      expect(pubkeyCache.size).toBe(pendingIndex);
    });
  });
});
