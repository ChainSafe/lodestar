import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  DOMAIN_AGGREGATE_AND_PROOF,
  DOMAIN_BEACON_ATTESTER,
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_CONTRIBUTION_AND_PROOF,
  DOMAIN_RANDAO,
  DOMAIN_SELECTION_PROOF,
  DOMAIN_SYNC_COMMITTEE,
  DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF,
} from "@chainsafe/lodestar-params";
import {
  allForks,
  altair,
  BLSPubkey,
  BLSSignature,
  Epoch,
  phase0,
  Root,
  Slot,
  ValidatorIndex,
  ssz,
} from "@chainsafe/lodestar-types";
import {List, toHexString} from "@chainsafe/ssz";
import {routes} from "@chainsafe/lodestar-api";
import {ISlashingProtection} from "../slashingProtection";
import {BLSKeypair, PubkeyHex} from "../types";
import {getAggregationBits, mapSecretKeysToValidators, mapPublicKeysToValidators, requestSignature} from "./utils";
import {SignerType, Signers} from "../validator";

/**
 * Service that sets up and handles validator attester duties.
 */
export class ValidatorStore {
  private readonly validators: Map<PubkeyHex, BLSKeypair>;
  private readonly genesisValidatorsRoot: Root;
  private readonly remoteSignerUrl: string;
  private readonly isLocal: boolean;

  constructor(
    private readonly config: IBeaconConfig,
    private readonly slashingProtection: ISlashingProtection,
    signers: Signers,
    genesis: phase0.Genesis
  ) {
    if (signers.type === SignerType.Local) {
      this.validators = mapSecretKeysToValidators(signers.secretKeys);
      this.remoteSignerUrl = "";
      this.isLocal = true;
    } else {
      this.validators = mapPublicKeysToValidators(signers.pubkeys, signers.secretKey);
      this.remoteSignerUrl = signers.url;
      this.isLocal = false;
    }

    this.slashingProtection = slashingProtection;
    this.genesisValidatorsRoot = genesis.genesisValidatorsRoot;
  }

  /** Return true if there is at least 1 pubkey registered */
  hasSomeValidators(): boolean {
    return this.validators.size > 0;
  }

  votingPubkeys(): BLSPubkey[] {
    return Array.from(this.validators.values()).map((keypair) => keypair.publicKey);
  }

  hasVotingPubkey(pubkeyHex: PubkeyHex): boolean {
    return this.validators.has(pubkeyHex);
  }

  async signBlock(
    pubkey: BLSPubkey,
    block: allForks.BeaconBlock,
    currentSlot: Slot
  ): Promise<allForks.SignedBeaconBlock> {
    // Make sure the block slot is not higher than the current slot to avoid potential attacks.
    if (block.slot > currentSlot) {
      throw Error(`Not signing block with slot ${block.slot} greater than current slot ${currentSlot}`);
    }

    const proposerDomain = this.config.getDomain(DOMAIN_BEACON_PROPOSER, block.slot);
    const blockType = this.config.getForkTypes(block.slot).BeaconBlock;
    const signingRoot = computeSigningRoot(blockType, block, proposerDomain);

    await this.slashingProtection.checkAndInsertBlockProposal(pubkey, {slot: block.slot, signingRoot});

    return {
      message: block,
      signature: await this.getSignature(pubkey, signingRoot),
    };
  }

  async signRandao(pubkey: BLSPubkey, slot: Slot): Promise<BLSSignature> {
    const epoch = computeEpochAtSlot(slot);
    const randaoDomain = this.config.getDomain(DOMAIN_RANDAO, slot);
    const randaoSigningRoot = computeSigningRoot(ssz.Epoch, epoch, randaoDomain);

    return await this.getSignature(pubkey, randaoSigningRoot);
  }

  async signAttestation(
    duty: routes.validator.AttesterDuty,
    attestationData: phase0.AttestationData,
    currentEpoch: Epoch
  ): Promise<phase0.Attestation> {
    // Make sure the target epoch is not higher than the current epoch to avoid potential attacks.
    if (attestationData.target.epoch > currentEpoch) {
      throw Error(
        `Not signing attestation with target epoch ${attestationData.target.epoch} greater than current epoch ${currentEpoch}`
      );
    }

    this.validateAttestationDuty(duty, attestationData);
    const slot = computeStartSlotAtEpoch(attestationData.target.epoch);
    const domain = this.config.getDomain(DOMAIN_BEACON_ATTESTER, slot);
    const signingRoot = computeSigningRoot(ssz.phase0.AttestationData, attestationData, domain);

    await this.slashingProtection.checkAndInsertAttestation(duty.pubkey, {
      sourceEpoch: attestationData.source.epoch,
      targetEpoch: attestationData.target.epoch,
      signingRoot,
    });

    return {
      aggregationBits: getAggregationBits(duty.committeeLength, duty.validatorCommitteeIndex) as List<boolean>,
      data: attestationData,
      signature: await this.getSignature(duty.pubkey, signingRoot),
    };
  }

  async signAggregateAndProof(
    duty: routes.validator.AttesterDuty,
    selectionProof: BLSSignature,
    aggregate: phase0.Attestation
  ): Promise<phase0.SignedAggregateAndProof> {
    this.validateAttestationDuty(duty, aggregate.data);

    const aggregateAndProof: phase0.AggregateAndProof = {
      aggregate,
      aggregatorIndex: duty.validatorIndex,
      selectionProof,
    };

    const domain = this.config.getDomain(DOMAIN_AGGREGATE_AND_PROOF, aggregate.data.slot);
    const signingRoot = computeSigningRoot(ssz.phase0.AggregateAndProof, aggregateAndProof, domain);

    return {
      message: aggregateAndProof,
      signature: await this.getSignature(duty.pubkey, signingRoot),
    };
  }

  async signSyncCommitteeSignature(
    pubkey: BLSPubkey,
    validatorIndex: ValidatorIndex,
    slot: Slot,
    beaconBlockRoot: Root
  ): Promise<altair.SyncCommitteeMessage> {
    const domain = this.config.getDomain(DOMAIN_SYNC_COMMITTEE, slot);
    const signingRoot = computeSigningRoot(ssz.Root, beaconBlockRoot, domain);

    return {
      slot,
      validatorIndex,
      beaconBlockRoot,
      signature: await this.getSignature(pubkey, signingRoot),
    };
  }

  async signContributionAndProof(
    duty: Pick<routes.validator.SyncDuty, "pubkey" | "validatorIndex">,
    selectionProof: BLSSignature,
    contribution: altair.SyncCommitteeContribution
  ): Promise<altair.SignedContributionAndProof> {
    const contributionAndProof: altair.ContributionAndProof = {
      contribution,
      aggregatorIndex: duty.validatorIndex,
      selectionProof,
    };

    const domain = this.config.getDomain(DOMAIN_CONTRIBUTION_AND_PROOF, contribution.slot);
    const signingRoot = computeSigningRoot(ssz.altair.ContributionAndProof, contributionAndProof, domain);

    return {
      message: contributionAndProof,
      signature: await this.getSignature(duty.pubkey, signingRoot),
    };
  }

  async signAttestationSelectionProof(pubkey: BLSPubkey, slot: Slot): Promise<BLSSignature> {
    const domain = this.config.getDomain(DOMAIN_SELECTION_PROOF, slot);
    const signingRoot = computeSigningRoot(ssz.Slot, slot, domain);

    return await this.getSignature(pubkey, signingRoot);
  }

  async signSyncCommitteeSelectionProof(
    pubkey: BLSPubkey | string,
    slot: Slot,
    subCommitteeIndex: number
  ): Promise<BLSSignature> {
    const domain = this.config.getDomain(DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF, slot);
    const signingData: altair.SyncAggregatorSelectionData = {
      slot,
      subCommitteeIndex: subCommitteeIndex,
    };

    const signingRoot = computeSigningRoot(ssz.altair.SyncAggregatorSelectionData, signingData, domain);

    return await this.getSignature(pubkey, signingRoot);
  }

  private async getSignature(pubkey: BLSPubkey | string, signingRoot: Uint8Array): Promise<BLSSignature> {
    if (this.isLocal) {
      // TODO: Refactor indexing to not have to run toHexString() on the pubkey every time
      const pubkeyHex = typeof pubkey === "string" ? pubkey : toHexString(pubkey);
      const validator = this.validators.get(pubkeyHex);
      if (!validator) {
        throw Error(`Validator ${pubkeyHex} not in local validators map`);
      }
      return validator.secretKey.sign(signingRoot).toBytes();
    } else {
      return await requestSignature(pubkey, signingRoot, this.remoteSignerUrl);
    }
  }

  /** Prevent signing bad data sent by the Beacon node */
  private validateAttestationDuty(duty: routes.validator.AttesterDuty, data: phase0.AttestationData): void {
    if (duty.slot !== data.slot) {
      throw Error(`Inconsistent duties during signing: duty.slot ${duty.slot} != att.slot ${data.slot}`);
    }
    if (duty.committeeIndex != data.index) {
      throw Error(
        `Inconsistent duties during signing: duty.committeeIndex ${duty.committeeIndex} != att.committeeIndex ${data.index}`
      );
    }
  }
}
