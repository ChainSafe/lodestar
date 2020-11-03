import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Attestation, AttesterSlashing, ProposerSlashing} from "@chainsafe/lodestar-types";
import {SignedVoluntaryExit} from "../../../../../../lodestar-types/lib/types/operations";
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

  public constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "sync" | "network" | "db">) {
    this.config = modules.config;
    this.db = modules.db;
    this.sync = modules.sync;
    this.network = modules.network;
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
    //it could discard attestations that would can be valid a bit later
    // await validateGossipAttestation(
    //   this.config, this.db, headStateContext.epochCtx, headStateContext.state, attestation
    // );
    await Promise.all([
      this.network.gossip.publishCommiteeAttestation(attestation),
      this.db.attestation.add(attestation),
    ]);
  }

  public async getAttesterSlashings(): Promise<AttesterSlashing[]> {
    return this.db.attesterSlashing.values();
  }

  public async submitAttesterSlashing(slashing: AttesterSlashing): Promise<void> {
    await this.db.attesterSlashing.add(slashing);
  }

  public async getProposerSlashings(): Promise<ProposerSlashing[]> {
    return this.db.proposerSlashing.values();
  }

  public async submitProposerSlashing(slashing: ProposerSlashing): Promise<void> {
    await this.db.proposerSlashing.add(slashing);
  }

  public async getVoluntaryExits(): Promise<SignedVoluntaryExit[]> {
    return this.db.voluntaryExit.values();
  }

  public async submitVoluntaryExit(exit: SignedVoluntaryExit): Promise<void> {
    await this.db.voluntaryExit.add(exit);
  }
}
