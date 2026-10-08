import {describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, PTC_SIZE} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {AttestationImportOpt, FullyVerifiedBlock} from "../../../../src/chain/blocks/types.js";
import {BeaconChain} from "../../../../src/chain/chain.js";

const config = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
  GLOAS_FORK_EPOCH: 0,
});

const blockSlot = 5;
const parentSlot = blockSlot - 1;
const currentSlot = blockSlot + 1;
const parentRoot = Buffer.alloc(32, 0xaa);

const MULTI_SEAT_VALIDATOR = 7;
const MULTI_SEAT_POSITIONS = [3, 17];
const SINGLE_SEAT_POSITION = 9;

/** Every position is held by a distinct validator, except MULTI_SEAT_POSITIONS */
function getPtc(): Uint32Array {
  const ptc = Uint32Array.from({length: PTC_SIZE}, (_, i) => 1000 + i);
  for (const position of MULTI_SEAT_POSITIONS) {
    ptc[position] = MULTI_SEAT_VALIDATOR;
  }
  return ptc;
}

async function importBlockWithPayloadAttestation(setBits: number[]): Promise<ReturnType<typeof vi.fn>> {
  const block = ssz.gloas.SignedBeaconBlock.defaultValue();
  block.message.slot = blockSlot;
  block.message.parentRoot = parentRoot;
  const aggregationBits = BitArray.fromBitLen(PTC_SIZE);
  for (const bit of setBits) {
    aggregationBits.set(bit, true);
  }
  block.message.body.payloadAttestations = [
    {
      aggregationBits,
      data: {beaconBlockRoot: parentRoot, slot: parentSlot, payloadPresent: true, blobDataAvailable: true},
      signature: Buffer.alloc(96),
    },
  ];

  const head = {slot: blockSlot, blockRoot: "0xhead", parentRoot: toRootHex(parentRoot)};
  const notifyPtcMessages = vi.fn();
  const chain = {
    config,
    logger: testLogger(),
    metrics: null,
    opts: {disableImportExecutionFcU: true},
    forkChoice: {
      getTime: () => currentSlot,
      getFinalizedCheckpoint: () => ({epoch: 0}),
      getBlockHexDefaultStatus: () => ({executionStatus: ExecutionStatus.Valid}),
      onBlock: () => head,
      getHead: () => head,
      notifyPtcMessages,
    },
    recomputeForkChoiceHead: () => head,
    unfinalizedBlockWrites: {waitForSpace: async () => {}, push: async () => {}},
    checkpointBalancesCache: {processState: () => {}},
    regen: {processState: () => {}},
    clock: {secFromSlot: () => 0, slotWithFutureTolerance: () => currentSlot},
    seenPayloadEnvelopeInputCache: {pruneBelowParent: () => {}},
    emitter: {listenerCount: () => 0, emit: () => {}},
    reprocessController: {onBlockImported: () => {}},
  } as unknown as BeaconChain;

  const postState = {
    forkName: ForkName.gloas,
    slot: blockSlot,
    genesisTime: 0,
    getPayloadTimelinessCommittee: () => getPtc(),
    isStateValidatorsNodesPopulated: () => true,
  } as unknown as IBeaconStateView;

  const fullyVerifiedBlock = {
    blockInput: {hasAllData: true, getBlock: () => block, getBlockSource: () => ({source: "gossip"})},
    postState,
    parentBlockSlot: parentSlot,
    proposerBalanceDelta: 0,
    executionStatus: ExecutionStatus.Valid,
    dataAvailabilityStatus: DataAvailabilityStatus.Available,
    indexedAttestations: [],
    seenTimestampSec: 0,
  } as unknown as FullyVerifiedBlock;

  await importBlock.call(chain, fullyVerifiedBlock, {importAttestations: AttestationImportOpt.Skip});

  return notifyPtcMessages;
}

describe("chain / blocks / importBlock", () => {
  it("counts a payload attestation for every PTC position of the attester", async () => {
    // Only one of the two positions held by the validator is set in the aggregate
    const notifyPtcMessages = await importBlockWithPayloadAttestation([MULTI_SEAT_POSITIONS[0]]);

    expect(notifyPtcMessages).toHaveBeenCalledOnce();
    expect(notifyPtcMessages).toHaveBeenCalledWith(toRootHex(parentRoot), parentSlot, MULTI_SEAT_POSITIONS, true, true);
  });

  it("counts a single position for an attester holding one PTC position", async () => {
    const notifyPtcMessages = await importBlockWithPayloadAttestation([SINGLE_SEAT_POSITION]);

    expect(notifyPtcMessages).toHaveBeenCalledOnce();
    expect(notifyPtcMessages).toHaveBeenCalledWith(
      toRootHex(parentRoot),
      parentSlot,
      [SINGLE_SEAT_POSITION],
      true,
      true
    );
  });
});
