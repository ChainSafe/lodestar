import {BitArray, toHexString} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {altair, Epoch, phase0, ssz} from "@lodestar/types";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {IBeaconChain} from "../chain/index.js";
import {FAR_FUTURE_EPOCH} from "../constants/index.js";
import {getCurrentAndNextFork} from "./forks.js";

export enum ENRKey {
  tcp = "tcp",
  eth2 = "eth2",
  attnets = "attnets",
  syncnets = "syncnets",
}
export enum SubnetType {
  attnets = "attnets",
  syncnets = "syncnets",
}

export type MetadataOpts = {
  metadata?: altair.Metadata;
};

export type MetadataModules = {
  config: BeaconConfig;
  chain: IBeaconChain;
  logger: Logger;
};

/**
 * Implementation of Ethereum Consensus p2p MetaData.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#metadata
 */
export class MetadataController {
  private setEnrValue?: (key: string, value: Uint8Array) => Promise<void>;
  private config: BeaconConfig;
  private chain: IBeaconChain;
  private _metadata: altair.Metadata;
  private logger: Logger;

  constructor(opts: MetadataOpts, modules: MetadataModules) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this._metadata = opts.metadata || ssz.altair.Metadata.defaultValue();
  }

  start(setEnrValue: ((key: string, value: Uint8Array) => Promise<void>) | undefined, currentFork: ForkName): void {
    this.setEnrValue = setEnrValue;
    if (this.setEnrValue) {
      // updateEth2Field() MUST be called with clock epoch
      this.updateEth2Field(this.chain.clock.currentEpoch);

      void this.setEnrValue(ENRKey.attnets, ssz.phase0.AttestationSubnets.serialize(this._metadata.attnets));
      // Any fork after altair included

      if (currentFork !== ForkName.phase0) {
        // Only persist syncnets if altair fork is already activated. If currentFork is altair but head is phase0
        // adding syncnets to the ENR is not a problem, we will just have a useless field for a few hours.
        void this.setEnrValue(ENRKey.syncnets, ssz.phase0.AttestationSubnets.serialize(this._metadata.syncnets));
      }
    }
  }

  get seqNumber(): bigint {
    return this._metadata.seqNumber;
  }

  get syncnets(): BitArray {
    return this._metadata.syncnets;
  }

  set syncnets(syncnets: BitArray) {
    if (this.setEnrValue) {
      void this.setEnrValue(ENRKey.syncnets, ssz.altair.SyncSubnets.serialize(syncnets));
    }
    this._metadata.syncnets = syncnets;
  }

  get attnets(): BitArray {
    return this._metadata.attnets;
  }

  set attnets(attnets: BitArray) {
    if (this.setEnrValue) {
      void this.setEnrValue(ENRKey.attnets, ssz.phase0.AttestationSubnets.serialize(attnets));
    }
    this._metadata.seqNumber++;
    this._metadata.attnets = attnets;
  }

  /** Consumers that need the phase0.Metadata type can just ignore the .syncnets property */
  get json(): altair.Metadata {
    return this._metadata;
  }

  /**
   * From spec:
   *   fork_digest is compute_fork_digest(current_fork_version, genesis_validators_root) where
   *   - current_fork_version is the fork version at the node's current epoch defined by the wall-clock time (not
   *     necessarily the epoch to which the node is sync)
   *   - genesis_validators_root is the static Root found in state.genesis_validators_root
   *
   * 1. MUST be called on start to populate ENR
   * 2. Network MUST call this method on fork transition.
   *    Current Clock implementation ensures no race conditions, epoch is correct if re-fetched
   */
  updateEth2Field(epoch: Epoch): void {
    if (this.setEnrValue) {
      const enrForkId = ssz.phase0.ENRForkID.serialize(getENRForkID(this.config, epoch));
      this.logger.verbose(`Updated ENR.eth2: ${toHexString(enrForkId)}`);
      void this.setEnrValue(ENRKey.eth2, enrForkId);
    }
  }
}

export function getENRForkID(config: BeaconConfig, clockEpoch: Epoch): phase0.ENRForkID {
  const {currentFork, nextFork} = getCurrentAndNextFork(config, clockEpoch);

  return {
    // Current fork digest
    forkDigest: config.forkName2ForkDigest(currentFork.name),
    // next planned fork versin
    nextForkVersion: nextFork ? nextFork.version : currentFork.version,
    // next fork epoch
    nextForkEpoch: nextFork ? nextFork.epoch : FAR_FUTURE_EPOCH,
  };
}
