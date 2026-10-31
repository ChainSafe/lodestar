import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  PayloadEnvelopeInput,
  PayloadEnvelopeInputSource,
} from "../../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {GossipAction, GossipErrorCode} from "../../../../src/chain/errors/index.js";
import {validateGossipExecutionPayloadEnvelope} from "../../../../src/chain/validation/executionPayloadEnvelope.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

describe("validateGossipExecutionPayloadEnvelope", () => {
  const config = createBeaconConfig(
    createChainForkConfig({
      ...configDef,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
      GLOAS_FORK_EPOCH: 0,
    }),
    Buffer.alloc(32, 0)
  );
  let chain: MockedBeaconChain;
  let signedEnvelope: gloas.SignedExecutionPayloadEnvelope;

  beforeEach(() => {
    chain = getMockedBeaconChain({config});
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    block.message.body.signedExecutionPayloadBid.message.executionRequestsRoot =
      ssz.gloas.ExecutionRequests.hashTreeRoot(ssz.gloas.ExecutionRequests.defaultValue());
    const blockRoot = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      block,
      blockRootHex: toRootHex(blockRoot),
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      daOutOfRange: false,
      source: PayloadEnvelopeInputSource.gossip,
      seenTimestampSec: 0,
    });

    chain.forkChoice.getBlockDefaultStatus.mockReturnValue(generateProtoBlock({slot: 1}));
    chain.forkChoice.getBlockHex.mockReturnValue(null);
    chain.forkChoice.getFinalizedCheckpoint.mockReturnValue({
      epoch: 0,
      root: Buffer.alloc(32),
      rootHex: toRootHex(Buffer.alloc(32)),
    });
    vi.mocked(chain.seenPayloadEnvelopeInputCache.get).mockReturnValue(payloadInput);

    signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message.beaconBlockRoot = blockRoot;
    signedEnvelope.message.payload.slotNumber = 1;
  });

  it("ignores the envelope without checking its signature if the sender became Fatal during the state lookup", async () => {
    let senderFatal = false;
    chain.regen.getState.mockImplementation(async () => {
      senderFatal = true;
      return {} as IBeaconStateView;
    });

    await expect(
      validateGossipExecutionPayloadEnvelope(chain, signedEnvelope, () => senderFatal)
    ).rejects.toMatchObject({
      action: GossipAction.IGNORE,
      type: {code: GossipErrorCode.FATAL_PEER},
    });
    expect(chain.bls.verifySignatureSets).not.toHaveBeenCalled();
  });
});
