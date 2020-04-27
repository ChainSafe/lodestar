import {BitVector} from "@chainsafe/ssz";
import {ENR} from "@chainsafe/discv5";
import {Metadata, ForkDigest} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconChain} from "../../chain";

export interface IMetadataOpts {
  enr?: ENR;
  metadata?: Metadata;
}

export interface IMetadataModules {
  config: IBeaconConfig;
  chain: IBeaconChain;
}

export class MetadataController {
  public enr?: ENR;

  private config: IBeaconConfig;
  private chain: IBeaconChain;
  private _metadata: Metadata;

  constructor(opts: IMetadataOpts, modules: IMetadataModules) {
    this.enr = opts.enr;
    this.config = modules.config;
    this.chain = modules.chain;
    this._metadata = opts.metadata || this.config.types.Metadata.defaultValue();
  }

  public async start(): Promise<void> {
    if (this.enr) {
      this.enr.set("attnets", Buffer.from(this.config.types.AttestationSubnets.serialize(this._metadata.attnets)));
      this.enr.set("eth2", Buffer.from(this.config.types.ENRForkID.serialize(await this.chain.getENRForkID())));
    }
    this.chain.on("forkDigest", this.handleForkDigest);
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("forkDigest", this.handleForkDigest);
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

  get metadata(): Metadata {
    return this._metadata;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async handleForkDigest(forkDigest: ForkDigest): Promise<void> {
    if (this.enr) {
      this.enr.set("eth2", Buffer.from(this.config.types.ENRForkID.serialize(await this.chain.getENRForkID())));
    }
  }
}
