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
  ExecutionAddress,
} from "@lodestar/types";
import {BitArray, fromHexString, toHexString} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {ISlashingProtection} from "../slashingProtection/index.js";
import {PubkeyHex} from "../types.js";
import {externalSignerPostSignature, Web3SignerForkInfo, SignableMessage} from "../util/externalSignerClient.js";
import {Metrics} from "../metrics.js";
import {IndicesService} from "./indices.js";
import {DoppelgangerService} from "./doppelgangerService.js";

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

type BLSPubkeyMaybeHex = BLSPubkey | PubkeyHex;
type Eth1Address = string;

/**
 * Validator entity capable of producing signatures. Either:
 * - local: With BLS secret key
 * - remote: With data to contact a remote signer
 */
export type Signer = SignerLocal | SignerRemote;

type ValidatorData = {
  signer: Signer;
  /** feeRecipient for block production, null if not explicitly configured */
  feeRecipient: Eth1Address | null;
};

/**
 * Service that sets up and handles validator attester duties.
 */
export class ValidatorStore {
  private readonly validators = new Map<PubkeyHex, ValidatorData>();
  /** Initially true because there are no validators */
  private pubkeysToDiscover: PubkeyHex[] = [];

  constructor(
    private readonly config: IBeaconConfig,
    private readonly slashingProtection: ISlashingProtection,
    private readonly indicesService: IndicesService,
    private readonly doppelgangerService: DoppelgangerService | null,
    private readonly metrics: Metrics | null,
    initialSigners: Signer[],
    private readonly suggestedFeeRecipient: string,
    private readonly gasLimit: number,
    private readonly genesisValidatorRoot: Root
  ) {
    for (const signer of initialSigners) {
      this.addSigner(signer);
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

  getFeeRecipient(pubkeyHex: PubkeyHex): string {
    return this.validators.get(pubkeyHex)?.feeRecipient ?? this.suggestedFeeRecipient;
  }

  getFeeRecipientByIndex(index: ValidatorIndex): string {
    const pubkey = this.indicesService.index2pubkey.get(index);
    return (pubkey && this.validators.get(pubkey)?.feeRecipient) ?? this.suggestedFeeRecipient;
  }

  /** Return true if `index` is active part of this validator client */
  hasValidatorIndex(index: ValidatorIndex): boolean {
    return this.indicesService.index2pubkey.has(index);
  }

  addSigner(signer: Signer): void {
    const pubkey = getSignerPubkeyHex(signer);

    if (!this.validators.has(pubkey)) {
      this.pubkeysToDiscover.push(pubkey);
      this.validators.set(pubkey, {
        signer,
        // TODO: Allow to customize
        feeRecipient: null,
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

    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(pubkey);
    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "BLOCK_V2",
          data: {
            version: this.config.getForkInfo(blindedOrFull.slot).name,
            block: blindedOrFull,
          },
        },
        forkInfo: this.getForkInfo(currentSlot),
        pubkeyHex,
      };
    }

    return {
      message: blindedOrFull,
      signature: await this.getSignature(signer, signingRoot, signableMessage),
    } as allForks.FullOrBlindedSignedBeaconBlock;
  }

  async signRandao(pubkey: BLSPubkey, slot: Slot): Promise<BLSSignature> {
    const epoch = computeEpochAtSlot(slot);
    const randaoDomain = this.config.getDomain(slot, DOMAIN_RANDAO);
    const randaoSigningRoot = computeSigningRoot(ssz.Epoch, epoch, randaoDomain);

    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(pubkey);
    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "RANDAO_REVEAL",
          data: {
            epoch,
          },
        },
        forkInfo: this.getForkInfo(slot),
        pubkeyHex,
      };
    }

    return await this.getSignature(signer, randaoSigningRoot, signableMessage);
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

    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(duty.pubkey);
    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "ATTESTATION",
          data: attestationData,
        },
        forkInfo: this.getForkInfo(attestationData.slot),
        pubkeyHex,
      };
    }

    return {
      aggregationBits: BitArray.fromSingleBit(duty.committeeLength, duty.validatorCommitteeIndex),
      data: attestationData,
      signature: await this.getSignature(signer, signingRoot, signableMessage),
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
    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(duty.pubkey);
    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "AGGREGATE_AND_PROOF",
          data: aggregateAndProof,
        },
        forkInfo: this.getForkInfo(aggregateAndProof.aggregate.data.slot),
        pubkeyHex,
      };
    }

    return {
      message: aggregateAndProof,
      signature: await this.getSignature(signer, signingRoot, signableMessage),
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
    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(pubkey);

    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "SYNC_COMMITTEE_MESSAGE",
          data: {
            beaconBlockRoot,
            slot,
          },
        },
        forkInfo: this.getForkInfo(slot),
        pubkeyHex,
      };
    }

    return {
      slot,
      validatorIndex,
      beaconBlockRoot,
      signature: await this.getSignature(signer, signingRoot, signableMessage),
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
    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(duty.pubkey);
    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "SYNC_COMMITTEE_CONTRIBUTION_AND_PROOF",
          data: contributionAndProof,
        },
        forkInfo: this.getForkInfo(contributionAndProof.contribution.slot),
        pubkeyHex,
      };
    }

    return {
      message: contributionAndProof,
      signature: await this.getSignature(signer, signingRoot, signableMessage),
    };
  }

  async signAttestationSelectionProof(pubkey: BLSPubkeyMaybeHex, slot: Slot): Promise<BLSSignature> {
    const domain = this.config.getDomain(slot, DOMAIN_SELECTION_PROOF);
    const signingRoot = computeSigningRoot(ssz.Slot, slot, domain);

    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(pubkey);
    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "AGGREGATION_SLOT",
          data: {
            slot: String(slot),
          },
        },
        forkInfo: this.getForkInfo(slot),
        pubkeyHex,
      };
    }

    return await this.getSignature(signer, signingRoot, signableMessage);
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

    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(pubkey);
    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "SYNC_COMMITTEE_SELECTION_PROOF",
          data: {
            slot,
            subcommitteeIndex: String(subcommitteeIndex),
          },
        },
        forkInfo: this.getForkInfo(slot),
        pubkeyHex,
      };
    }

    return await this.getSignature(signer, signingRoot, signableMessage);
  }

  async signVoluntaryExit(
    pubkey: BLSPubkeyMaybeHex,
    validatorIndex: number,
    exitEpoch: Epoch
  ): Promise<phase0.SignedVoluntaryExit> {
    const domain = this.config.getDomain(computeStartSlotAtEpoch(exitEpoch), DOMAIN_VOLUNTARY_EXIT);

    const voluntaryExit: phase0.VoluntaryExit = {epoch: exitEpoch, validatorIndex};
    const signingRoot = computeSigningRoot(ssz.phase0.VoluntaryExit, voluntaryExit, domain);
    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(pubkey);

    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "VOLUNTARY_EXIT",
          data: voluntaryExit,
        },
        pubkeyHex,
      };
    }

    return {
      message: voluntaryExit,
      signature: await this.getSignature(signer, signingRoot, signableMessage),
    };
  }

  isDoppelgangerSafe(pubkeyHex: PubkeyHex): boolean {
    // If doppelganger is not enabled we assumed all keys to be safe for use
    return !this.doppelgangerService || this.doppelgangerService.isDoppelgangerSafe(pubkeyHex);
  }

  async signValidatorRegistration(
    pubkey: BLSPubkey,
    feeRecipient: ExecutionAddress,
    _slot: Slot
  ): Promise<bellatrix.SignedValidatorRegistrationV1> {
    const gasLimit = this.gasLimit;
    const timestamp = Math.floor(Date.now() / 1000);
    const validatorRegistation: bellatrix.ValidatorRegistrationV1 = {
      feeRecipient,
      gasLimit,
      timestamp,
      pubkey,
    };
    const domain = computeDomain(DOMAIN_APPLICATION_BUILDER, this.config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.bellatrix.ValidatorRegistrationV1, validatorRegistation, domain);
    const [signer, pubkeyHex] = this.getSignerAndPubkeyHex(pubkey);

    let signableMessage: SignableMessage | undefined;

    if (signer.type === SignerType.Remote) {
      signableMessage = {
        singablePayload: {
          type: "VALIDATOR_REGISTRATION",
          data: validatorRegistation,
        },
        pubkeyHex,
      };
    }

    return {
      message: validatorRegistation,
      signature: await this.getSignature(signer, signingRoot, signableMessage),
    };
  }

  private async getSignature(
    signer: Signer,
    signingRoot: Uint8Array,
    signableMessage?: SignableMessage
  ): Promise<BLSSignature> {
    switch (signer.type) {
      case SignerType.Local: {
        const timer = this.metrics?.localSignTime.startTimer();
        const signature = signer.secretKey.sign(signingRoot).toBytes();
        timer?.();
        return signature;
      }
      case SignerType.Remote: {
        if (signableMessage === undefined) {
          throw new Error("Remote signer needs signable message");
        }
        const timer = this.metrics?.remoteSignTime.startTimer();
        try {
          const signatureHex = await externalSignerPostSignature(signer.url, toHexString(signingRoot), signableMessage);
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

  private getForkInfo(slot: Slot): Web3SignerForkInfo {
    const forkInfo = this.config.getForkInfo(slot);
    return {
      fork: {
        previousVersion: forkInfo.prevVersion,
        currentVersion: forkInfo.version,
        epoch: forkInfo.epoch,
      },
      genesisValidatorRoot: this.genesisValidatorRoot,
    };
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
