import fs from "node:fs";
import path from "node:path";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {routes} from "@lodestar/api";
import {ApplicationMethods} from "@lodestar/api/server";
import {ChainForkConfig} from "@lodestar/config";
import {Repository} from "@lodestar/db";
import {ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  BeaconStateCapella,
  CachedBeaconStateAllForks,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createCachedBeaconState,
  getAttesterSlashableIndices,
  getLatestWeakSubjectivityCheckpointEpoch,
  isSlashableAttestationData,
  loadState,
} from "@lodestar/state-transition";
import {IndexedAttestation, IndexedAttestationBigint, Slot, ssz} from "@lodestar/types";
import {AttesterSlashing} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {BeaconChain, IBeaconChain} from "../../../chain/index.js";
import {QueuedStateRegenerator, RegenRequest} from "../../../chain/regen/index.js";
import {IBeaconDb} from "../../../db/interface.js";
import {GossipType} from "../../../network/index.js";
import {profileNodeJS, writeHeapSnapshot} from "../../../util/profile.js";
import {getStateResponseWithRegen} from "../beacon/state/utils.js";
import {ApiModules} from "../types.js";
import {toIndexedAttestationBigint} from "../utils.js";

type HexRoot = string;

export function getLodestarApi({
  chain,
  config,
  db,
  network,
  sync,
}: Pick<ApiModules, "chain" | "config" | "db" | "network" | "sync">): ApplicationMethods<routes.lodestar.Endpoints> {
  let writingHeapdump = false;
  let writingProfile = false;
  const defaultProfileMs = SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT * 1000;

  return {
    async writeHeapdump({thread = "main", dirpath = "."}) {
      if (writingHeapdump) {
        throw Error("Already writing heapdump");
      }

      try {
        writingHeapdump = true;
        let filepath: string;
        switch (thread) {
          case "network":
            filepath = await network.writeNetworkHeapSnapshot("network_thread", dirpath);
            break;
          case "discv5":
            filepath = await network.writeDiscv5HeapSnapshot("discv5_thread", dirpath);
            break;
          default:
            // main thread
            filepath = await writeHeapSnapshot("main_thread", dirpath);
            break;
        }
        return {data: {filepath}};
      } finally {
        writingHeapdump = false;
      }
    },

    async writeProfile({thread = "network", duration = defaultProfileMs, dirpath = "."}) {
      if (writingProfile) {
        throw Error("Already writing network profile");
      }
      writingProfile = true;

      try {
        let filepath: string;
        let profile: string;
        switch (thread) {
          case "network":
            filepath = await network.writeNetworkThreadProfile(duration, dirpath);
            break;
          case "discv5":
            filepath = await network.writeDiscv5Profile(duration, dirpath);
            break;
          default:
            // main thread
            profile = await profileNodeJS(duration);
            filepath = path.join(dirpath, `main_thread_${new Date().toISOString()}.cpuprofile`);
            fs.writeFileSync(filepath, profile);
            break;
        }
        return {data: {filepath}};
      } finally {
        writingProfile = false;
      }
    },

    async getLatestWeakSubjectivityCheckpointEpoch() {
      const state = chain.getHeadState();
      return {data: getLatestWeakSubjectivityCheckpointEpoch(config, state)};
    },

    async getSyncChainsDebugState() {
      return {data: sync.getSyncChainsDebugState()};
    },

    async getGossipQueueItems({gossipType}) {
      return {
        data: await network.dumpGossipQueue(gossipType as GossipType),
      };
    },

    async getRegenQueueItems() {
      return {
        data: (chain.regen as QueuedStateRegenerator).jobQueue.getItems().map((item) => ({
          key: item.args[0].key,
          args: regenRequestToJson(config, item.args[0]),
          addedTimeMs: item.addedTimeMs,
        })),
      };
    },

    async getBlockProcessorQueueItems() {
      return {
        // biome-ignore lint/complexity/useLiteralKeys: The `blockProcessor` is a protected attribute
        data: (chain as BeaconChain)["blockProcessor"].jobQueue.getItems().map((item) => {
          const [blockInputs, opts] = item.args;
          return {
            blockSlots: blockInputs.map((blockInput) => blockInput.block.message.slot),
            jobOpts: opts,
            addedTimeMs: item.addedTimeMs,
          };
        }),
      };
    },

    async getStateCacheItems() {
      return {data: chain.regen.dumpCacheSummary()};
    },

    async getGossipPeerScoreStats() {
      return {
        data: Object.entries(await network.dumpGossipPeerScoreStats()).map(([peerId, stats]) => ({peerId, ...stats})),
      };
    },

    async getLodestarPeerScoreStats() {
      return {data: await network.dumpPeerScoreStats()};
    },

    async runGC() {
      if (!global.gc) throw Error("You must expose GC running the Node.js process with 'node --expose_gc'");
      global.gc();
    },

    async dropStateCache() {
      chain.regen.dropCache();
    },

    async connectPeer({peerId, multiaddrs}) {
      await network.connectToPeer(peerId, multiaddrs);
    },

    async disconnectPeer({peerId}) {
      await network.disconnectPeer(peerId);
    },

    async getPeers({state, direction}) {
      const peers = (await network.dumpPeers()).filter(
        (nodePeer) =>
          (!state || state.length === 0 || state.includes(nodePeer.state)) &&
          (!direction || direction.length === 0 || (nodePeer.direction && direction.includes(nodePeer.direction)))
      );

      return {
        data: peers,
        meta: {count: peers.length},
      };
    },

    async getBlacklistedBlocks() {
      return {
        data: Array.from(chain.blacklistedBlocks.entries()).map(([root, slot]) => ({root, slot})),
      };
    },

    async discv5GetKadValues() {
      return {
        data: await network.dumpDiscv5KadValues(),
      };
    },

    async dumpDbBucketKeys({bucket}) {
      for (const repo of Object.values(db) as IBeaconDb[keyof IBeaconDb][]) {
        // biome-ignore lint/complexity/useLiteralKeys: `bucket` is protected and `bucketId` is private
        if (repo instanceof Repository && (String(repo["bucket"]) === bucket || repo["bucketId"] === bucket)) {
          return {data: stringifyKeys(await repo.keys())};
        }
      }

      throw Error(`Unknown Bucket '${bucket}'`);
    },

    async dumpDbStateIndex() {
      return {data: await db.stateArchive.dumpRootIndexEntries()};
    },

    async getHistoricalSummaries({stateId}) {
      const {state, executionOptimistic, finalized} = await getStateResponseWithRegen(chain, stateId);

      const stateView = (
        state instanceof Uint8Array ? loadState(config, chain.getHeadState(), state).state : state.clone()
      ) as BeaconStateCapella;

      const fork = config.getForkName(stateView.slot);
      if (ForkSeq[fork] < ForkSeq.capella) {
        throw new Error("Historical summaries are not supported before Capella");
      }

      const {gindex} = ssz[fork].BeaconState.getPathInfo(["historicalSummaries"]);
      const proof = new Tree(stateView.node).getSingleProof(gindex);

      return {
        data: {
          slot: stateView.slot,
          historicalSummaries: stateView.historicalSummaries.toValue(),
          proof: proof,
        },
        meta: {executionOptimistic, finalized, version: fork},
      };
    },

    async getAttesterSlashingsFromBlocks({signedBlocks}) {
      const attesterSlashings = new Map<HexRoot, AttesterSlashing>();
      const seenAttestations: {
        indexedAttestationBigint: IndexedAttestationBigint;
        slot: Slot;
      }[] = [];
      const beaconStateCache = new Map<Slot, CachedBeaconStateAllForks>();
      // TODO check fork
      const fork = chain.config.getForkSeq(signedBlocks[0]?.message.slot ?? 0);

      // helper function to manage the state cache
      const getState = async (slot: number) => {
        const epoch = computeEpochAtSlot(slot);
        const startSlot = computeStartSlotAtEpoch(epoch);

        if (beaconStateCache.has(startSlot)) {
          return beaconStateCache.get(startSlot);
        }

        const state = await getStateWithRegen(startSlot, chain, config);
        if (state) {
          beaconStateCache.set(startSlot, state);
        }
        return state;
      };

      for (const block of signedBlocks) {
        const blockSlot = block.message.slot;
        const attestations = block.message.body.attestations;

        const attestationState = await getState(blockSlot);
        if (!attestationState) {
          throw new Error("Failed to retrieve state for attestation.");
        }

        for (const attestation of attestations) {
          const indexedAttestation = attestationState.epochCtx.getIndexedAttestation(fork, attestation);
          const indexedAttestationBigint = toIndexedAttestationBigint(indexedAttestation);

          for (const seenAttestation of seenAttestations) {
            const seenAttestationState = await getState(seenAttestation.slot);

            if (!seenAttestationState) {
              throw new Error("Failed to retrieve state for seen attestation.");
            }

            if (
              isSlashableAttestationData(indexedAttestationBigint.data, seenAttestation.indexedAttestationBigint.data)
            ) {
              const attesterSlashing: AttesterSlashing = {
                attestation1: seenAttestation.indexedAttestationBigint,
                attestation2: indexedAttestationBigint,
              };
              const intersectingIndices = getAttesterSlashableIndices(attesterSlashing);
              if (intersectingIndices.length > 0) {
                const rootHash = ssz.electra.AttesterSlashing.hashTreeRoot(attesterSlashing);
                attesterSlashings.set(toRootHex(rootHash), attesterSlashing);
              }
            }
          }
          seenAttestations.push({
            indexedAttestationBigint: indexedAttestationBigint,
            slot: blockSlot,
          });
        }
      }

      return {
        data: Array.from(attesterSlashings.values()),
      };
    },
  };
}

function regenRequestToJson(config: ChainForkConfig, regenRequest: RegenRequest): unknown {
  switch (regenRequest.key) {
    case "getBlockSlotState":
      return {
        root: regenRequest.args[0],
        slot: regenRequest.args[1],
      };

    case "getCheckpointState":
      return ssz.phase0.Checkpoint.toJson(regenRequest.args[0]);

    case "getPreState": {
      const slot = regenRequest.args[0].slot;
      return {
        root: toRootHex(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(regenRequest.args[0])),
        slot,
      };
    }

    case "getState":
      return {
        root: regenRequest.args[0],
      };
  }
}

function stringifyKeys(keys: (Uint8Array | number | string)[]): string[] {
  return keys.map((key) => {
    if (key instanceof Uint8Array) {
      return toHex(key);
    }
    return `${key}`;
  });
}

async function getStateWithRegen(
  slot: Slot,
  chain: IBeaconChain,
  config: ChainForkConfig
): Promise<CachedBeaconStateAllForks | undefined> {
  const epoch = computeEpochAtSlot(slot);
  const startSlot = computeStartSlotAtEpoch(epoch);

  const res = await getStateResponseWithRegen(chain, startSlot);

  const stateViewDU =
    res.state instanceof Uint8Array ? loadState(config, chain.getHeadState(), res.state).state : res.state.clone();

  const state = createCachedBeaconState(
    stateViewDU,
    {
      config: chain.config,
      // Not required to compute proposers
      pubkey2index: new PubkeyIndexMap(),
      index2pubkey: [],
    },
    {skipSyncPubkeys: true, skipSyncCommitteeCache: true}
  );

  return state;
}
