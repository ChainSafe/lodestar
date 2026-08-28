import {beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as configDef} from "@lodestar/config/default";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {IBeaconStateView} from "@lodestar/state-transition";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadEnvelopeInput} from "../../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {verifyBlocksInEpoch} from "../../../../src/chain/blocks/verifyBlock.js";
import {verifyBlocksExecutionPayload} from "../../../../src/chain/blocks/verifyBlocksExecutionPayloads.js";
import {verifyBlocksSignatures} from "../../../../src/chain/blocks/verifyBlocksSignatures.js";
import {verifyBlocksStateTransitionOnly} from "../../../../src/chain/blocks/verifyBlocksStateTransitionOnly.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";
import {MockBlockInput} from "../../../utils/blockInput.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

vi.mock("../../../../src/chain/blocks/verifyBlocksExecutionPayloads.js");
vi.mock("../../../../src/chain/blocks/verifyBlocksSignatures.js");
vi.mock("../../../../src/chain/blocks/verifyBlocksStateTransitionOnly.js");

describe("chain / blocks / verifyBlocksInEpoch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not verify DA for an empty Gloas payload slot", async () => {
    const config = createChainForkConfig({...configDef, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0});
    const chain = getMockedBeaconChain({config});
    const block = ssz.gloas.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    const blockRootHex = toRootHex(ssz.gloas.BeaconBlock.hashTreeRoot(block.message));
    const blockInput = new MockBlockInput({
      forkName: ForkName.gloas,
      slot: block.message.slot,
      blockRootHex,
    });
    blockInput._block = block;

    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      blockRootHex,
      block: block as SignedBeaconBlock<typeof ForkName.gloas>,
      forkName: ForkName.gloas,
      sampledColumns: [0],
      custodyColumns: [0],
      seenTimestampSec: 0,
      source: PayloadEnvelopeInputSource.byRange,
      daOutOfRange: false,
    });
    expect(payloadInput.hasPayloadEnvelope()).toBe(false);
    expect(payloadInput.hasAllData()).toBe(true);

    const preState = {
      slot: 0,
      isStateValidatorsNodesPopulated: () => true,
    } as unknown as IBeaconStateView;
    chain.regen.getPreState.mockResolvedValue(preState);
    Object.defineProperty(chain, "seenBlockProposers", {value: new SeenBlockProposers()});
    vi.mocked(verifyBlocksExecutionPayload).mockResolvedValue({
      execAborted: null,
      executionStatuses: [ExecutionStatus.Syncing],
      executionTime: 0,
    });
    vi.mocked(verifyBlocksStateTransitionOnly).mockResolvedValue({
      postStates: [preState],
      proposerBalanceDeltas: [0],
      verifyStateTime: 0,
    });
    vi.mocked(verifyBlocksSignatures).mockResolvedValue({verifySignaturesTime: 0});

    const result = await verifyBlocksInEpoch.call(
      chain,
      generateProtoBlock({slot: 0}),
      [blockInput],
      new Map([[block.message.slot, payloadInput]]),
      {verifyOnly: true}
    );

    expect(result.payloadDAStatuses.size).toBe(0);
  });
});
