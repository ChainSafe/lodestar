import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {altair, Epoch, phase0} from "@chainsafe/lodestar-types";
import {allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {IAttestationJob, IBeaconChain} from "../../../../chain";
import {AttestationError, AttestationErrorCode} from "../../../../chain/errors";
import {validateGossipAttestation} from "../../../../chain/validation";
import {validateGossipAttesterSlashing} from "../../../../chain/validation/attesterSlashing";
import {validateGossipProposerSlashing} from "../../../../chain/validation/proposerSlashing";
import {validateGossipVoluntaryExit} from "../../../../chain/validation/voluntaryExit";
import {validateSyncCommitteeSigOnly} from "../../../../chain/validation/syncCommittee";
import {IBeaconDb} from "../../../../db";
import {INetwork} from "../../../../network";
import {IBeaconSync} from "../../../../sync";
import {IApiOptions} from "../../../options";
import {IApiModules} from "../../interface";
import {IAttestationFilters, IBeaconPoolApi} from "./interface";

export class BeaconPoolApi implements IBeaconPoolApi {
  private readonly config: IBeaconConfig;
  private readonly db: IBeaconDb;
  private readonly sync: IBeaconSync;
  private readonly network: INetwork;
  private readonly chain: IBeaconChain;

  constructor(opts: Partial<IApiOptions>, modules: Pick<IApiModules, "config" | "chain" | "sync" | "network" | "db">) {
    this.config = modules.config;
    this.db = modules.db;
    this.sync = modules.sync;
    this.network = modules.network;
    this.chain = modules.chain;
  }

  async getAttestations(filters: Partial<IAttestationFilters> = {}): Promise<phase0.Attestation[]> {
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

  async getAttesterSlashings(): Promise<phase0.AttesterSlashing[]> {
    return this.db.attesterSlashing.values();
  }

  async getProposerSlashings(): Promise<phase0.ProposerSlashing[]> {
    return this.db.proposerSlashing.values();
  }

  async getVoluntaryExits(): Promise<phase0.SignedVoluntaryExit[]> {
    return this.db.voluntaryExit.values();
  }

  async submitAttestations(attestations: phase0.Attestation[]): Promise<void> {
    for (const attestation of attestations) {
      const attestationJob = {
        attestation,
        validSignature: false,
      } as IAttestationJob;
      let attestationTargetState;
      try {
        attestationTargetState = await this.chain.regen.getCheckpointState(attestation.data.target);
      } catch (e) {
        throw new AttestationError({
          code: AttestationErrorCode.MISSING_ATTESTATION_TARGET_STATE,
          error: e as Error,
          job: attestationJob,
        });
      }
      const subnet = allForks.computeSubnetForAttestation(this.config, attestationTargetState.epochCtx, attestation);
      await validateGossipAttestation(this.config, this.chain, this.db, attestationJob, subnet);
      await Promise.all([
        this.network.gossip.publishBeaconAttestation(attestation, subnet),
        this.db.attestation.add(attestation),
      ]);
    }
  }

  async submitAttesterSlashing(slashing: phase0.AttesterSlashing): Promise<void> {
    await validateGossipAttesterSlashing(this.config, this.chain, this.db, slashing);
    await Promise.all([this.network.gossip.publishAttesterSlashing(slashing), this.db.attesterSlashing.add(slashing)]);
  }

  async submitProposerSlashing(slashing: phase0.ProposerSlashing): Promise<void> {
    await validateGossipProposerSlashing(this.config, this.chain, this.db, slashing);
    await Promise.all([this.network.gossip.publishProposerSlashing(slashing), this.db.proposerSlashing.add(slashing)]);
  }

  async submitVoluntaryExit(exit: phase0.SignedVoluntaryExit): Promise<void> {
    await validateGossipVoluntaryExit(this.config, this.chain, this.db, exit);
    await Promise.all([this.network.gossip.publishVoluntaryExit(exit), this.db.voluntaryExit.add(exit)]);
  }

  /**
   * POST `/eth/v1/beacon/pool/sync_committees`
   *
   * Submits sync committee signature objects to the node.
   * Sync committee signatures are not present in phase0, but are required for Altair networks.
   * If a sync committee signature is validated successfully the node MUST publish that sync committee signature on all applicable subnets.
   * If one or more sync committee signatures fail validation the node MUST return a 400 error with details of which sync committee signatures have failed, and why.
   *
   * https://github.com/ethereum/eth2.0-APIs/pull/135
   */
  async submitSyncCommitteeSignatures(signatures: altair.SyncCommitteeSignature[]): Promise<void> {
    // Fetch states for all slots of the `signatures`
    const slots = new Set<Epoch>();
    for (const signature of signatures) {
      slots.add(signature.slot);
    }

    // TODO: Fetch states at signature slots
    const state = this.chain.getHeadState();

    // TODO: Cache this value
    const SYNC_COMMITTEE_SUBNET_SIZE = Math.floor(this.config.params.SYNC_COMMITTEE_SIZE / SYNC_COMMITTEE_SUBNET_COUNT);

    await Promise.all(
      signatures.map(async (signature) => {
        const indexesInCommittee = state.currSyncComitteeValidatorIndexMap.get(signature.validatorIndex);
        if (indexesInCommittee === undefined || indexesInCommittee.length === 0) {
          return; // Not a sync committee member
        }

        // Verify signature only, all other data is very likely to be correct, since the `signature` object is created by this node.
        // Worst case if `signature` is not valid, gossip peers will drop it and slightly downscore us.
        await validateSyncCommitteeSigOnly(this.chain, state, signature);

        await Promise.all(
          indexesInCommittee.map(async (indexInCommittee) => {
            // Sync committee subnet members are just sequential in the order they appear in SyncCommitteeIndexes array
            const subnet = Math.floor(indexInCommittee / SYNC_COMMITTEE_SUBNET_SIZE);
            const indexInSubCommittee = indexInCommittee % SYNC_COMMITTEE_SUBNET_SIZE;
            this.db.syncCommittee.add(subnet, signature, indexInSubCommittee);
            await this.network.gossip.publishSyncCommitteeSignature(signature, subnet);
          })
        );
      })
    );
  }
}
