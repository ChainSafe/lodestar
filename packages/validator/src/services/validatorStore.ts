import {
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  computeDomain,
  ZERO_HASH,
} from "@lodestar/state-transition";
import {IBeaconConfig} from "@lodestar/config";
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
  DOMAIN_APPLICATION_BUILDER,
} from "@lodestar/params";
import type {SecretKey} from "@chainsafe/bls/types";
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
import {BitArray, fromHexString, toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {ISlashingProtection} from "../slashingProtection/index.js";
import {PubkeyHex} from "../types.js";
import {externalSignerPostSignature} from "../util/externalSignerClient.js";
import {Metrics} from "../metrics.js";
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

type DefaultProposerConfig = {
  graffiti: string;
  strictFeeRecipientCheck: boolean;
  feeRecipient: Eth1Address;
  builder: {
    enabled: boolean;
    gasLimit: number;
  };
};

export type ProposerConfig = {
  graffiti?: string;
  strictFeeRecipientCheck?: boolean;
  feeRecipient?: Eth1Address;
  builder: {
    enabled?: boolean;
    gasLimit?: number;
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
    private readonly config: IBeaconConfig,
    private readonly slashingProtection: ISlashingProtection,
    private readonly indicesService: IndicesService,
    private readonly doppelgangerService: DoppelgangerService | null,
    private readonly metrics: Metrics | null,
    initialSigners: Signer[],
    valProposerConfig: ValidatorProposerConfig = {defaultConfig: {builder: {}}, proposerConfig: {}}
  ) {
    const defaultConfig = valProposerConfig.defaultConfig;
    this.defaultProposerConfig = {
      graffiti: defaultConfig.graffiti ?? "",
      strictFeeRecipientCheck: defaultConfig.strictFeeRecipientCheck ?? false,
      feeRecipient: defaultConfig.feeRecipient ?? defaultOptions.suggestedFeeRecipient,
      builder: {
        enabled: defaultConfig.builder?.enabled ?? false,
        gasLimit: defaultConfig.builder?.gasLimit ?? defaultOptions.defaultGasLimit,
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
    if (this.validators.has(pubkeyHex)) {
      return this.validators.get(pubkeyHex)?.feeRecipient ?? this.defaultProposerConfig.feeRecipient;
    } else {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
  }

  getFeeRecipientByIndex(index: ValidatorIndex): Eth1Address {
    const pubkey = this.indicesService.index2pubkey.get(index);
    return pubkey ? this.getFeeRecipient(pubkey) : this.defaultProposerConfig.feeRecipient;
  }

  setFeeRecipient(pubkeyHex: PubkeyHex, feeRecipient: Eth1Address): void {
    if (this.validators.has(pubkeyHex)) {
      const validatorData = this.validators.get(pubkeyHex);
      if (validatorData !== undefined) {
        //const newValidatorData = {...validatorData, feeRecipient}
        this.validators.set(pubkeyHex, {...validatorData, feeRecipient});
      } else {
        throw Error(`ValidatorData for pubkey ${pubkeyHex} not set `);
      }
    } else {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
  }

  deleteFeeRecipient(pubkeyHex: PubkeyHex): void {
    if (this.validators.has(pubkeyHex)) {
      const validatorData = this.validators.get(pubkeyHex);
      if (validatorData !== undefined) {
        delete validatorData["feeRecipient"];
        this.validators.set(pubkeyHex, validatorData);
      } else {
        throw Error(`ValidatorData for pubkey ${pubkeyHex} not set `);
      }
    } else {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
  }

  getGraffiti(pubkeyHex: PubkeyHex): string {
    return this.validators.get(pubkeyHex)?.graffiti ?? this.defaultProposerConfig.graffiti;
  }

  isBuilderEnabled(pubkeyHex: PubkeyHex): boolean {
    return (this.validators.get(pubkeyHex)?.builder || {}).enabled ?? this.defaultProposerConfig?.builder.enabled;
  }

  strictFeeRecipientCheck(pubkeyHex: PubkeyHex): boolean {
    return (
      this.validators.get(pubkeyHex)?.strictFeeRecipientCheck ?? this.defaultProposerConfig?.strictFeeRecipientCheck
    );
  }

  getGasLimit(pubkeyHex: PubkeyHex): number {
    if (this.validators.has(pubkeyHex)) {
      return (
        (this.validators.get(pubkeyHex)?.builder || {}).gasLimit ??
        this.defaultProposerConfig?.builder.gasLimit ??
        defaultOptions.defaultGasLimit
      );
    } else {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
  }

  setGasLimit(pubkeyHex: PubkeyHex, gasLimitString: string | number): void {
    if (Number.isNaN(Number(gasLimitString))) {
      throw Error("Gas Limit is Not a number");
    }

    const gasLimit = Number(gasLimitString);

    if (this.validators.has(pubkeyHex)) {
      const validatorData = this.validators.get(pubkeyHex);
      if (validatorData !== undefined) {
        this.validators.set(pubkeyHex, {...validatorData, builder: {...validatorData.builder, gasLimit}});
      } else {
        throw Error(`ValidatorData for pubkey ${pubkeyHex} not set `);
      }
    } else {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
  }

  deleteGasLimit(pubkeyHex: PubkeyHex): void {
    if (this.validators.has(pubkeyHex)) {
      const validatorData = this.validators.get(pubkeyHex);
      if (validatorData !== undefined) {
        delete validatorData.builder["gasLimit"];
        this.validators.set(pubkeyHex, validatorData);
      } else {
        throw Error(`ValidatorData for pubkey ${pubkeyHex} not set `);
      }
    } else {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
  }

  /** Return true if `index` is active part of this validator client */
  hasValidatorIndex(index: ValidatorIndex): boolean {
    return this.indicesService.index2pubkey.has(index);
  }

  addSigner(signer: Signer, valProposerConfig?: ValidatorProposerConfig): void {
    const pubkey = getSignerPubkeyHex(signer);
    const proposerConfig = (valProposerConfig?.proposerConfig ?? {})[pubkey] ?? {};

    if (!this.validators.has(pubkey)) {
      this.pubkeysToDiscover.push(pubkey);
      this.validators.set(pubkey, {
        signer,
        ...proposerConfig,
      });

      this.doppelgangerService?.registerValidator(pubkey);
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

    const proposerDomain = this.config.getDomain(blindedOrFull.slot, DOMAIN_BEACON_PROPOSER, blindedOrFull.slot);
    const blockType =
      (blindedOrFull.body as bellatrix.BlindedBeaconBlockBody).executionPayloadHeader !== undefined
        ? ssz.bellatrix.BlindedBeaconBlock
        : this.config.getForkTypes(blindedOrFull.slot).BeaconBlock;
    const signingRoot = computeSigningRoot(blockType, blindedOrFull, proposerDomain);

    try {
      await this.slashingProtection.checkAndInsertBlockProposal(pubkey, {slot: blindedOrFull.slot, signingRoot});
    } catch (e) {
      this.metrics?.slashingProtectionBlockError.inc();
      throw e;
    }
    const signature = await this.getSignature(pubkey, signingRoot);

    return {message: blindedOrFull, signature} as allForks.FullOrBlindedSignedBeaconBlock;
  }

  async signRandao(pubkey: BLSPubkey, slot: Slot): Promise<BLSSignature> {
    const epoch = computeEpochAtSlot(slot);
    const randaoDomain = this.config.getDomain(slot, DOMAIN_RANDAO);
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

    // Duties are filtered before-hard by doppelganger-safe, this assert should never throw
    this.assertDoppelgangerSafe(duty.pubkey);

    this.validateAttestationDuty(duty, attestationData);
    const slot = computeStartSlotAtEpoch(attestationData.target.epoch);
    const domain = this.config.getDomain(slot, DOMAIN_BEACON_ATTESTER);
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

    return {
      aggregationBits: BitArray.fromSingleBit(duty.committeeLength, duty.validatorCommitteeIndex),
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

    const domain = this.config.getDomain(duty.slot, DOMAIN_AGGREGATE_AND_PROOF);
    const signingRoot = computeSigningRoot(ssz.phase0.AggregateAndProof, aggregateAndProof, domain);

    return {
      message: aggregateAndProof,
      signature: await this.getSignature(duty.pubkey, signingRoot),
    };
  }

  async signSyncCommitteeSignature(
    pubkey: BLSPubkeyMaybeHex,
    validatorIndex: ValidatorIndex,
    slot: Slot,
    beaconBlockRoot: Root
  ): Promise<altair.SyncCommitteeMessage> {
    const domain = this.config.getDomain(slot, DOMAIN_SYNC_COMMITTEE);
    const signingRoot = computeSigningRoot(ssz.Root, beaconBlockRoot, domain);

    return {
      slot,
      validatorIndex,
      beaconBlockRoot,
      signature: await this.getSignature(pubkey, signingRoot),
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

    const domain = this.config.getDomain(contribution.slot, DOMAIN_CONTRIBUTION_AND_PROOF);
    const signingRoot = computeSigningRoot(ssz.altair.ContributionAndProof, contributionAndProof, domain);

    return {
      message: contributionAndProof,
      signature: await this.getSignature(duty.pubkey, signingRoot),
    };
  }

  async signAttestationSelectionProof(pubkey: BLSPubkeyMaybeHex, slot: Slot): Promise<BLSSignature> {
    const domain = this.config.getDomain(slot, DOMAIN_SELECTION_PROOF);
    const signingRoot = computeSigningRoot(ssz.Slot, slot, domain);

    return await this.getSignature(pubkey, signingRoot);
  }

  async signSyncCommitteeSelectionProof(
    pubkey: BLSPubkeyMaybeHex,
    slot: Slot,
    subcommitteeIndex: number
  ): Promise<BLSSignature> {
    const domain = this.config.getDomain(slot, DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF);
    const signingData: altair.SyncAggregatorSelectionData = {
      slot,
      subcommitteeIndex,
    };

    const signingRoot = computeSigningRoot(ssz.altair.SyncAggregatorSelectionData, signingData, domain);

    return await this.getSignature(pubkey, signingRoot);
  }

  async signVoluntaryExit(
    pubkey: BLSPubkeyMaybeHex,
    validatorIndex: number,
    exitEpoch: Epoch
  ): Promise<phase0.SignedVoluntaryExit> {
    const domain = this.config.getDomain(computeStartSlotAtEpoch(exitEpoch), DOMAIN_VOLUNTARY_EXIT);

    const voluntaryExit: phase0.VoluntaryExit = {epoch: exitEpoch, validatorIndex};
    const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit, domain);

    return {
      message: voluntaryExit,
      signature: await this.getSignature(pubkey, signingRoot),
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

    const timestamp = Math.floor(Date.now() / 1000);
    const validatorRegistation: bellatrix.ValidatorRegistrationV1 = {
      feeRecipient,
      gasLimit,
      timestamp,
      pubkey,
    };
    const domain = computeDomain(DOMAIN_APPLICATION_BUILDER, this.config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.bellatrix.ValidatorRegistrationV1, validatorRegistation, domain);
    return {
      message: validatorRegistation,
      signature: await this.getSignature(pubkey, signingRoot),
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

  private async getSignature(pubkey: BLSPubkeyMaybeHex, signingRoot: Uint8Array): Promise<BLSSignature> {
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
          const signatureHex = await externalSignerPostSignature(signer.url, pubkeyHex, toHexString(signingRoot));
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
      return signer.pubkey;
  }
}
