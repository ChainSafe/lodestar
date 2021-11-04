import {ENR} from "@chainsafe/discv5";
import {BitVector, toHexString} from "@chainsafe/ssz";
import {ForkName} from "@chainsafe/lodestar-params";
import {altair, Epoch, phase0, ssz} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../chain";
import {FAR_FUTURE_EPOCH} from "../constants";
import {getCurrentAndNextFork} from "./forks";

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

export interface IMetadataOpts {
  metadata?: altair.Metadata;
}

export interface IMetadataModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
  logger: ILogger;
}

/**
 * Implementation of eth2 p2p MetaData.
 * For the spec that this code is based on, see:
 * https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#metadata
 */
export class MetadataController {
  private enr?: ENR;
  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private _metadata: altair.Metadata;
  private logger: ILogger;

  constructor(opts: IMetadataOpts, modules: IMetadataModules) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this._metadata = opts.metadata || ssz.altair.Metadata.defaultValue();
  }

  start(enr: ENR | undefined, currentFork: ForkName): void {
    this.enr = enr;
    if (this.enr) {
      // updateEth2Field() MUST be called with clock epoch
      this.updateEth2Field(this.chain.clock.currentEpoch);

      this.enr.set(ENRKey.attnets, ssz.phase0.AttestationSubnets.serialize(this._metadata.attnets));
      // Any fork after altair included

      if (currentFork !== ForkName.phase0) {
        // Only persist syncnets if altair fork is already activated. If currentFork is altair but head is phase0
        // adding syncnets to the ENR is not a problem, we will just have a useless field for a few hours.
        this.enr.set(ENRKey.syncnets, ssz.phase0.AttestationSubnets.serialize(this._metadata.syncnets));
      }
    }
  }

  get seqNumber(): bigint {
    return this._metadata.seqNumber;
  }

  get syncnets(): BitVector {
    return this._metadata.syncnets;
  }

  set syncnets(syncnets: BitVector) {
    if (this.enr) {
      this.enr.set(ENRKey.syncnets, ssz.altair.SyncSubnets.serialize(syncnets));
    }
    this._metadata.syncnets = syncnets;
  }

  get attnets(): BitVector {
    return this._metadata.attnets;
  }

  set attnets(attnets: BitVector) {
    if (this.enr) {
      this.enr.set(ENRKey.attnets, ssz.phase0.AttestationSubnets.serialize(attnets));
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
    if (this.enr) {
      const enrForkId = ssz.phase0.ENRForkID.serialize(getENRForkID(this.config, epoch));
      this.logger.verbose(`Updated ENR.eth2: ${toHexString(enrForkId)}`);
      this.enr.set(ENRKey.eth2, enrForkId);
    }
  }
}

export function getENRForkID(config: IBeaconConfig, clockEpoch: Epoch): phase0.ENRForkID {
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
