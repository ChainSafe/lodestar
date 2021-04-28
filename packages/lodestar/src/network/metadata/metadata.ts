import {BitVector, toHexString} from "@chainsafe/ssz";
import {ENR} from "@chainsafe/discv5";
import {phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ChainEvent, IBeaconChain} from "../../chain";
import {ILogger} from "@chainsafe/lodestar-utils";
import {getENRForkID} from "./utils";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

export interface IMetadataOpts {
  metadata?: phase0.Metadata;
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
  private _metadata: phase0.Metadata;
  private logger: ILogger;

  constructor(opts: IMetadataOpts, modules: IMetadataModules) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this._metadata = opts.metadata || this.config.types.phase0.Metadata.defaultValue();
  }

  start(enr: ENR): void {
    this.enr = enr;
    if (this.enr) {
      this.enr.set(
        "attnets",
        Buffer.from(this.config.types.phase0.AttestationSubnets.serialize(this._metadata.attnets))
      );
      this.enr.set("eth2", Buffer.from(this.config.types.phase0.ENRForkID.serialize(this.getHeadEnrForkId())));
    }
    this.chain.emitter.on(ChainEvent.forkVersion, this.handleForkVersion);
  }

  stop(): void {
    this.chain.emitter.off(ChainEvent.forkVersion, this.handleForkVersion);
  }

  get seqNumber(): bigint {
    return this._metadata.seqNumber;
  }

  get attnets(): BitVector {
    return this._metadata.attnets;
  }

  set attnets(attnets: BitVector) {
    if (this.enr) {
      this.enr.set("attnets", Buffer.from(this.config.types.phase0.AttestationSubnets.serialize(attnets)));
    }
    this._metadata.seqNumber++;
    this._metadata.attnets = attnets;
  }

  get all(): phase0.Metadata {
    return this._metadata;
  }

  private handleForkVersion(): void {
    const forkDigest = this.chain.getHeadForkDigest();
    this.logger.verbose(`Metadata: received new fork digest ${toHexString(forkDigest)}`);
    if (this.enr) {
      this.enr.set("eth2", Buffer.from(this.config.types.phase0.ENRForkID.serialize(this.getHeadEnrForkId())));
    }
  }

  private getHeadEnrForkId(): phase0.ENRForkID {
    const headEpoch = computeEpochAtSlot(this.config, this.chain.forkChoice.getHead().slot);
    return getENRForkID(this.config, this.chain.forkDigestContext, headEpoch);
  }
}
