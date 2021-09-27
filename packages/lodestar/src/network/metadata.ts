import {ENR} from "@chainsafe/discv5";
import {BitVector, toHexString} from "@chainsafe/ssz";
import {ForkName} from "@chainsafe/lodestar-params";
import {altair, Epoch, phase0, ssz} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ChainEvent, IBeaconChain} from "../chain";
import {FAR_FUTURE_EPOCH} from "../constants";
import {IForkDigestContext} from "../util/forkDigestContext";
import {getCurrentAndNextFork} from "./forks";

export interface IMetadataOpts {
  metadata?: altair.Metadata;
}

export interface IMetadataModules {
  config: IChainForkConfig;
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
  private config: IChainForkConfig;
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
      this.enr.set("eth2", ssz.phase0.ENRForkID.serialize(this.getHeadEnrForkId()));
      this.enr.set("attnets", ssz.phase0.AttestationSubnets.serialize(this._metadata.attnets));
      // Any fork after altair included
      if (currentFork !== ForkName.phase0) {
        // Only persist syncnets if altair fork is already activated. If currentFork is altair but head is phase0
        // adding syncnets to the ENR is not a problem, we will just have a useless field for a few hours.
        this.enr.set("syncnets", ssz.phase0.AttestationSubnets.serialize(this._metadata.syncnets));
      }
    }
    this.chain.emitter.on(ChainEvent.forkVersion, this.handleForkVersion);
  }

  stop(): void {
    this.chain.emitter.off(ChainEvent.forkVersion, this.handleForkVersion);
  }

  get seqNumber(): bigint {
    return this._metadata.seqNumber;
  }

  get syncnets(): BitVector {
    return this._metadata.syncnets;
  }

  set syncnets(syncnets: BitVector) {
    if (this.enr) {
      this.enr.set("syncnets", ssz.altair.SyncSubnets.serialize(syncnets));
    }
    this._metadata.syncnets = syncnets;
  }

  get attnets(): BitVector {
    return this._metadata.attnets;
  }

  set attnets(attnets: BitVector) {
    if (this.enr) {
      this.enr.set("attnets", ssz.phase0.AttestationSubnets.serialize(attnets));
    }
    this._metadata.seqNumber++;
    this._metadata.attnets = attnets;
  }

  /** Consumers that need the phase0.Metadata type can just ignore the .syncnets property */
  get json(): altair.Metadata {
    return this._metadata;
  }

  private handleForkVersion(): void {
    const forkDigest = this.chain.getHeadForkDigest();
    this.logger.verbose(`Metadata: received new fork digest ${toHexString(forkDigest)}`);
    if (this.enr) {
      this.enr.set("eth2", ssz.phase0.ENRForkID.serialize(this.getHeadEnrForkId()));
    }
  }

  private getHeadEnrForkId(): phase0.ENRForkID {
    const headEpoch = computeEpochAtSlot(this.chain.forkChoice.getHead().slot);
    return getENRForkID(this.config, this.chain.forkDigestContext, headEpoch);
  }
}

export function getENRForkID(
  config: IChainForkConfig,
  forkDigestContext: IForkDigestContext,
  epoch: Epoch
): phase0.ENRForkID {
  const {currentFork, nextFork} = getCurrentAndNextFork(config, epoch);

  return {
    // Current fork digest
    forkDigest: forkDigestContext.forkName2ForkDigest(currentFork.name),
    // next planned fork versin
    nextForkVersion: nextFork ? nextFork.version : currentFork.version,
    // next fork epoch
    nextForkEpoch: nextFork ? nextFork.epoch : FAR_FUTURE_EPOCH,
  };
}
