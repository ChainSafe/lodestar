import {BitVector, toHexString} from "@chainsafe/ssz";
import {ENR} from "@chainsafe/discv5";
import {Metadata} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ChainEvent, IBeaconChain} from "../../chain";
import {ILogger} from "@chainsafe/lodestar-utils";

export interface IMetadataOpts {
  metadata?: Metadata;
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
  private _metadata: Metadata;
  private logger: ILogger;

  constructor(opts: IMetadataOpts, modules: IMetadataModules) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this._metadata = opts.metadata || this.config.types.Metadata.defaultValue();
  }

  public async start(enr: ENR): Promise<void> {
    this.enr = enr;
    if (this.enr) {
      this.enr.set("attnets", Buffer.from(this.config.types.AttestationSubnets.serialize(this._metadata.attnets)));
      this.enr.set("eth2", Buffer.from(this.config.types.ENRForkID.serialize(await this.chain.getENRForkID())));
    }
    this.chain.emitter.on(ChainEvent.forkVersion, this.handleForkVersion);
  }

  public async stop(): Promise<void> {
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
      this.enr.set("attnets", Buffer.from(this.config.types.AttestationSubnets.serialize(attnets)));
    }
    this._metadata.seqNumber++;
    this._metadata.attnets = attnets;
  }

  get all(): Metadata {
    return this._metadata;
  }

  private async handleForkVersion(): Promise<void> {
    const forkDigest = await this.chain.getForkDigest();
    this.logger.important(`Metadata: received new fork digest ${toHexString(forkDigest)}`);
    if (this.enr) {
      this.enr.set("eth2", Buffer.from(this.config.types.ENRForkID.serialize(await this.chain.getENRForkID())));
    }
  }
}
