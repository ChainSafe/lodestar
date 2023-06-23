import type {SecretKey} from "@chainsafe/bls/types";
import {BitArray, fromHexString, toHexString} from "@chainsafe/ssz";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  computeDomain,
  ZERO_HASH,
  blindedOrFullBlockHashTreeRoot,
  blindedOrFullBlobSidecarHashTreeRoot,
} from "@lodestar/state-transition";
import {BeaconConfig} from "@lodestar/config";
import {
  DOMAIN_AGGREGATE_AND_PROOF,
  DOMAIN_BEACON_ATTESTER,
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_CONTRIBUTION_AND_PROOF,
  DOMAIN_RANDAO,
  DOMAIN_SELECTION_PROOF,
  DOMAIN_SYNC_COMMITTEE,
  DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF,
  DOMAIN_APPLICATION_BUILDER,
  DOMAIN_BLOB_SIDECAR,
} from "@lodestar/params";
import {
  allForks,
  altair,
  bellatrix,
  BLSPubkey,
  BLSSignature,
  Epoch,
  phase0,
  Root,
  Slot,
  ssz,
  ValidatorIndex,
} from "@lodestar/types";
import {routes} from "@lodestar/api";
import {ISlashingProtection} from "../slashingProtection/index.js";
import {PubkeyHex} from "../types.js";
import {externalSignerPostSignature, SignableMessageType, SignableMessage} from "../util/externalSignerClient.js";
import {Metrics} from "../metrics.js";
import {isValidatePubkeyHex} from "../util/format.js";
import {IndicesService} from "./indices.js";
import {DoppelgangerService} from "./doppelgangerService.js";

type BLSPubkeyMaybeHex = BLSPubkey | PubkeyHex;
type Eth1Address = string;

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
  url: string;
  pubkey: PubkeyHex;
};

export enum BuilderSelection {
  BuilderAlways = "builderalways",
  MaxProfit = "maxprofit",
  /** Only activate builder flow for DVT block proposal protocols */
  BuilderOnly = "builderonly",
}

type DefaultProposerConfig = {
  graffiti: string;
  strictFeeRecipientCheck: boolean;
  feeRecipient: Eth1Address;
  builder: {
    enabled: boolean;
    gasLimit: number;
    selection: BuilderSelection;
  };
};

export type ProposerConfig = {
  graffiti?: string;
  strictFeeRecipientCheck?: boolean;
  feeRecipient?: Eth1Address;
  builder?: {
    enabled?: boolean;
    gasLimit?: number;
    selection?: BuilderSelection;
  };
};

export type ValidatorProposerConfig = {
  proposerConfig: {[index: PubkeyHex]: ProposerConfig};
  defaultConfig: ProposerConfig;
};

/**
 * This cache stores SignedValidatorRegistrationV1 data for a validator so that
 * we do not create and send new registration objects to avoid DOSing the builder
 *
 * See: https://github.com/ChainSafe/lodestar/issues/4208
 */
type BuilderData = {
  validatorRegistration: bellatrix.SignedValidatorRegistrationV1;
  regFullKey: string;
};

/**
 * Validator entity capable of producing signatures. Either:
 * - local: With BLS secret key
 * - remote: With data to contact a remote signer
 */
export type Signer = SignerLocal | SignerRemote;

type ValidatorData = ProposerConfig & {
  signer: Signer;
  builderData?: BuilderData;
};

export const defaultOptions = {
  suggestedFeeRecipient: "0x0000000000000000000000000000000000000000",
  defaultGasLimit: 30_000_000,
  builderSelection: BuilderSelection.MaxProfit,
};

/**
 * Service that sets up and handles validator attester duties.
 */
export class ValidatorStore {
  private readonly validators = new Map<PubkeyHex, ValidatorData>();
  /** Initially true because there are no validators */
  private pubkeysToDiscover: PubkeyHex[] = [];
  private readonly defaultProposerConfig: DefaultProposerConfig;

  constructor(
    private readonly config: BeaconConfig,
    private readonly slashingProtection: ISlashingProtection,
    private readonly indicesService: IndicesService,
    private readonly doppelgangerService: DoppelgangerService | null,
    private readonly metrics: Metrics | null,
    initialSigners: Signer[],
    valProposerConfig: ValidatorProposerConfig = {defaultConfig: {}, proposerConfig: {}},
    private readonly genesisValidatorRoot: Root
  ) {
    const defaultConfig = valProposerConfig.defaultConfig;
    this.defaultProposerConfig = {
      graffiti: defaultConfig.graffiti ?? "",
      strictFeeRecipientCheck: defaultConfig.strictFeeRecipientCheck ?? false,
      feeRecipient: defaultConfig.feeRecipient ?? defaultOptions.suggestedFeeRecipient,
      builder: {
        enabled: defaultConfig.builder?.enabled ?? false,
        gasLimit: defaultConfig.builder?.gasLimit ?? defaultOptions.defaultGasLimit,
        selection: defaultConfig.builder?.selection ?? defaultOptions.builderSelection,
      },
    };

    for (const signer of initialSigners) {
      this.addSigner(signer, valProposerConfig);
    }

    if (metrics) {
      metrics.signers.addCollect(() => metrics.signers.set(this.validators.size));
    }
  }

  /** Return all known indices from the validatorStore pubkeys */
  getAllLocalIndices(): ValidatorIndex[] {
    return this.indicesService.getAllLocalIndices();
  }

  getPubkeyOfIndex(index: ValidatorIndex): PubkeyHex | undefined {
    return this.indicesService.index2pubkey.get(index);
  }

  pollValidatorIndices(): Promise<ValidatorIndex[]> {
    // Consumers will call this function every epoch forever. If everyone has been discovered, skip
    return this.indicesService.indexCount >= this.validators.size
      ? Promise.resolve([])
      : this.indicesService.pollValidatorIndices(Array.from(this.validators.keys()));
  }

  getFeeRecipient(pubkeyHex: PubkeyHex): Eth1Address {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    return validatorData.feeRecipient ?? this.defaultProposerConfig.feeRecipient;
  }

  getFeeRecipientByIndex(index: ValidatorIndex): Eth1Address {
    const pubkey = this.indicesService.index2pubkey.get(index);
    return pubkey ? this.getFeeRecipient(pubkey) : this.defaultProposerConfig.feeRecipient;
  }

  setFeeRecipient(pubkeyHex: PubkeyHex, feeRecipient: Eth1Address): void {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    // This should directly modify data in the map
    validatorData.feeRecipient = feeRecipient;
  }

  deleteFeeRecipient(pubkeyHex: PubkeyHex): void {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    // This should directly modify data in the map
    delete validatorData["feeRecipient"];
  }

  getGraffiti(pubkeyHex: PubkeyHex): string {
    return this.validators.get(pubkeyHex)?.graffiti ?? this.defaultProposerConfig.graffiti;
  }

  isBuilderEnabled(pubkeyHex: PubkeyHex): boolean {
    return (this.validators.get(pubkeyHex)?.builder || {}).enabled ?? this.defaultProposerConfig.builder.enabled;
  }

  getBuilderSelection(pubkeyHex: PubkeyHex): BuilderSelection {
    return (this.validators.get(pubkeyHex)?.builder || {}).selection ?? this.defaultProposerConfig.builder.selection;
  }

  strictFeeRecipientCheck(pubkeyHex: PubkeyHex): boolean {
    return (
      this.validators.get(pubkeyHex)?.strictFeeRecipientCheck ?? this.defaultProposerConfig?.strictFeeRecipientCheck
    );
  }

  getGasLimit(pubkeyHex: PubkeyHex): number {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    return validatorData?.builder?.gasLimit ?? this.defaultProposerConfig.builder.gasLimit;
  }

  setGasLimit(pubkeyHex: PubkeyHex, gasLimit: number): void {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    validatorData.builder = {...validatorData.builder, gasLimit};
  }

  deleteGasLimit(pubkeyHex: PubkeyHex): void {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    delete validatorData.builder?.gasLimit;
  }

  /** Return true if `index` is active part of this validator client */
  hasValidatorIndex(index: ValidatorIndex): boolean {
    return this.indicesService.index2pubkey.has(index);
  }

  getProposerConfig(pubkeyHex: PubkeyHex): ProposerConfig | null {
    let proposerConfig: ProposerConfig | null = null;
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }

    const {graffiti, strictFeeRecipientCheck, feeRecipient, builder} = validatorData;

    // if anything is set , i.e not default then return
    if (
      graffiti !== undefined ||
      strictFeeRecipientCheck !== undefined ||
      feeRecipient !== undefined ||
      builder?.enabled !== undefined ||
      builder?.gasLimit !== undefined
    ) {
      proposerConfig = {graffiti, strictFeeRecipientCheck, feeRecipient, builder};
    }
    return proposerConfig;
  }

  async addSigner(signer: Signer, valProposerConfig?: ValidatorProposerConfig): Promise<void> {
    const pubkey = getSignerPubkeyHex(signer);
    const proposerConfig = (valProposerConfig?.proposerConfig ?? {})[pubkey];

    if (!this.validators.has(pubkey)) {
      await this.doppelgangerService?.registerValidator(pubkey);

      this.pubkeysToDiscover.push(pubkey);
      this.validators.set(pubkey, {
        signer,
        ...proposerConfig,
      });
    }
  }

  getSigner(pubkeyHex: PubkeyHex): Signer | undefined {
    return this.validators.get(pubkeyHex)?.signer;
  }

  removeSigner(pubkeyHex: PubkeyHex): boolean {
    this.doppelgangerService?.unregisterValidator(pubkeyHex);

    return this.indicesService.removeForKey(pubkeyHex) || this.validators.delete(pubkeyHex);
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
    blindedOrFull: allForks.FullOrBlindedBeaconBlock,
    currentSlot: Slot
  ): Promise<allForks.FullOrBlindedSignedBeaconBlock> {
    // Make sure the block slot is not higher than the current slot to avoid potential attacks.
    if (blindedOrFull.slot > currentSlot) {
      throw Error(`Not signing block with slot ${blindedOrFull.slot} greater than current slot ${currentSlot}`);
    }

    // Duties are filtered before-hard by doppelganger-safe, this assert should never throw
    this.assertDoppelgangerSafe(pubkey);

    const signingSlot = blindedOrFull.slot;
    const domain = this.config.getDomain(signingSlot, DOMAIN_BEACON_PROPOSER);
    const blockRoot = blindedOrFullBlockHashTreeRoot(this.config, blindedOrFull);
    // Don't use `computeSigningRoot()` here to compute the objectRoot in typesafe function blindedOrFullBlockHashTreeRoot()
    const signingRoot = ssz.phase0.SigningData.hashTreeRoot({objectRoot: blockRoot, domain});

    try {
      await this.slashingProtection.checkAndInsertBlockProposal(pubkey, {slot: blindedOrFull.slot, signingRoot});
    } catch (e) {
      this.metrics?.slashingProtectionBlockError.inc();
      throw e;
    }

    const signableMessage: SignableMessage = {
      type: SignableMessageType.BLOCK_V2,
      data: blindedOrFull,
    };

    return {
      message: blindedOrFull,
      signature: await this.getSignature(pubkey, signingRoot, signingSlot, signableMessage),
    } as allForks.FullOrBlindedSignedBeaconBlock;
  }

  async signBlob(
    pubkey: BLSPubkey,
    blindedOrFull: allForks.FullOrBlindedBlobSidecar,
    currentSlot: Slot
  ): Promise<allForks.FullOrBlindedSignedBlobSidecar> {
    // Make sure the block slot is not higher than the current slot to avoid potential attacks.
    if (blindedOrFull.slot > currentSlot) {
      throw Error(`Not signing block with slot ${blindedOrFull.slot} greater than current slot ${currentSlot}`);
    }

    // Duties are filtered before-hard by doppelganger-safe, this assert should never throw
    this.assertDoppelgangerSafe(pubkey);

    const signingSlot = blindedOrFull.slot;
    const domain = this.config.getDomain(signingSlot, DOMAIN_BLOB_SIDECAR);
    const blobRoot = blindedOrFullBlobSidecarHashTreeRoot(this.config, blindedOrFull);
    // Don't use `computeSigningRoot()` here to compute the objectRoot in typesafe function blindedOrFullBlockHashTreeRoot()
    const signingRoot = ssz.phase0.SigningData.hashTreeRoot({objectRoot: blobRoot, domain});

    // Slashing protection is not required as blobs are binded to blocks which are already protected
    const signableMessage: SignableMessage = {
      type: SignableMessageType.BLOB,
      data: blindedOrFull,
    };

    return {
      message: blindedOrFull,
      signature: await this.getSignature(pubkey, signingRoot, signingSlot, signableMessage),
    } as allForks.FullOrBlindedSignedBlobSidecar;
  }

  async signRandao(pubkey: BLSPubkey, slot: Slot): Promise<BLSSignature> {
    const signingSlot = slot;
    const domain = this.config.getDomain(slot, DOMAIN_RANDAO);
    const epoch = computeEpochAtSlot(slot);
    const signingRoot = computeSigningRoot(ssz.Epoch, epoch, domain);

    const signableMessage: SignableMessage = {
      type: SignableMessageType.RANDAO_REVEAL,
      data: {epoch},
    };

    return this.getSignature(pubkey, signingRoot, signingSlot, signableMessage);
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

    // Duties are filtered before-hard by doppelganger-safe, this assert should never throw
    this.assertDoppelgangerSafe(duty.pubkey);

    this.validateAttestationDuty(duty, attestationData);
    const signingSlot = computeStartSlotAtEpoch(attestationData.target.epoch);
    const domain = this.config.getDomain(signingSlot, DOMAIN_BEACON_ATTESTER);
    const signingRoot = computeSigningRoot(ssz.phase0.AttestationData, attestationData, domain);

    try {
      await this.slashingProtection.checkAndInsertAttestation(duty.pubkey, {
        sourceEpoch: attestationData.source.epoch,
        targetEpoch: attestationData.target.epoch,
        signingRoot,
      });
    } catch (e) {
      this.metrics?.slashingProtectionAttestationError.inc();
      throw e;
    }

    const signableMessage: SignableMessage = {
      type: SignableMessageType.ATTESTATION,
      data: attestationData,
    };

    return {
      aggregationBits: BitArray.fromSingleBit(duty.committeeLength, duty.validatorCommitteeIndex),
      data: attestationData,
      signature: await this.getSignature(duty.pubkey, signingRoot, signingSlot, signableMessage),
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

    const signingSlot = aggregate.data.slot;
    const domain = this.config.getDomain(signingSlot, DOMAIN_AGGREGATE_AND_PROOF);
    const signingRoot = computeSigningRoot(ssz.phase0.AggregateAndProof, aggregateAndProof, domain);

    const signableMessage: SignableMessage = {
      type: SignableMessageType.AGGREGATE_AND_PROOF,
      data: aggregateAndProof,
    };

    return {
      message: aggregateAndProof,
      signature: await this.getSignature(duty.pubkey, signingRoot, signingSlot, signableMessage),
    };
  }

  async signSyncCommitteeSignature(
    pubkey: BLSPubkeyMaybeHex,
    validatorIndex: ValidatorIndex,
    slot: Slot,
    beaconBlockRoot: Root
  ): Promise<altair.SyncCommitteeMessage> {
    const signingSlot = slot;
    const domain = this.config.getDomain(slot, DOMAIN_SYNC_COMMITTEE);
    const signingRoot = computeSigningRoot(ssz.Root, beaconBlockRoot, domain);
    const signableMessage: SignableMessage = {
      type: SignableMessageType.SYNC_COMMITTEE_MESSAGE,
      data: {beaconBlockRoot, slot},
    };

    return {
      slot,
      validatorIndex,
      beaconBlockRoot,
      signature: await this.getSignature(pubkey, signingRoot, signingSlot, signableMessage),
    };
  }

  async signContributionAndProof(
    duty: {pubkey: BLSPubkeyMaybeHex; validatorIndex: number},
    selectionProof: BLSSignature,
    contribution: altair.SyncCommitteeContribution
  ): Promise<altair.SignedContributionAndProof> {
    const contributionAndProof: altair.ContributionAndProof = {
      contribution,
      aggregatorIndex: duty.validatorIndex,
      selectionProof,
    };

    const signingSlot = contribution.slot;
    const domain = this.config.getDomain(signingSlot, DOMAIN_CONTRIBUTION_AND_PROOF);
    const signingRoot = computeSigningRoot(ssz.altair.ContributionAndProof, contributionAndProof, domain);

    const signableMessage: SignableMessage = {
      type: SignableMessageType.SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF,
      data: contributionAndProof,
    };

    return {
      message: contributionAndProof,
      signature: await this.getSignature(duty.pubkey, signingRoot, signingSlot, signableMessage),
    };
  }

  async signAttestationSelectionProof(pubkey: BLSPubkeyMaybeHex, slot: Slot): Promise<BLSSignature> {
    const signingSlot = slot;
    const domain = this.config.getDomain(slot, DOMAIN_SELECTION_PROOF);
    const signingRoot = computeSigningRoot(ssz.Slot, slot, domain);

    const signableMessage: SignableMessage = {
      type: SignableMessageType.AGGREGATION_SLOT,
      data: {slot},
    };

    return this.getSignature(pubkey, signingRoot, signingSlot, signableMessage);
  }

  async signSyncCommitteeSelectionProof(
    pubkey: BLSPubkeyMaybeHex,
    slot: Slot,
    subcommitteeIndex: number
  ): Promise<BLSSignature> {
    const signingSlot = slot;
    const domain = this.config.getDomain(signingSlot, DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF);
    const signingData: altair.SyncAggregatorSelectionData = {
      slot,
      subcommitteeIndex,
    };

    const signingRoot = computeSigningRoot(ssz.altair.SyncAggregatorSelectionData, signingData, domain);

    const signableMessage: SignableMessage = {
      type: SignableMessageType.SYNC_COMMITTEE_SELECTION_PROOF,
      data: {slot, subcommitteeIndex},
    };

    return this.getSignature(pubkey, signingRoot, signingSlot, signableMessage);
  }

  async signVoluntaryExit(
    pubkey: BLSPubkeyMaybeHex,
    validatorIndex: number,
    exitEpoch: Epoch
  ): Promise<phase0.SignedVoluntaryExit> {
    const signingSlot = computeStartSlotAtEpoch(exitEpoch);
    const domain = this.config.getDomainForVoluntaryExit(signingSlot);

    const voluntaryExit: phase0.VoluntaryExit = {epoch: exitEpoch, validatorIndex};
    const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit, domain);

    const signableMessage: SignableMessage = {
      type: SignableMessageType.VOLUNTARY_EXIT,
      data: voluntaryExit,
    };

    return {
      message: voluntaryExit,
      signature: await this.getSignature(pubkey, signingRoot, signingSlot, signableMessage),
    };
  }

  isDoppelgangerSafe(pubkeyHex: PubkeyHex): boolean {
    // If doppelganger is not enabled we assumed all keys to be safe for use
    return !this.doppelgangerService || this.doppelgangerService.isDoppelgangerSafe(pubkeyHex);
  }

  async signValidatorRegistration(
    pubkeyMaybeHex: BLSPubkeyMaybeHex,
    regAttributes: {feeRecipient: Eth1Address; gasLimit: number},
    _slot: Slot
  ): Promise<bellatrix.SignedValidatorRegistrationV1> {
    const pubkey = typeof pubkeyMaybeHex === "string" ? fromHexString(pubkeyMaybeHex) : pubkeyMaybeHex;
    const feeRecipient = fromHexString(regAttributes.feeRecipient);
    const {gasLimit} = regAttributes;

    const validatorRegistration: bellatrix.ValidatorRegistrationV1 = {
      feeRecipient,
      gasLimit,
      timestamp: Math.floor(Date.now() / 1000),
      pubkey,
    };

    const signingSlot = 0;
    const domain = computeDomain(DOMAIN_APPLICATION_BUILDER, this.config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.bellatrix.ValidatorRegistrationV1, validatorRegistration, domain);

    const signableMessage: SignableMessage = {
      type: SignableMessageType.VALIDATOR_REGISTRATION,
      data: validatorRegistration,
    };

    return {
      message: validatorRegistration,
      signature: await this.getSignature(pubkeyMaybeHex, signingRoot, signingSlot, signableMessage),
    };
  }

  async getValidatorRegistration(
    pubkeyMaybeHex: BLSPubkeyMaybeHex,
    regAttributes: {feeRecipient: Eth1Address; gasLimit: number},
    slot: Slot
  ): Promise<bellatrix.SignedValidatorRegistrationV1> {
    const pubkeyHex = typeof pubkeyMaybeHex === "string" ? pubkeyMaybeHex : toHexString(pubkeyMaybeHex);
    const {feeRecipient, gasLimit} = regAttributes;
    const regFullKey = `${feeRecipient}-${gasLimit}`;
    const validatorData = this.validators.get(pubkeyHex);
    const builderData = validatorData?.builderData;
    if (builderData?.regFullKey === regFullKey) {
      return builderData.validatorRegistration;
    } else {
      const validatorRegistration = await this.signValidatorRegistration(pubkeyMaybeHex, regAttributes, slot);
      // If pubkeyHex was actually registered, then update the regData
      if (validatorData !== undefined) {
        validatorData.builderData = {validatorRegistration, regFullKey};
        this.validators.set(pubkeyHex, validatorData);
      }
      return validatorRegistration;
    }
  }

  private async getSignature(
    pubkey: BLSPubkeyMaybeHex,
    signingRoot: Uint8Array,
    signingSlot: Slot,
    signableMessage: SignableMessage
  ): Promise<BLSSignature> {
    // TODO: Refactor indexing to not have to run toHexString() on the pubkey every time
    const pubkeyHex = typeof pubkey === "string" ? pubkey : toHexString(pubkey);

    const signer = this.validators.get(pubkeyHex)?.signer;
    if (!signer) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }

    switch (signer.type) {
      case SignerType.Local: {
        const timer = this.metrics?.localSignTime.startTimer();
        const signature = signer.secretKey.sign(signingRoot).toBytes();
        timer?.();
        return signature;
      }

      case SignerType.Remote: {
        const timer = this.metrics?.remoteSignTime.startTimer();
        try {
          const signatureHex = await externalSignerPostSignature(
            this.config,
            signer.url,
            pubkeyHex,
            signingRoot,
            signingSlot,
            signableMessage
          );
          return fromHexString(signatureHex);
        } catch (e) {
          this.metrics?.remoteSignErrors.inc();
          throw e;
        } finally {
          timer?.();
        }
      }
    }
  }

  private getSignerAndPubkeyHex(pubkey: BLSPubkeyMaybeHex): [Signer, string] {
    // TODO: Refactor indexing to not have to run toHexString() on the pubkey every time
    const pubkeyHex = typeof pubkey === "string" ? pubkey : toHexString(pubkey);
    const signer = this.validators.get(pubkeyHex)?.signer;
    if (!signer) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    return [signer, pubkeyHex];
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

  private assertDoppelgangerSafe(pubKey: PubkeyHex | BLSPubkey): void {
    const pubkeyHex = typeof pubKey === "string" ? pubKey : toHexString(pubKey);
    if (!this.isDoppelgangerSafe(pubkeyHex)) {
      throw new Error(`Doppelganger state for key ${pubkeyHex} is not safe`);
    }
  }
}

function getSignerPubkeyHex(signer: Signer): PubkeyHex {
  switch (signer.type) {
    case SignerType.Local:
      return toHexString(signer.secretKey.toPublicKey().toBytes());

    case SignerType.Remote:
      if (!isValidatePubkeyHex(signer.pubkey)) {
        throw Error(`Bad format in RemoteSigner.pubkey ${signer.pubkey}`);
      }
      return signer.pubkey;
  }
}
