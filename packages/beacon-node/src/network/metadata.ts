import {BitArray} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch, fulu, phase0, ssz} from "@lodestar/types";
import {Logger, toHex} from "@lodestar/utils";
import {FAR_FUTURE_EPOCH} from "../constants/index.js";
import {serializeCgc} from "../util/metadata.js";
import {getCurrentAndNextForkBoundary} from "./forks.js";
import {NetworkConfig} from "./networkConfig.js";

export enum ENRKey {
  tcp = "tcp",
  eth2 = "eth2",
  attnets = "attnets",
  syncnets = "syncnets",
  cgc = "cgc",
  nfd = "nfd",
}
export enum SubnetType {
  attnets = "attnets",
  syncnets = "syncnets",
}

export type MetadataOpts = {
  metadata?: fulu.Metadata;
};

export type MetadataModules = {
  networkConfig: NetworkConfig;
  logger: Logger;
  onSetValue: (key: string, value: Uint8Array) => void;
};

/**
 * Implementation of Ethereum Consensus p2p MetaData.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#metadata
 */
export class MetadataController {
  private onSetValue: (key: string, value: Uint8Array) => void;
  private networkConfig: NetworkConfig;
  private logger: Logger;
  private _metadata: fulu.Metadata;

  constructor(opts: MetadataOpts, modules: MetadataModules) {
    this.networkConfig = modules.networkConfig;
    this.logger = modules.logger;
    this.onSetValue = modules.onSetValue;
    this._metadata = opts.metadata ?? {
      ...ssz.fulu.Metadata.defaultValue(),
      custodyGroupCount: modules.networkConfig.custodyConfig.targetCustodyGroupCount,
    };
  }

  upstreamValues(currentEpoch: Epoch): void {
    // updateEth2Field() MUST be called with clock epoch
    this.updateEth2Field(currentEpoch);

    this.onSetValue(ENRKey.attnets, ssz.phase0.AttestationSubnets.serialize(this._metadata.attnets));

    const config = this.networkConfig.config;

    if (config.getForkSeq(computeStartSlotAtEpoch(currentEpoch)) >= ForkSeq.altair) {
      // Only persist syncnets if altair fork is already activated. If currentFork is altair but head is phase0
      // adding syncnets to the ENR is not a problem, we will just have a useless field for a few hours.
      this.onSetValue(ENRKey.syncnets, ssz.phase0.AttestationSubnets.serialize(this._metadata.syncnets));
    }

    // Set CGC regardless of fork. It may be useful to clients before Fulu, and will be ignored otherwise.
    this.onSetValue(ENRKey.cgc, serializeCgc(this._metadata.custodyGroupCount));
  }

  get seqNumber(): bigint {
    return this._metadata.seqNumber;
  }

  get syncnets(): BitArray {
    return this._metadata.syncnets;
  }

  set syncnets(syncnets: BitArray) {
    this.onSetValue(ENRKey.syncnets, ssz.altair.SyncSubnets.serialize(syncnets));
    this._metadata.syncnets = syncnets;
  }

  get attnets(): BitArray {
    return this._metadata.attnets;
  }

  set attnets(attnets: BitArray) {
    this.onSetValue(ENRKey.attnets, ssz.phase0.AttestationSubnets.serialize(attnets));
    this._metadata.seqNumber++;
    this._metadata.attnets = attnets;
  }

  get custodyGroupCount(): number {
    return this._metadata.custodyGroupCount;
  }

  set custodyGroupCount(custodyGroupCount: number) {
    if (custodyGroupCount === this._metadata.custodyGroupCount) {
      return;
    }
    this.onSetValue(ENRKey.cgc, serializeCgc(custodyGroupCount));
    this._metadata.seqNumber++;
    this._metadata.custodyGroupCount = custodyGroupCount;
  }

  /** Consumers that need the phase0.Metadata type can just ignore the .syncnets property */
  get json(): fulu.Metadata {
    return this._metadata;
  }

  /**
   * From spec:
   *   fork_digest is compute_fork_digest(current_fork_version, genesis_validators_root) where
   *   - current_fork_version is the fork version at the node's current epoch defined by the wall-clock time (not
   *     necessarily the epoch to which the node is sync)
   *   - genesis_validators_root is the static Root found in state.genesis_validators_root
   *   - epoch of fork boundary is used to get blob parameters of current Blob Parameter Only (BPO) fork
   *
   * 1. MUST be called on start to populate ENR
   * 2. Network MUST call this method on fork transition.
   *    Current Clock implementation ensures no race conditions, epoch is correct if re-fetched
   */
  updateEth2Field(epoch: Epoch): void {
    const config = this.networkConfig.config;
    const enrForkId = getENRForkID(config, epoch);
    const {forkDigest, nextForkVersion, nextForkEpoch} = enrForkId;
    this.onSetValue(ENRKey.eth2, ssz.phase0.ENRForkID.serialize(enrForkId));
    this.logger.debug("Updated eth2 field in ENR", {
      forkDigest: toHex(forkDigest),
      nextForkVersion: toHex(nextForkVersion),
      nextForkEpoch,
    });

    const nextForkDigest =
      nextForkEpoch !== FAR_FUTURE_EPOCH
        ? config.forkBoundary2ForkDigest(config.getForkBoundaryAtEpoch(nextForkEpoch))
        : ssz.ForkDigest.defaultValue();
    this.onSetValue(ENRKey.nfd, nextForkDigest);
    this.logger.debug("Updated nfd field in ENR", {nextForkDigest: toHex(nextForkDigest)});
  }
}

export function getENRForkID(config: BeaconConfig, clockEpoch: Epoch): phase0.ENRForkID {
  const {currentBoundary, nextBoundary} = getCurrentAndNextForkBoundary(config, clockEpoch);

  return {
    // Current fork digest
    forkDigest: config.forkBoundary2ForkDigest(currentBoundary),
    // Next planned fork version
    nextForkVersion: nextBoundary
      ? config.forks[nextBoundary.fork].version
      : config.forks[currentBoundary.fork].version,
    // Next fork epoch
    nextForkEpoch: nextBoundary ? nextBoundary.epoch : FAR_FUTURE_EPOCH,
  };
}
