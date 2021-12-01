import {expect} from "chai";
import {SecretKey} from "@chainsafe/bls";
import {altair, phase0, Root, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {toHexString, TreeBacked} from "@chainsafe/ssz";
import {chainConfig} from "@chainsafe/lodestar-config/default";
import {createIBeaconConfig} from "@chainsafe/lodestar-config";
import {processLightClientUpdate} from "../naive/update";
import {prepareUpdateNaive, IBeaconChainLc} from "../prepareUpdateNaive";
import {getInteropSyncCommittee, getSyncAggregateSigningRoot, SyncCommitteeKeys} from "../utils";
import {LightClientStoreFast} from "../../src/types";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";

/* eslint-disable @typescript-eslint/naming-convention */

describe("Lightclient flow", () => {
  before("BLS sanity check", () => {
    const sk = SecretKey.fromBytes(Buffer.alloc(32, 1));
    expect(sk.toPublicKey().toHex()).to.equal(
      "0xaa1a1c26055a329817a5759d877a2795f9499b97d6056edde0eea39512f24e8bc874b4471f0501127abb1ea0d9f68ac1"
    );
  });

  // Fixed params
  const genValiRoot = Buffer.alloc(32, 9);
  const config = createIBeaconConfig(chainConfig, genValiRoot);
  const currentSlot = 1;
  const syncCommitteesKeys = new Map<SyncPeriod, SyncCommitteeKeys>();
  let updateData: {chain: IBeaconChainLc; blockWithSyncAggregate: altair.BeaconBlock};
  let update: altair.LightClientUpdate;

  function getSyncCommittee(period: SyncPeriod): SyncCommitteeKeys {
    let syncCommitteeKeys = syncCommitteesKeys.get(period);
    if (!syncCommitteeKeys) {
      syncCommitteeKeys = getInteropSyncCommittee(period);
      syncCommitteesKeys.set(period, syncCommitteeKeys);
    }
    return syncCommitteeKeys;
  }

  before("Generate data for prepareUpdate", () => {
    // Create a state that has as nextSyncCommittee the committee 2
    const finalizedBlockSlot = SLOTS_PER_EPOCH * EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1;
    const headerBlockSlot = finalizedBlockSlot + 1;

    const finalizedState = ssz.altair.BeaconState.defaultValue();
    finalizedState.nextSyncCommittee = getSyncCommittee(0).syncCommittee;
    const finalizedBlockHeader = ssz.phase0.BeaconBlockHeader.defaultValue();
    finalizedBlockHeader.slot = finalizedBlockSlot;
    finalizedBlockHeader.stateRoot = ssz.altair.BeaconState.hashTreeRoot(finalizedState);

    // Create a state that has the finalizedState as finalized checkpoint
    const syncAttestedState = ssz.altair.BeaconState.defaultValue();
    syncAttestedState.finalizedCheckpoint = {
      epoch: 0, // Checkpoint { epoch, blockRoot }
      root: ssz.phase0.BeaconBlockHeader.hashTreeRoot(finalizedBlockHeader),
    };
    const syncAttestedBlockHeader = ssz.phase0.BeaconBlockHeader.defaultValue();
    syncAttestedBlockHeader.slot = headerBlockSlot;
    syncAttestedBlockHeader.stateRoot = ssz.altair.BeaconState.hashTreeRoot(syncAttestedState);

    // Create a state with the block blockWithSyncAggregate
    const stateWithSyncAggregate = ssz.altair.BeaconState.defaultValue();
    stateWithSyncAggregate.slot = 1;
    stateWithSyncAggregate.blockRoots[0] = ssz.phase0.BeaconBlockHeader.hashTreeRoot(syncAttestedBlockHeader);

    // Create a signature from current committee to "attest" syncAttestedBlockHeader
    const signingRoot = getSyncAggregateSigningRoot(config, syncAttestedBlockHeader);
    const blockWithSyncAggregate = ssz.altair.BeaconBlock.defaultValue();
    blockWithSyncAggregate.body.syncAggregate = getSyncCommittee(0).signAndAggregate(signingRoot);
    blockWithSyncAggregate.stateRoot = ssz.altair.BeaconState.hashTreeRoot(stateWithSyncAggregate);

    // Simulate BeaconChain module with a memory map of blocks and states
    const chainMock = new MockBeaconChainLc(
      [finalizedBlockHeader, syncAttestedBlockHeader],
      [finalizedState, syncAttestedState, stateWithSyncAggregate]
    );

    updateData = {chain: chainMock, blockWithSyncAggregate};
  });

  it("Prepare altair update", async () => {
    if (updateData === undefined) throw Error("Prev test failed");

    update = await prepareUpdateNaive(updateData.chain, updateData.blockWithSyncAggregate);
  });

  it("Process altair update", () => {
    if (update === undefined) throw Error("Prev test failed");

    const store: LightClientStoreFast = {
      bestUpdates: new Map<SyncPeriod, altair.LightClientUpdate>(),
      snapshot: {
        header: ssz.phase0.BeaconBlockHeader.defaultValue(),
        currentSyncCommittee: getSyncCommittee(0).syncCommitteeFast,
        nextSyncCommittee: getSyncCommittee(0).syncCommitteeFast,
      },
    };

    processLightClientUpdate(config, store, update, currentSlot);
  });
});

/**
 * Mock BeaconChainLc interface that returns the blockHeaders and states given at the constructor.
 * Throws for any unknown root
 */
class MockBeaconChainLc implements IBeaconChainLc {
  private readonly blockHeaders = new Map<string, phase0.BeaconBlockHeader>();
  private readonly states = new Map<string, altair.BeaconState>();

  constructor(blockHeaders: phase0.BeaconBlockHeader[], states: altair.BeaconState[]) {
    for (const blockHeader of blockHeaders)
      this.blockHeaders.set(toHexString(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader)), blockHeader);
    for (const state of states) this.states.set(toHexString(ssz.altair.BeaconState.hashTreeRoot(state)), state);
  }

  async getBlockHeaderByRoot(blockRoot: Root): Promise<phase0.BeaconBlockHeader> {
    const rootHex = toHexString(blockRoot);
    const blockHeader = this.blockHeaders.get(rootHex);
    if (!blockHeader) throw Error(`No blockHeader for ${rootHex}`);
    return blockHeader;
  }

  async getStateByRoot(stateRoot: Root): Promise<TreeBacked<altair.BeaconState>> {
    const rootHex = toHexString(stateRoot);
    const state = this.states.get(rootHex);
    if (!state) throw Error(`No state for ${rootHex}`);
    return ssz.altair.BeaconState.createTreeBackedFromStruct(state);
  }
}
