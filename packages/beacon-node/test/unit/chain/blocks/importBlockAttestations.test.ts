import {describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {ExecutionStatus} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {importBlock} from "../../../../src/chain/blocks/importBlock.js";
import {AttestationImportOpt, FullyVerifiedBlock, ImportBlockOpts} from "../../../../src/chain/blocks/types.js";
import {BeaconChain} from "../../../../src/chain/chain.js";

const config = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
});

const blockSlot = 5;
const attestingIndices = [1, 2, 3];

async function importBlockWithAttestation(
  currentSlot: number,
  opts: ImportBlockOpts
): Promise<{
  onAttestation: ReturnType<typeof vi.fn>;
  seenAggregatedAttestationsAdd: ReturnType<typeof vi.fn>;
  seenBlockAttestersAddIndices: ReturnType<typeof vi.fn>;
}> {
  const attestation = ssz.electra.Attestation.defaultValue();
  attestation.data.slot = blockSlot - 1;
  attestation.committeeBits = BitArray.fromSingleBit(attestation.committeeBits.bitLen, 0);
  const indexedAttestation = {attestingIndices, data: attestation.data, signature: attestation.signature};

  const block = ssz.fulu.SignedBeaconBlock.defaultValue();
  block.message.slot = blockSlot;
  block.message.body.attestations = [attestation];

  const head = {slot: blockSlot, blockRoot: "0xhead", parentRoot: "0xparent"};
  const onAttestation = vi.fn();
  const seenAggregatedAttestationsAdd = vi.fn();
  const seenBlockAttestersAddIndices = vi.fn();
  const chain = {
    config,
    logger: testLogger(),
    metrics: null,
    opts: {disableImportExecutionFcU: true},
    forkChoice: {
      getTime: () => currentSlot,
      getFinalizedCheckpoint: () => ({epoch: 0}),
      onBlock: () => head,
      getHead: () => head,
      onAttestation,
    },
    recomputeForkChoiceHead: () => head,
    unfinalizedBlockWrites: {waitForSpace: async () => {}, push: async () => {}},
    checkpointBalancesCache: {processState: () => {}},
    regen: {processState: () => {}},
    clock: {secFromSlot: () => 0, slotWithFutureTolerance: () => currentSlot},
    emitter: {listenerCount: () => 0, emit: () => {}},
    reprocessController: {onBlockImported: () => {}},
    seenAggregatedAttestations: {add: seenAggregatedAttestationsAdd},
    seenBlockAttesters: {addIndices: seenBlockAttestersAddIndices},
  } as unknown as BeaconChain;

  const postState = {
    forkName: ForkName.fulu,
    slot: blockSlot,
    genesisTime: 0,
    currentJustifiedCheckpoint: ssz.phase0.Checkpoint.defaultValue(),
    previousJustifiedCheckpoint: ssz.phase0.Checkpoint.defaultValue(),
    getBlockRootAtSlot: () => new Uint8Array(32),
    isStateValidatorsNodesPopulated: () => true,
  } as unknown as IBeaconStateView;

  const fullyVerifiedBlock = {
    blockInput: {hasAllData: true, getBlock: () => block, getBlockSource: () => ({source: "gossip"})},
    postState,
    parentBlockSlot: blockSlot - 1,
    proposerBalanceDelta: 0,
    executionStatus: ExecutionStatus.Valid,
    dataAvailabilityStatus: DataAvailabilityStatus.Available,
    indexedAttestations: [indexedAttestation],
    seenTimestampSec: 0,
  } as unknown as FullyVerifiedBlock;

  await importBlock.call(chain, fullyVerifiedBlock, opts);

  return {onAttestation, seenAggregatedAttestationsAdd, seenBlockAttestersAddIndices};
}

describe("chain / blocks / importBlock / attestations", () => {
  const attDataRoot = toRootHex(
    ssz.phase0.AttestationData.hashTreeRoot({...ssz.phase0.AttestationData.defaultValue(), slot: blockSlot - 1})
  );

  it("imports attestations of a recent block into fork choice and the seen caches", async () => {
    const {onAttestation, seenAggregatedAttestationsAdd, seenBlockAttestersAddIndices} =
      await importBlockWithAttestation(blockSlot + 1, {});

    expect(onAttestation).toHaveBeenCalledOnce();
    expect(onAttestation).toHaveBeenCalledWith(expect.objectContaining({attestingIndices}), attDataRoot, true);
    expect(seenAggregatedAttestationsAdd).toHaveBeenCalledOnce();
    expect(seenBlockAttestersAddIndices).toHaveBeenCalledOnce();
  });

  it("imports attestations of an old block into fork choice only", async () => {
    // Attestations from blocks are not subject to the current or previous epoch check
    const {onAttestation, seenAggregatedAttestationsAdd, seenBlockAttestersAddIndices} =
      await importBlockWithAttestation(blockSlot + 3 * SLOTS_PER_EPOCH, {});

    expect(onAttestation).toHaveBeenCalledOnce();
    expect(onAttestation).toHaveBeenCalledWith(expect.objectContaining({attestingIndices}), attDataRoot, true);
    expect(seenAggregatedAttestationsAdd).not.toHaveBeenCalled();
    expect(seenBlockAttestersAddIndices).not.toHaveBeenCalled();
  });

  it("does not import attestations if skipped", async () => {
    const {onAttestation, seenAggregatedAttestationsAdd, seenBlockAttestersAddIndices} =
      await importBlockWithAttestation(blockSlot + 1, {importAttestations: AttestationImportOpt.Skip});

    expect(onAttestation).not.toHaveBeenCalled();
    expect(seenAggregatedAttestationsAdd).not.toHaveBeenCalled();
    expect(seenBlockAttestersAddIndices).not.toHaveBeenCalled();
  });
});
