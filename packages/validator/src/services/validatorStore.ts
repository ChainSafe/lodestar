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
  DOMAIN_VOLUNTARY_EXIT,
} from "@chainsafe/lodestar-params";
import {SecretKey} from "@chainsafe/bls";
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
import {fromHexString, List, toHexString} from "@chainsafe/ssz";
import {routes} from "@chainsafe/lodestar-api";
import {ISlashingProtection} from "../slashingProtection";
import {PubkeyHex} from "../types";
import {getAggregationBits} from "./utils";
import {externalSignerPostSignature} from "../util/externalSignerClient";

export enum SignerType {
  Local,
  Remote,
}

export type SignerLocal = {
  type: SignerType.Local;
  secretKey: SecretKey;
};

export type SignerRemote = {
  type: SignerType.Remote;
  externalSignerUrl: string;
  pubkeyHex: PubkeyHex;
};

/**
 * Validator entity capable of producing signatures. Either:
 * - local: With BLS secret key
 * - remote: With data to contact a remote signer
 */
export type Signer = SignerLocal | SignerRemote;

/**
 * Service that sets up and handles validator attester duties.
 */
export class ValidatorStore {
  private readonly validators = new Map<PubkeyHex, Signer>();
  private readonly genesisValidatorsRoot: Root;

  constructor(
    private readonly config: IBeaconConfig,
    private readonly slashingProtection: ISlashingProtection,
    signers: Signer[],
    genesis: phase0.Genesis
  ) {
    for (const signer of signers) {
      this.validators.set(getSignerPubkeyHex(signer), signer);
    }

    this.slashingProtection = slashingProtection;
    this.genesisValidatorsRoot = genesis.genesisValidatorsRoot;
  }

  /** Return true if there is at least 1 pubkey registered */
  hasSomeValidators(): boolean {
    return this.validators.size > 0;
  }

  votingPubkeys(): PubkeyHex[] {
    return Array.from(this.validators.keys());
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
    subcommitteeIndex: number
  ): Promise<BLSSignature> {
    const domain = this.config.getDomain(DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF, slot);
    const signingData: altair.SyncAggregatorSelectionData = {
      slot,
      subcommitteeIndex: subcommitteeIndex,
    };

    const signingRoot = computeSigningRoot(ssz.altair.SyncAggregatorSelectionData, signingData, domain);

    return await this.getSignature(pubkey, signingRoot);
  }

  async signVoluntaryExit(
    pubkey: PubkeyHex,
    validatorIndex: number,
    exitEpoch: Epoch
  ): Promise<phase0.SignedVoluntaryExit> {
    const domain = this.config.getDomain(DOMAIN_VOLUNTARY_EXIT, computeStartSlotAtEpoch(exitEpoch));

    const voluntaryExit: phase0.VoluntaryExit = {epoch: exitEpoch, validatorIndex};
    const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit, domain);

    return {
      message: voluntaryExit,
      signature: await this.getSignature(pubkey, signingRoot),
    };
  }

  private async getSignature(pubkey: BLSPubkey | string, signingRoot: Uint8Array): Promise<BLSSignature> {
    // TODO: Refactor indexing to not have to run toHexString() on the pubkey every time
    const pubkeyHex = typeof pubkey === "string" ? pubkey : toHexString(pubkey);

    const signer = this.validators.get(pubkeyHex);
    if (!signer) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }

    switch (signer.type) {
      case SignerType.Local:
        return signer.secretKey.sign(signingRoot).toBytes();

      case SignerType.Remote: {
        const signatureHex = await externalSignerPostSignature(
          signer.externalSignerUrl,
          pubkeyHex,
          toHexString(signingRoot)
        );
        return fromHexString(signatureHex);
      }
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

function getSignerPubkeyHex(signer: Signer): PubkeyHex {
  switch (signer.type) {
    case SignerType.Local:
      return toHexString(signer.secretKey.toPublicKey().toBytes());

    case SignerType.Remote:
      return signer.pubkeyHex;
  }
}
