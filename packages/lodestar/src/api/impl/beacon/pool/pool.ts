import {computeSubnetForAttestation} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/util/attestation";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation, AttesterSlashing, ProposerSlashing} from "@chainsafe/lodestar-types";
import {SignedVoluntaryExit} from "../../../../../../lodestar-types/lib/types/operations";
import {IAttestationJob, IBeaconChain} from "../../../../chain";
import {AttestationError, AttestationErrorCode} from "../../../../chain/errors";
import {validateGossipAttestation} from "../../../../chain/validation";
import {validateGossipAttesterSlashing} from "../../../../chain/validation/attesterSlashing";
import {validateGossipProposerSlashing} from "../../../../chain/validation/proposerSlashing";
import {validateGossipVoluntaryExit} from "../../../../chain/validation/voluntaryExit";
import {IBeaconDb} from "../../../../db/api";
import {INetwork} from "../../../../network";
import {IBeaconSync} from "../../../../sync";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../interface";
import {checkSyncStatus} from "../../utils";
import {IAttestationFilters, IBeaconPoolApi} from "./interface";

export class BeaconPoolApi implements IBeaconPoolApi {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly sync: IBeaconSync;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;

  public constructor(
    opts: Partial<IApiOptions>,
    modules: Pick<IApiModules, "config" | "chain" | "sync" | "network" | "db">
  ) {
    this.config = modules.config;
    this.db = modules.db;
    this.sync = modules.sync;
    this.network = modules.network;
    this.chain = modules.chain;
  }

  public async getAttestations(filters: Partial<IAttestationFilters> = {}): Promise<Attestation[]> {
    return (await this.db.attestation.values()).filter((attestation) => {
      if (filters.slot && filters.slot !== attestation.data.slot) {
        return false;
      }
      if (filters.committeeIndex && filters.committeeIndex !== attestation.data.index) {
        return false;
      }
      return true;
    });
  }

  public async submitAttestation(attestation: Attestation): Promise<void> {
    await checkSyncStatus(this.config, this.sync);
    const attestationJob = {
      attestation,
      validSignature: false,
    } as IAttestationJob;
    let attestationPreState;
    try {
      attestationPreState = await this.chain.regen.getCheckpointState(attestation.data.target);
    } catch (e) {
      throw new AttestationError({
        code: AttestationErrorCode.MISSING_ATTESTATION_PRESTATE,
        job: attestationJob,
      });
    }
    const subnet = computeSubnetForAttestation(this.config, attestationPreState, attestation);
    await validateGossipAttestation(this.config, this.chain, this.db, attestationJob, subnet);
    await Promise.all([
      this.network.gossip.publishCommiteeAttestation(attestation),
      this.db.attestation.add(attestation),
    ]);
  }

  public async getAttesterSlashings(): Promise<AttesterSlashing[]> {
    return this.db.attesterSlashing.values();
  }

  public async submitAttesterSlashing(slashing: AttesterSlashing): Promise<void> {
    await validateGossipAttesterSlashing(this.config, this.chain, this.db, slashing);
    await Promise.all([this.network.gossip.publishAttesterSlashing(slashing), this.db.attesterSlashing.add(slashing)]);
  }

  public async getProposerSlashings(): Promise<ProposerSlashing[]> {
    return this.db.proposerSlashing.values();
  }

  public async submitProposerSlashing(slashing: ProposerSlashing): Promise<void> {
    await validateGossipProposerSlashing(this.config, this.chain, this.db, slashing);
    await Promise.all([this.network.gossip.publishProposerSlashing(slashing), this.db.proposerSlashing.add(slashing)]);
  }

  public async getVoluntaryExits(): Promise<SignedVoluntaryExit[]> {
    return this.db.voluntaryExit.values();
  }

  public async submitVoluntaryExit(exit: SignedVoluntaryExit): Promise<void> {
    await validateGossipVoluntaryExit(this.config, this.chain, this.db, exit);
    await Promise.all([this.network.gossip.publishVoluntaryExit(exit), this.db.voluntaryExit.add(exit)]);
  }
}
