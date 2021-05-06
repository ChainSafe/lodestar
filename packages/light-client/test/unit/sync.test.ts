import {expect} from "chai";
import {SecretKey} from "@chainsafe/bls";
import {altair, BLSPubkey, Epoch} from "@chainsafe/lodestar-types";
import {LightClientUpdater, LightClientUpdaterDb, FinalizedCheckpointData} from "../prepareUpdate";
import {createExtraMinimalConfig, getSyncAggregateSigningRoot, signAndAggregate} from "../utils";
import {LightClientUpdate} from "@chainsafe/lodestar-types/lib/altair";
import {computePeriodAtSlot, toBlockHeader} from "../../src/utils";
import {processLightClientUpdate} from "../../src";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {List} from "@chainsafe/ssz";

/* eslint-disable @typescript-eslint/naming-convention */

describe("Lightclient flow with LightClientUpdater", () => {
  const config = createExtraMinimalConfig();

  before("BLS sanity check", () => {
    const sk = SecretKey.fromBytes(Buffer.alloc(32, 1));
    expect(sk.toPublicKey().toHex()).to.equal(
      "0xaa1a1c26055a329817a5759d877a2795f9499b97d6056edde0eea39512f24e8bc874b4471f0501127abb1ea0d9f68ac1"
    );
  });

  // Fixed params
  const genValiRoot = Buffer.alloc(32, 9);
  let committeeKeys: {sks: SecretKey[]; pks: BLSPubkey[]}[];

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

  it("Run chain for a few periods", async () => {
    const db = getLightClientUpdaterDb();
    const lightClientUpdater = new LightClientUpdater(config, db);

    // Create blocks and state
    const fromSlot = 1;
    const toSlot = 150;
    // Compute all periods until toSlot
    const lastPeriod = computePeriodAtSlot(config, toSlot);
    const periods = Array.from({length: lastPeriod + 1}, (_, i) => i);

    let prevBlock: altair.BeaconBlock | null = null;
    const checkpoints: {block: altair.BeaconBlock; state: altair.BeaconState}[] = [];
    let finalizedCheckpoint: altair.Checkpoint | null = null;

    for (let slot = fromSlot; slot <= toSlot; slot++) {
      // Create a block and postState
      const block = config.types.altair.BeaconBlock.defaultValue();
      const state = config.types.altair.BeaconState.defaultValue();
      block.slot = slot;
      state.slot = slot;

      // Set committeeKeys to static set
      state.currentSyncCommittee.pubkeys = committeeKeys[0].pks;
      state.nextSyncCommittee.pubkeys = committeeKeys[0].pks;

      // Point to rolling finalized state
      if (finalizedCheckpoint) {
        state.finalizedCheckpoint = finalizedCheckpoint;
      }

      // Add sync aggregate signing over last block
      if (prevBlock) {
        const attestedBlock = toBlockHeader(config, prevBlock);
        const attestedBlockRoot = config.types.altair.BeaconBlock.hashTreeRoot(prevBlock);
        state.blockRoots[(slot - 1) % config.params.SLOTS_PER_HISTORICAL_ROOT] = attestedBlockRoot;
        const forkVersion = state.fork.currentVersion;
        const signingRoot = getSyncAggregateSigningRoot(config, genValiRoot, forkVersion, attestedBlock);
        block.body.syncAggregate = signAndAggregate(signingRoot, committeeKeys[0].sks);
      }

      block.stateRoot = config.types.altair.BeaconState.hashTreeRoot(state);

      // Store new prevBlock
      prevBlock = block;

      // Simulate finalizing a state
      if ((slot + 1) % config.params.SLOTS_PER_EPOCH === 0) {
        checkpoints[computeEpochAtSlot(config, slot + 1)] = {block, state};

        const finalizedEpoch = computeEpochAtSlot(config, slot) - 2;
        const finalizedData = checkpoints[finalizedEpoch];
        if (finalizedData) {
          finalizedCheckpoint = {
            epoch: finalizedEpoch,
            root: config.types.altair.BeaconBlock.hashTreeRoot(finalizedData.block),
          };

          // Feed new finalized block and state to the LightClientUpdater
          lightClientUpdater.onFinalized(
            finalizedCheckpoint,
            finalizedData.block,
            config.types.altair.BeaconState.createTreeBackedFromStruct(finalizedData.state)
          );
        }
      }

      // Feed new block and state to the LightClientUpdater
      lightClientUpdater.onHead(block, config.types.altair.BeaconState.createTreeBackedFromStruct(state));
    }

    // Check the current state of updates
    const bestUpdates = await lightClientUpdater.getBestUpdates(periods);
    const latestFinalizedUpdate = await lightClientUpdater.getLatestUpdateFinalized();
    const latestNonFinalizedUpdate = await lightClientUpdater.getLatestUpdateNonFinalized();

    expect({
      bestUpdates: bestUpdates.map((u) => u.header.slot),
      latestFinalizedUpdate: latestFinalizedUpdate?.header.slot,
      latestNonFinalizedUpdate: latestNonFinalizedUpdate?.header.slot,
    }).to.deep.equal({
      bestUpdates: [55, 119, 149],
      latestFinalizedUpdate: 119,
      latestNonFinalizedUpdate: 149,
    });

    // Simulate a Lightclient syncing to latest update with these updates

    const store: altair.LightClientStore = {
      snapshot: {
        header: config.types.altair.BeaconBlockHeader.defaultValue(),
        currentSyncCommittee: {pubkeys: committeeKeys[0].pks, pubkeyAggregates: []},
        nextSyncCommittee: {pubkeys: committeeKeys[0].pks, pubkeyAggregates: []},
      },
      validUpdates: ([] as altair.LightClientUpdate[]) as List<altair.LightClientUpdate>,
    };

    for (const [i, update] of bestUpdates.entries()) {
      // Skip first update since it's already known in the snapshot
      if (i === 0) continue;
      try {
        processLightClientUpdate(config, store, update, toSlot, genValiRoot);
      } catch (e) {
        (e as Error).message = `Error processing update ${i}: ${(e as Error).message}`;
        throw e;
      }
    }
  });
});

function getLightClientUpdaterDb(): LightClientUpdaterDb {
  const lightclientFinalizedCheckpoint = new Map<Epoch, FinalizedCheckpointData>();
  const bestUpdatePerCommitteePeriod = new Map<number, LightClientUpdate>();
  let latestFinalizedUpdate: LightClientUpdate | null = null;
  let latestNonFinalizedUpdate: LightClientUpdate | null = null;
  return {
    lightclientFinalizedCheckpoint: {
      put: (key, data) => lightclientFinalizedCheckpoint.set(key, data),
      get: (key) => lightclientFinalizedCheckpoint.get(key) ?? null,
    },
    bestUpdatePerCommitteePeriod: {
      put: (key, data) => bestUpdatePerCommitteePeriod.set(key, data),
      get: (key) => bestUpdatePerCommitteePeriod.get(key) ?? null,
    },
    latestFinalizedUpdate: {
      put: (data) => (latestFinalizedUpdate = data),
      get: () => latestFinalizedUpdate,
    },
    latestNonFinalizedUpdate: {
      put: (data) => (latestNonFinalizedUpdate = data),
      get: () => latestNonFinalizedUpdate,
    },
  };
}
