import {expect} from "chai";
import bls, {init} from "@chainsafe/bls/switchable";
import {createIBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {altair, ssz, SyncPeriod} from "@lodestar/types";
import {LightClientStoreFast} from "../../src/types.js";
import {BeaconChainLcMock} from "../mocks/BeaconChainLcMock.js";
import {processLightClientUpdate} from "../utils/naive/update.js";
import {IBeaconChainLc, prepareUpdateNaive} from "../utils/prepareUpdateNaive.js";
import {getInteropSyncCommittee, getSyncAggregateSigningRoot, SyncCommitteeKeys} from "../utils/utils.js";
import {isNode} from "../../src/utils/utils.js";

function getSyncCommittee(
  syncCommitteesKeys: Map<SyncPeriod, SyncCommitteeKeys>,
  period: SyncPeriod
): SyncCommitteeKeys {
  let syncCommitteeKeys = syncCommitteesKeys.get(period);
  if (!syncCommitteeKeys) {
    syncCommitteeKeys = getInteropSyncCommittee(period);
    syncCommitteesKeys.set(period, syncCommitteeKeys);
  }
  return syncCommitteeKeys;
}

describe("syncInMemory", function () {
  // In browser test this process is taking more time than default 2000ms
  this.timeout(10000);

  // Fixed params
  const genValiRoot = Buffer.alloc(32, 9);
  const config = createIBeaconConfig(chainConfig, genValiRoot);
  const currentSlot = 1;
  const syncCommitteesKeys = new Map<SyncPeriod, SyncCommitteeKeys>();
  let updateData: {chain: IBeaconChainLc; blockWithSyncAggregate: altair.BeaconBlock};
  let update: altair.LightClientUpdate;

  before("init bls", async () => {
    // This process has to be done manually because of an issue in Karma runner
    // https://github.com/karma-runner/karma/issues/3804
    await init(isNode ? "blst-native" : "herumi");
  });

  before("BLS sanity check", () => {
    const sk = bls.SecretKey.fromBytes(Buffer.alloc(32, 1));
    expect(sk.toPublicKey().toHex()).to.equal(
      "0xaa1a1c26055a329817a5759d877a2795f9499b97d6056edde0eea39512f24e8bc874b4471f0501127abb1ea0d9f68ac1"
    );
  });

  before("Generate data for prepareUpdate", () => {
    // Create a state that has as nextSyncCommittee the committee 2
    const finalizedBlockSlot = SLOTS_PER_EPOCH * EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1;
    const headerBlockSlot = finalizedBlockSlot + 1;

    const finalizedState = ssz.altair.BeaconState.defaultValue();
    const finalizedBlockHeader = ssz.phase0.BeaconBlockHeader.defaultValue();
    finalizedBlockHeader.slot = finalizedBlockSlot;
    finalizedBlockHeader.stateRoot = ssz.altair.BeaconState.hashTreeRoot(finalizedState);

    // Create a state that has the next sync committee and finalizedState as finalized checkpoint
    const syncAttestedState = ssz.altair.BeaconState.defaultValue();
    syncAttestedState.nextSyncCommittee = getSyncCommittee(syncCommitteesKeys, 0).syncCommittee;
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
    blockWithSyncAggregate.body.syncAggregate = getSyncCommittee(syncCommitteesKeys, 0).signAndAggregate(signingRoot);
    blockWithSyncAggregate.stateRoot = ssz.altair.BeaconState.hashTreeRoot(stateWithSyncAggregate);

    // Simulate BeaconChain module with a memory map of blocks and states
    const chainMock = new BeaconChainLcMock(
      [finalizedBlockHeader, syncAttestedBlockHeader],
      [finalizedState, syncAttestedState, stateWithSyncAggregate]
    );

    updateData = {chain: chainMock, blockWithSyncAggregate};
  });

  it("should prepare altair update", async () => {
    if (updateData === undefined) throw Error("Prev test failed");

    update = await prepareUpdateNaive(updateData.chain, updateData.blockWithSyncAggregate);
  });

  it("should process altair update", () => {
    if (update === undefined) throw Error("Prev test failed");

    const store: LightClientStoreFast = {
      bestUpdates: new Map<SyncPeriod, altair.LightClientUpdate>(),
      snapshot: {
        header: ssz.phase0.BeaconBlockHeader.defaultValue(),
        currentSyncCommittee: getSyncCommittee(syncCommitteesKeys, 0).syncCommitteeFast,
        nextSyncCommittee: getSyncCommittee(syncCommitteesKeys, 0).syncCommitteeFast,
      },
    };

    expect(() => processLightClientUpdate(config, store, update, currentSlot)).to.not.throw();
  });
});
