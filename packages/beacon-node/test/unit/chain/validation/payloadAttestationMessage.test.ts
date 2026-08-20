import {describe, it, vi} from "vitest";
import {SecretKey} from "@chainsafe/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {PayloadAttestationErrorCode} from "../../../../src/chain/errors/payloadAttestation.js";
import {SeenPayloadAttesters} from "../../../../src/chain/seenCache/seenAttesters.js";
import {validateGossipPayloadAttestationMessage} from "../../../../src/chain/validation/payloadAttestationMessage.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {expectRejectedWithLodestarError} from "../../../utils/errors.js";
import {generateState, zeroProtoBlock} from "../../../utils/state.js";

describe("validateGossipPayloadAttestationMessage", () => {
  it("validates PTC membership when the validator was observed at another slot in the epoch", async () => {
    const slot = SLOTS_PER_EPOCH + 1;
    const previousSlot = slot - 1;
    const validatorIndex = 42;
    const chainConfig = getConfig(ForkName.gloas);
    const stateValue = generateState({slot}, chainConfig);
    const config = createBeaconConfig(chainConfig, stateValue.genesisValidatorsRoot);
    const state = new BeaconStateView(createCachedBeaconStateTest(stateValue, config));
    const chain = getMockedBeaconChain({config});
    Object.assign(chain, {seenPayloadAttesters: new SeenPayloadAttesters()});

    vi.spyOn(chain.clock, "isCurrentSlotGivenGossipDisparity").mockReturnValue(true);
    chain.forkChoice.getBlockDefaultStatus
      .mockReturnValueOnce({...zeroProtoBlock, slot: previousSlot})
      .mockReturnValueOnce({...zeroProtoBlock, slot});
    chain.regen.getBlockSlotState.mockResolvedValue(state);
    chain.pubkeyCache.set(validatorIndex, SecretKey.fromKeygen(Buffer.alloc(32, 1)).toPublicKey().toBytes());
    vi.spyOn(state, "getIndicesInPayloadTimelinessCommittee").mockImplementation((_validatorIndex, requestedSlot) =>
      requestedSlot === previousSlot ? [0] : []
    );

    const previousMessage = ssz.gloas.PayloadAttestationMessage.defaultValue();
    previousMessage.data.slot = previousSlot;
    previousMessage.validatorIndex = validatorIndex;
    await validateGossipPayloadAttestationMessage(chain, previousMessage);

    const message = ssz.gloas.PayloadAttestationMessage.defaultValue();
    message.data.slot = slot;
    message.validatorIndex = validatorIndex;
    await expectRejectedWithLodestarError(
      validateGossipPayloadAttestationMessage(chain, message),
      PayloadAttestationErrorCode.INVALID_ATTESTER
    );
  });
});
