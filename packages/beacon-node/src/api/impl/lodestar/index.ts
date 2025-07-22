import fs from "node:fs";
import path from "node:path";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {AttesterSlashingList, BlockId} from "@lodestar/api/beacon/routes/lodestar.js";
import {ApplicationMethods} from "@lodestar/api/server";
import {ChainForkConfig} from "@lodestar/config";
import {Repository} from "@lodestar/db";
import {ForkName, ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  BeaconStateCapella,
  getLatestWeakSubjectivityCheckpointEpoch,
  isSlashableAttestationData,
  loadState,
} from "@lodestar/state-transition";
import {IndexedAttestation, ValidatorIndex, ssz} from "@lodestar/types";
import {AttesterSlashing} from "@lodestar/types";
import {toHex, toRootHex} from "@lodestar/utils";
import {BeaconChain} from "../../../chain/index.js";
import {QueuedStateRegenerator, RegenCaller, RegenRequest} from "../../../chain/regen/index.js";
import {IBeaconDb} from "../../../db/interface.js";
import {GossipType} from "../../../network/index.js";
import {profileNodeJS, writeHeapSnapshot} from "../../../util/profile.js";
import {getBlockResponse} from "../beacon/blocks/utils.js";
import {getStateResponseWithRegen} from "../beacon/state/utils.js";
import {ApiModules} from "../types.js";

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

    async getAttesterSlashingsFromBlocks({block_ids}) {
      const attesterSlashings: AttesterSlashingList = [];
      const validatorIndicesSeen = new Set<ValidatorIndex>();

      const validatorsAttestations = new Map<ValidatorIndex, IndexedAttestation[]>();

      let fork = chain.config.getForkSeq(chain.clock.currentSlot);

      const blockPromises = block_ids.map((blockId: BlockId) => getBlockResponse(chain, blockId));
      const blockResults = await Promise.allSettled(blockPromises);
      for (const result of blockResults) {
        // Missed block
        if (result.status === "rejected") {
          continue;
        }
        const block = result.value.block;

        const state = await chain.regen.getState(toHex(block.message.stateRoot), RegenCaller.restApi);
        fork = chain.config.getForkSeq(block.message.slot);
        const attestations = block.message.body.attestations;

        // iterate through all the attestations in the block
        for (const attestation of attestations) {
          const indexedAttestation = state.epochCtx.getIndexedAttestation(fork, attestation);

          // extract validators from every attestation
          // and update the list of unique validators
          for (const validatorIndex of indexedAttestation.attestingIndices) {
            if (!validatorIndicesSeen.has(validatorIndex)) {
              validatorIndicesSeen.add(validatorIndex);
            }

            // initiate the list of attestations for a first seen validator
            let validatorAttestationsSeen = validatorsAttestations.get(validatorIndex);
            if (!validatorAttestationsSeen) {
              validatorAttestationsSeen = [];
              validatorsAttestations.set(validatorIndex, validatorAttestationsSeen);
            }

            // iterate through the existing validator attestations and compare with the current attestation
            for (const prevIndexedAttestation of validatorAttestationsSeen) {
              if (
                isSlashableAttestationData(
                  // use json to convert to BigInt
                  ssz.phase0.AttestationDataBigint.fromJson(
                    ssz.phase0.AttestationData.toJson(prevIndexedAttestation.data)
                  ),
                  ssz.phase0.AttestationDataBigint.fromJson(ssz.phase0.AttestationData.toJson(indexedAttestation.data))
                )
              ) {
                // create new slashing and add it to the slashing list
                const newSlashing: AttesterSlashing = {
                  attestation1: ssz.phase0.IndexedAttestationBigint.fromJson(
                    ssz.phase0.IndexedAttestation.toJson(prevIndexedAttestation)
                  ),
                  attestation2: ssz.phase0.IndexedAttestationBigint.fromJson(
                    ssz.phase0.IndexedAttestation.toJson(indexedAttestation)
                  ),
                };
                attesterSlashings.push(newSlashing);
              }
            }

            // update validator attestations list
            validatorAttestationsSeen.push(indexedAttestation);
          }
        }
      }

      return {
        data: attesterSlashings,
        meta: {version: ForkSeq[fork] as ForkName},
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
