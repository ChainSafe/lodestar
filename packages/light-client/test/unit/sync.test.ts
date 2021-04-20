import {expect} from "chai";
import {SecretKey} from "@chainsafe/bls";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, BLSPubkey, Root} from "@chainsafe/lodestar-types";
import {toHexString, TreeBacked, List} from "@chainsafe/ssz";
import {processLightClientUpdate} from "../../src";
import {prepareUpdate, IBeaconChainLc} from "../prepareUpdate";
import {createExtraMinimalConfig, getSyncAggregateSigningRoot, signAndAggregate} from "../utils";

/* eslint-disable @typescript-eslint/naming-convention */

describe("Lightclient flow", () => {
  const config = createExtraMinimalConfig();

  before("BLS sanity check", () => {
    const sk = SecretKey.fromBytes(Buffer.alloc(32, 1));
    expect(sk.toPublicKey().toHex()).to.equal(
      "0xaa1a1c26055a329817a5759d877a2795f9499b97d6056edde0eea39512f24e8bc874b4471f0501127abb1ea0d9f68ac1"
    );
  });

  // Fixed params
  const genValiRoot = Buffer.alloc(32, 9);
  const currentSlot = 1;
  let committeeKeys: {sks: SecretKey[]; pks: BLSPubkey[]}[];
  let updateData: {chain: IBeaconChainLc; blockWithSyncAggregate: altair.BeaconBlock};
  let update: altair.LightClientUpdate;

  before("Generate crypto", () => {
    // Create two committees with different keys
    const sks = Array.from({length: 2 * config.params.SYNC_COMMITTEE_SIZE}).map((_, i) =>
      SecretKey.fromBytes(Buffer.alloc(32, i + 1))
    );
    const committee1Sks = sks.slice(0, config.params.SYNC_COMMITTEE_SIZE);
    const committee2Sks = sks.slice(config.params.SYNC_COMMITTEE_SIZE);
    committeeKeys = [
      {sks: committee1Sks, pks: committee1Sks.map((sk) => sk.toPublicKey().toBytes())},
      {sks: committee2Sks, pks: committee1Sks.map((sk) => sk.toPublicKey().toBytes())},
    ];
  });

  before("Generate data for prepareUpdate", () => {
    // Create a state that has as nextSyncCommittee the committee 2
    const finalizedBlockSlot = config.params.SLOTS_PER_EPOCH * config.params.EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1;
    const finalizedState = config.types.altair.BeaconState.defaultValue();
    finalizedState.nextSyncCommittee = {
      pubkeys: committeeKeys[0].pks,
      pubkeyAggregates: finalizedState.nextSyncCommittee.pubkeyAggregates,
    };
    const finalizedBlockHeader = config.types.altair.BeaconBlockHeader.defaultValue();
    finalizedBlockHeader.slot = finalizedBlockSlot;
    finalizedBlockHeader.stateRoot = config.types.altair.BeaconState.hashTreeRoot(finalizedState);

    // Create a state that has the finalizedState as finalized checkpoint
    const syncAttestedState = config.types.altair.BeaconState.defaultValue();
    syncAttestedState.finalizedCheckpoint = {
      epoch: 0, // Checkpoint { epoch, blockRoot }
      root: config.types.altair.BeaconBlockHeader.hashTreeRoot(finalizedBlockHeader),
    };
    const syncAttestedBlockHeader = config.types.altair.BeaconBlockHeader.defaultValue();
    syncAttestedBlockHeader.stateRoot = config.types.altair.BeaconState.hashTreeRoot(syncAttestedState);

    // Create a state with the block blockWithSyncAggregate
    const stateWithSyncAggregate = config.types.altair.BeaconState.defaultValue();
    stateWithSyncAggregate.slot = 1;
    stateWithSyncAggregate.blockRoots[0] = config.types.altair.BeaconBlockHeader.hashTreeRoot(syncAttestedBlockHeader);

    // Create a signature from current committee to "attest" syncAttestedBlockHeader
    const forkVersion = stateWithSyncAggregate.fork.currentVersion;
    const signingRoot = getSyncAggregateSigningRoot(config, genValiRoot, forkVersion, syncAttestedBlockHeader);
    const blockWithSyncAggregate = config.types.altair.BeaconBlock.defaultValue();
    blockWithSyncAggregate.body.syncAggregate = signAndAggregate(signingRoot, committeeKeys[0].sks);
    blockWithSyncAggregate.stateRoot = config.types.altair.BeaconState.hashTreeRoot(stateWithSyncAggregate);

    // Simulate BeaconChain module with a memory map of blocks and states
    const chainMock = new MockBeaconChainLc(
      config,
      [finalizedBlockHeader, syncAttestedBlockHeader],
      [finalizedState, syncAttestedState, stateWithSyncAggregate]
    );

    updateData = {chain: chainMock, blockWithSyncAggregate};
  });

  it("Prepare altair update", async () => {
    if (!updateData) throw Error("Prev test failed");

    update = await prepareUpdate(config, updateData.chain, updateData.blockWithSyncAggregate);
  });

  it("Process altair update", () => {
    if (!update) throw Error("Prev test failed");

    const store: altair.LightClientStore = {
      snapshot: {
        header: config.types.altair.BeaconBlockHeader.defaultValue(),
        currentSyncCommittee: {pubkeys: [], pubkeyAggregates: []},
        nextSyncCommittee: {pubkeys: committeeKeys[0].pks, pubkeyAggregates: []},
      },
      validUpdates: ([] as altair.LightClientUpdate[]) as List<altair.LightClientUpdate>,
    };

    processLightClientUpdate(config, store, update, currentSlot, genValiRoot);
  });
});

/**
 * Mock BeaconChainLc interface that returns the blockHeaders and states given at the constructor.
 * Throws for any unknown root
 */
class MockBeaconChainLc implements IBeaconChainLc {
  private readonly config: IBeaconConfig;
  private readonly blockHeaders = new Map<string, altair.BeaconBlockHeader>();
  private readonly states = new Map<string, altair.BeaconState>();

  constructor(config: IBeaconConfig, blockHeaders: altair.BeaconBlockHeader[], states: altair.BeaconState[]) {
    this.config = config;
    for (const blockHeader of blockHeaders)
      this.blockHeaders.set(toHexString(config.types.altair.BeaconBlockHeader.hashTreeRoot(blockHeader)), blockHeader);
    for (const state of states)
      this.states.set(toHexString(config.types.altair.BeaconState.hashTreeRoot(state)), state);
  }

  async getBlockHeaderByRoot(blockRoot: Root): Promise<altair.BeaconBlockHeader> {
    const rootHex = toHexString(blockRoot);
    const blockHeader = this.blockHeaders.get(rootHex);
    if (!blockHeader) throw Error(`No blockHeader for ${rootHex}`);
    return blockHeader;
  }

  async getStateByRoot(stateRoot: Root): Promise<TreeBacked<altair.BeaconState>> {
    const rootHex = toHexString(stateRoot);
    const state = this.states.get(rootHex);
    if (!state) throw Error(`No state for ${rootHex}`);
    return this.config.types.altair.BeaconState.createTreeBackedFromStruct(state);
  }
}
