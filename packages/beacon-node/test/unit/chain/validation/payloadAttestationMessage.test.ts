import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {
  GossipAction,
  PayloadAttestationError,
  PayloadAttestationErrorCode,
} from "../../../../src/chain/errors/index.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {SeenPayloadAttesters} from "../../../../src/chain/seenCache/seenAttesters.js";
import {validateGossipPayloadAttestationMessage} from "../../../../src/chain/validation/payloadAttestationMessage.js";
import {Clock} from "../../../../src/util/clock.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {createCachedBeaconStateTest} from "../../../utils/cachedBeaconState.js";
import {generateState} from "../../../utils/state.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("validateGossipPayloadAttestationMessage", () => {
  const config = createBeaconConfig(
    createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 1,
    }),
    Buffer.alloc(32)
  );
  const forkSlot = config.GLOAS_FORK_EPOCH * SLOTS_PER_EPOCH;
  const forkTimeMs = forkSlot * config.SLOT_DURATION_MS;
  let controller: AbortController;
  let chain: Pick<MockedBeaconChain, keyof IBeaconChain>;
  let message: gloas.PayloadAttestationMessage;

  function getState(slot: number): BeaconStateView {
    const state = generateState({slot}, config, true);
    return new BeaconStateView(createCachedBeaconStateTest(state, config));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(forkTimeMs + config.MAXIMUM_GOSSIP_CLOCK_DISPARITY / 2);
    controller = new AbortController();
    chain = {
      ...getMockedBeaconChain({config}),
      clock: new Clock({config, genesisTime: 0, signal: controller.signal}),
      seenPayloadAttesters: new SeenPayloadAttesters(),
    };
    message = ssz.gloas.PayloadAttestationMessage.defaultValue();
    message.data.slot = forkSlot - 1;
    chain.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot: message.data.slot}));
    chain.regen.getStateSync.mockReturnValue(getState(message.data.slot));
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("rejects a pre-Gloas slot within the gossip clock disparity", async () => {
    expect(chain.clock.currentSlot).toBe(forkSlot);
    expect(chain.clock.isCurrentSlotGivenGossipDisparity(message.data.slot)).toBe(true);

    const validation = validateGossipPayloadAttestationMessage(chain, message);
    await expect(validation).rejects.toBeInstanceOf(PayloadAttestationError);
    await expect(validation).rejects.toMatchObject({
      action: GossipAction.REJECT,
      type: {code: PayloadAttestationErrorCode.PRE_GLOAS_SLOT, slot: message.data.slot},
    });
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
    expect(chain.seenPayloadAttesters.isKnown(message.data.slot, message.validatorIndex)).toBe(false);
  });

  it("ignores a pre-Gloas slot outside the gossip clock disparity", async () => {
    vi.setSystemTime(forkTimeMs + config.MAXIMUM_GOSSIP_CLOCK_DISPARITY + 1);

    await expect(validateGossipPayloadAttestationMessage(chain, message)).rejects.toMatchObject({
      action: GossipAction.IGNORE,
      type: {code: PayloadAttestationErrorCode.NOT_CURRENT_SLOT},
    });
  });

  it("accepts an attestation for the first Gloas slot", async () => {
    message.data.slot = forkSlot;
    chain.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot: forkSlot}));
    chain.regen.getStateSync.mockReturnValue(getState(forkSlot));

    await expect(validateGossipPayloadAttestationMessage(chain, message)).resolves.toMatchObject({
      validatorCommitteeIndices: expect.arrayContaining([0]),
    });
    expect(chain.bls.verifySignatureSets).toHaveBeenCalledOnce();
    expect(chain.seenPayloadAttesters.isKnown(message.data.slot, message.validatorIndex)).toBe(true);
  });
});
