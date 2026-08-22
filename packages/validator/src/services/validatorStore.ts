import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {BuilderConfigData, BuilderEntryConfig} from "@lodestar/api/keymanager";
import {BeaconConfig} from "@lodestar/config";
import {
  DOMAIN_AGGREGATE_AND_PROOF,
  DOMAIN_APPLICATION_BUILDER,
  DOMAIN_BEACON_ATTESTER,
  DOMAIN_BEACON_BUILDER,
  DOMAIN_BEACON_PROPOSER,
  DOMAIN_CONTRIBUTION_AND_PROOF,
  DOMAIN_PROPOSER_PREFERENCES,
  DOMAIN_PTC_ATTESTER,
  DOMAIN_RANDAO,
  DOMAIN_REQUEST_AUTH,
  DOMAIN_SELECTION_PROOF,
  DOMAIN_SYNC_COMMITTEE,
  DOMAIN_SYNC_COMMITTEE_SELECTION_PROOF,
  ForkSeq,
  MAX_DATA_SIZE,
} from "@lodestar/params";
import {
  ZERO_HASH,
  blindedOrFullBlockHashTreeRoot,
  computeDomain,
  computeEpochAtSlot,
  computeSigningRoot,
  computeStartSlotAtEpoch,
} from "@lodestar/state-transition";
import {
  AggregateAndProof,
  Attestation,
  BLSPubkey,
  BLSSignature,
  BeaconBlock,
  BlindedBeaconBlock,
  Epoch,
  Root,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SignedBlindedBeaconBlock,
  SingleAttestation,
  Slot,
  ValidatorIndex,
  altair,
  bellatrix,
  gloas,
  phase0,
  ssz,
} from "@lodestar/types";
import {fromHex, toHex, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {Metrics} from "../metrics.js";
import {ISlashingProtection} from "../slashingProtection/index.js";
import {PubkeyHex} from "../types.js";
import {SignableMessage, SignableMessageType, externalSignerPostSignature} from "../util/externalSignerClient.js";
import {isValidatePubkeyHex} from "../util/format.js";
import {LoggerVc} from "../util/logger.js";
import {DoppelgangerService} from "./doppelgangerService.js";
import {IndicesService} from "./indices.js";

type BLSPubkeyMaybeHex = BLSPubkey | PubkeyHex;
type ExecutionAddress = string;

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
  graffiti?: string;
  strictFeeRecipientCheck: boolean;
  feeRecipient: ExecutionAddress;
  builder: {
    // Left undefined when not configured so the fork-appropriate default can be resolved per slot
    gasLimit?: number;
    selection?: routes.validator.BuilderSelection;
    boostFactor: bigint;
    minBid: bigint;
    maxExecutionPayment: bigint;
    builders?: BuilderEntryConfig[];
  };
};

export type ProposerConfig = {
  graffiti?: string;
  strictFeeRecipientCheck?: boolean;
  feeRecipient?: ExecutionAddress;
  builder?: {
    gasLimit?: number;
    selection?: routes.validator.BuilderSelection;
    boostFactor?: bigint;
    minBid?: bigint;
    maxExecutionPayment?: bigint;
    /** Per-key builder entries, replacing the validator client's builders */
    builders?: BuilderEntryConfig[];
  };
};

/** A builder entry with every omitted value resolved against the key and validator client defaults */
export type ResolvedBuilderEntry = {
  url: string;
  authData: Uint8Array;
  builderPubkeys: Uint8Array[];
  maxExecutionPayment: bigint;
  minBid: bigint;
  builderBoostFactor: bigint;
};

export type ValidatorProposerConfig = {
  proposerConfig: {[index: PubkeyHex]: ProposerConfig};
  defaultConfig: ProposerConfig;
};

export type ValidatorStoreModules = {
  config: BeaconConfig;
  slashingProtection: ISlashingProtection;
  indicesService: IndicesService;
  doppelgangerService: DoppelgangerService | null;
  metrics: Metrics | null;
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
  /** Pre-signed request auths keyed by proposal slot and auth data, pruned by proposal slot */
  requestAuths?: Map<string, gloas.SignedRequestAuth>;
};

export const defaultOptions = {
  suggestedFeeRecipient: "0x0000000000000000000000000000000000000000",
  defaultGasLimit: 60_000_000,
  builderSelection: routes.validator.BuilderSelection.ExecutionOnly,
  builderAliasSelection: routes.validator.BuilderSelection.Default,
  builderBoostFactor: 100n,
  builderMinBid: 0n,
  // Only trustless payments via the builder's staked collateral are accepted by default
  builderMaxExecutionPayment: 0n,
  // spec asks for gossip validation by default
  broadcastValidation: routes.beacon.BroadcastValidation.gossip,
  // should request fetching the locally produced block in blinded format
  blindedLocal: false,
};

export const MAX_BUILDER_BOOST_FACTOR = 2n ** 64n - 1n;

/**
 * Service that sets up and handles validator attester duties.
 */
export class ValidatorStore {
  private readonly config: BeaconConfig;
  private readonly slashingProtection: ISlashingProtection;
  private readonly indicesService: IndicesService;
  private readonly doppelgangerService: DoppelgangerService | null;
  private readonly metrics: Metrics | null;

  private readonly validators = new Map<PubkeyHex, ValidatorData>();
  /** Initially true because there are no validators */
  private pubkeysToDiscover: PubkeyHex[] = [];
  private readonly defaultProposerConfig: DefaultProposerConfig;

  constructor(modules: ValidatorStoreModules, valProposerConfig: ValidatorProposerConfig) {
    const {config, slashingProtection, indicesService, doppelgangerService, metrics} = modules;
    this.config = config;
    this.slashingProtection = slashingProtection;
    this.indicesService = indicesService;
    this.doppelgangerService = doppelgangerService;
    this.metrics = metrics;

    const defaultConfig = valProposerConfig.defaultConfig;
    const builderBoostFactor = defaultConfig.builder?.boostFactor ?? defaultOptions.builderBoostFactor;
    if (builderBoostFactor > MAX_BUILDER_BOOST_FACTOR) {
      throw Error(`Invalid builderBoostFactor=${builderBoostFactor} > MAX_BUILDER_BOOST_FACTOR for defaultConfig`);
    }

    this.defaultProposerConfig = {
      graffiti: defaultConfig.graffiti,
      strictFeeRecipientCheck: defaultConfig.strictFeeRecipientCheck ?? false,
      feeRecipient: defaultConfig.feeRecipient ?? defaultOptions.suggestedFeeRecipient,
      builder: {
        gasLimit: defaultConfig.builder?.gasLimit,
        selection: defaultConfig.builder?.selection,
        boostFactor: builderBoostFactor,
        minBid: defaultConfig.builder?.minBid ?? defaultOptions.builderMinBid,
        maxExecutionPayment: defaultConfig.builder?.maxExecutionPayment ?? defaultOptions.builderMaxExecutionPayment,
        builders: defaultConfig.builder?.builders,
      },
    };

    if (metrics) {
      metrics.signers.addCollect(() => metrics.signers.set(this.validators.size));
    }
  }

  /**
   * Create a validator store with initial signers
   */
  static async init(
    modules: ValidatorStoreModules,
    initialSigners: Signer[],
    valProposerConfig: ValidatorProposerConfig = {defaultConfig: {}, proposerConfig: {}}
  ): Promise<ValidatorStore> {
    const validatorStore = new ValidatorStore(modules, valProposerConfig);

    await Promise.all(initialSigners.map((signer) => validatorStore.addSigner(signer, valProposerConfig)));

    return validatorStore;
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

  getFeeRecipient(pubkeyHex: PubkeyHex): ExecutionAddress {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    return validatorData.feeRecipient ?? this.defaultProposerConfig.feeRecipient;
  }

  getFeeRecipientByIndex(index: ValidatorIndex): ExecutionAddress {
    const pubkey = this.indicesService.index2pubkey.get(index);
    return pubkey ? this.getFeeRecipient(pubkey) : this.defaultProposerConfig.feeRecipient;
  }

  setFeeRecipient(pubkeyHex: PubkeyHex, feeRecipient: ExecutionAddress): void {
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
    delete validatorData.feeRecipient;
  }

  getGraffiti(pubkeyHex: PubkeyHex): string | undefined {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    return validatorData.graffiti ?? this.defaultProposerConfig.graffiti;
  }

  setGraffiti(pubkeyHex: PubkeyHex, graffiti: string): void {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    validatorData.graffiti = graffiti;
  }

  deleteGraffiti(pubkeyHex: PubkeyHex): void {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    delete validatorData.graffiti;
  }

  getBuilderSelectionParams(
    pubkeyHex: PubkeyHex,
    slot?: Slot
  ): {selection: routes.validator.BuilderSelection; boostFactor: bigint} {
    // Builder bids post-gloas are in-protocol, so the default strategy uses them regardless of
    // whether they are received over p2p or through a builder API. Pre-gloas there is no
    // in-protocol builder, so the default remains local-only (executiononly).
    const isPostGloas = slot !== undefined && this.config.getForkSeq(slot) >= ForkSeq.gloas;
    return this.resolveBuilderSelectionParams(pubkeyHex, isPostGloas);
  }

  private resolveBuilderSelectionParams(
    pubkeyHex: PubkeyHex,
    isPostGloas: boolean
  ): {selection: routes.validator.BuilderSelection; boostFactor: bigint} {
    const validatorBuilder = this.validators.get(pubkeyHex)?.builder;
    const defaultSelection = isPostGloas ? defaultOptions.builderAliasSelection : defaultOptions.builderSelection;
    let selection = validatorBuilder?.selection ?? this.defaultProposerConfig.builder.selection ?? defaultSelection;

    // The standard per-key builder config directly controls the post-Gloas boost. It takes
    // precedence over Lodestar's legacy selection aliases when explicitly configured.
    if (isPostGloas && validatorBuilder?.boostFactor !== undefined) {
      return {selection: routes.validator.BuilderSelection.MaxProfit, boostFactor: validatorBuilder.boostFactor};
    }

    // Post-Gloas block production uses standard builder boost factor. Need to normalize the
    // gloas-deprecated "builderonly" and "executiononly" to the gloas fallback "builderalways"
    // and "executionalways" equivalent before deriving the boost factor.
    if (isPostGloas) {
      if (selection === routes.validator.BuilderSelection.BuilderOnly) {
        selection = routes.validator.BuilderSelection.BuilderAlways;
      } else if (selection === routes.validator.BuilderSelection.ExecutionOnly) {
        selection = routes.validator.BuilderSelection.ExecutionAlways;
      }
    }

    let boostFactor: bigint;
    switch (selection) {
      case routes.validator.BuilderSelection.Default:
        // Default value slightly favors local block to improve censorship resistance of Ethereum
        // The people have spoken and so it shall be https://x.com/lodestar_eth/status/1772679499928191044
        boostFactor = BigInt(90);
        break;

      case routes.validator.BuilderSelection.MaxProfit:
        boostFactor = validatorBuilder?.boostFactor ?? this.defaultProposerConfig.builder.boostFactor;
        break;

      case routes.validator.BuilderSelection.BuilderAlways:
      case routes.validator.BuilderSelection.BuilderOnly:
        boostFactor = MAX_BUILDER_BOOST_FACTOR;
        break;

      case routes.validator.BuilderSelection.ExecutionAlways:
      case routes.validator.BuilderSelection.ExecutionOnly:
        boostFactor = BigInt(0);
    }

    return {selection, boostFactor};
  }

  strictFeeRecipientCheck(pubkeyHex: PubkeyHex): boolean {
    return (
      this.validators.get(pubkeyHex)?.strictFeeRecipientCheck ?? this.defaultProposerConfig?.strictFeeRecipientCheck
    );
  }

  getConfiguredDefaultGasLimit(): number | undefined {
    return this.defaultProposerConfig.builder.gasLimit;
  }

  getGasLimit(pubkeyHex: PubkeyHex, slot: Slot, logger?: LoggerVc): number {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }

    const configuredGasLimit = validatorData.builder?.gasLimit ?? this.defaultProposerConfig.builder.gasLimit;
    const scheduledGasLimit = this.config.getScheduledGasLimit(computeEpochAtSlot(slot));

    if (configuredGasLimit !== undefined) {
      if (scheduledGasLimit !== undefined && configuredGasLimit > scheduledGasLimit) {
        logger?.warn("Configured gas limit exceeds recommended maximum", {
          pubkey: pubkeyHex,
          slot,
          configuredGasLimit,
          recommendedGasLimit: scheduledGasLimit,
        });
      }

      return configuredGasLimit;
    }

    return scheduledGasLimit ?? defaultOptions.defaultGasLimit;
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

  getBuilderBoostFactor(pubkeyHex: PubkeyHex): bigint {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    return validatorData?.builder?.boostFactor ?? this.defaultProposerConfig.builder.boostFactor;
  }

  setBuilderBoostFactor(pubkeyHex: PubkeyHex, boostFactor: bigint): void {
    if (boostFactor > MAX_BUILDER_BOOST_FACTOR) {
      throw Error(`Invalid builderBoostFactor=${boostFactor} > MAX_BUILDER_BOOST_FACTOR`);
    }

    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    validatorData.builder = {...validatorData.builder, boostFactor};
  }

  deleteBuilderBoostFactor(pubkeyHex: PubkeyHex): void {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    delete validatorData.builder?.boostFactor;
  }

  getBuilderMinBid(pubkeyHex: PubkeyHex): bigint {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    return validatorData?.builder?.minBid ?? this.defaultProposerConfig.builder.minBid;
  }

  getBuilderMaxExecutionPayment(pubkeyHex: PubkeyHex): bigint {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    return validatorData?.builder?.maxExecutionPayment ?? this.defaultProposerConfig.builder.maxExecutionPayment;
  }

  /**
   * Resolve the builder entries for this key. Per-key entries replace the validator client's
   * builders, an omitted entry value takes this key's default and then the validator client's
   * own configuration. An omitted auth data is derived from the entry url.
   */
  getResolvedBuilderEntries(pubkeyHex: PubkeyHex, boostFactor?: bigint): ResolvedBuilderEntry[] {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }

    const keyMinBid = validatorData.builder?.minBid ?? this.defaultProposerConfig.builder.minBid;
    const keyBoostFactor =
      boostFactor ?? validatorData.builder?.boostFactor ?? this.defaultProposerConfig.builder.boostFactor;
    const keyMaxExecutionPayment =
      validatorData.builder?.maxExecutionPayment ?? this.defaultProposerConfig.builder.maxExecutionPayment;

    // The key's defaults apply to the validator client's own builders all the same
    const builders = validatorData.builder?.builders ?? this.defaultProposerConfig.builder.builders ?? [];
    return builders.map((entry) => ({
      url: entry.url,
      authData: entry.authData !== undefined ? fromHex(entry.authData) : new Uint8Array(Buffer.from(entry.url)),
      builderPubkeys: (entry.builderPubkeys ?? []).map(fromHex),
      maxExecutionPayment: entry.maxExecutionPayment ?? keyMaxExecutionPayment,
      minBid: entry.minBid ?? keyMinBid,
      builderBoostFactor: entry.builderBoostFactor ?? keyBoostFactor,
    }));
  }

  /** Return the builder configuration in effect for this key, with omitted values resolved */
  getBuilderConfig(pubkeyHex: PubkeyHex): BuilderConfigData {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    const {boostFactor} = this.resolveBuilderSelectionParams(pubkeyHex, true);

    return {
      minBid: validatorData.builder?.minBid ?? this.defaultProposerConfig.builder.minBid,
      builderBoostFactor: boostFactor,
      builders: this.getResolvedBuilderEntries(pubkeyHex, boostFactor).map((entry) => ({
        url: entry.url,
        authData: toHex(entry.authData),
        builderPubkeys: entry.builderPubkeys.map(toPubkeyHex),
        maxExecutionPayment: entry.maxExecutionPayment,
        minBid: entry.minBid,
        builderBoostFactor: entry.builderBoostFactor,
      })),
    };
  }

  /** Set the builder configuration for this key, replacing any stored configuration in full */
  setBuilderConfig(pubkeyHex: PubkeyHex, config: BuilderConfigData): void {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }

    for (const value of [config.minBid, config.builderBoostFactor]) {
      if (value !== undefined && value > MAX_BUILDER_BOOST_FACTOR) {
        throw Error(`Invalid builder config value=${value} exceeds uint64`);
      }
    }

    // No two entries may share both their url and their auth data, an omitted auth data is
    // compared as the value derived from the entry url
    const seenEntries = new Set<string>();
    for (const entry of config.builders ?? []) {
      try {
        new URL(entry.url);
      } catch {
        throw Error(`Invalid builder url: ${entry.url}`);
      }
      const authData = entry.authData !== undefined ? toHex(fromHex(entry.authData)) : toHex(Buffer.from(entry.url));
      const entryKey = `${entry.url}|${authData}`;
      if (seenEntries.has(entryKey)) {
        throw Error(`Duplicate builder entry url=${entry.url}`);
      }
      seenEntries.add(entryKey);
      for (const value of [entry.maxExecutionPayment, entry.minBid, entry.builderBoostFactor]) {
        if (value !== undefined && value > MAX_BUILDER_BOOST_FACTOR) {
          throw Error(`Invalid builder entry value=${value} exceeds uint64`);
        }
      }
    }

    validatorData.builder = {
      ...validatorData.builder,
      minBid: config.minBid,
      boostFactor: config.builderBoostFactor,
      builders: config.builders,
    };
  }

  /** Remove the builder configuration for this key, it then follows the validator client again */
  deleteBuilderConfig(pubkeyHex: PubkeyHex): void {
    const validatorData = this.validators.get(pubkeyHex);
    if (validatorData === undefined) {
      throw Error(`Validator pubkey ${pubkeyHex} not known`);
    }
    delete validatorData.builder?.minBid;
    delete validatorData.builder?.boostFactor;
    delete validatorData.builder?.builders;
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
      builder?.gasLimit !== undefined ||
      builder?.selection !== undefined ||
      builder?.boostFactor !== undefined ||
      builder?.minBid !== undefined ||
      builder?.maxExecutionPayment !== undefined ||
      builder?.builders !== undefined
    ) {
      proposerConfig = {graffiti, strictFeeRecipientCheck, feeRecipient, builder};
    }
    return proposerConfig;
  }

  async addSigner(signer: Signer, valProposerConfig?: ValidatorProposerConfig): Promise<void> {
    const pubkey = getSignerPubkeyHex(signer);
    const proposerConfig = valProposerConfig?.proposerConfig?.[pubkey];
    const builderBoostFactor = proposerConfig?.builder?.boostFactor;
    if (builderBoostFactor !== undefined && builderBoostFactor > MAX_BUILDER_BOOST_FACTOR) {
      throw Error(`Invalid builderBoostFactor=${builderBoostFactor} > MAX_BUILDER_BOOST_FACTOR for pubkey=${pubkey}`);
    }

    if (!this.validators.has(pubkey)) {
      // Doppelganger registration must be done before adding validator to signers
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

  getRemoteSignerPubkeys(signerUrl: string): PubkeyHex[] {
    const pubkeysHex = [];
    for (const {signer} of this.validators.values()) {
      if (signer.type === SignerType.Remote && signer.url === signerUrl) {
        pubkeysHex.push(signer.pubkey);
      }
    }
    return pubkeysHex;
  }

  async signBlock(
    pubkey: BLSPubkey,
    blindedOrFull: BeaconBlock | BlindedBeaconBlock,
    currentSlot: Slot,
    logger?: LoggerVc
  ): Promise<SignedBeaconBlock | SignedBlindedBeaconBlock> {
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

    logger?.debug("Signing the block proposal", {
      slot: signingSlot,
      blockRoot: toRootHex(blockRoot),
      signingRoot: toRootHex(signingRoot),
    });

    try {
      await this.slashingProtection.checkAndInsertBlockProposal(pubkey, {slot: signingSlot, signingRoot});
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
    } as SignedBeaconBlock | SignedBlindedBeaconBlock;
  }

  async signExecutionPayloadEnvelope(
    pubkey: BLSPubkey,
    envelope: gloas.ExecutionPayloadEnvelope,
    currentSlot: Slot,
    logger?: LoggerVc
  ): Promise<gloas.SignedExecutionPayloadEnvelope> {
    // Make sure the envelope slot is not higher than the current slot to avoid potential attacks.
    if (envelope.payload.slotNumber > currentSlot) {
      throw Error(
        `Not signing envelope with slot ${envelope.payload.slotNumber} greater than current slot ${currentSlot}`
      );
    }

    const signingSlot = envelope.payload.slotNumber;
    const domain = this.config.getDomain(signingSlot, DOMAIN_BEACON_BUILDER);
    const signingRoot = computeSigningRoot(ssz.gloas.ExecutionPayloadEnvelope, envelope, domain);

    logger?.debug("Signing execution payload envelope", {
      slot: signingSlot,
      beaconBlockRoot: toRootHex(envelope.beaconBlockRoot),
      signingRoot: toRootHex(signingRoot),
    });

    const signableMessage: SignableMessage = {
      type: SignableMessageType.EXECUTION_PAYLOAD_ENVELOPE,
      data: envelope,
    };

    return {
      message: envelope,
      signature: await this.getSignature(pubkey, signingRoot, signingSlot, signableMessage),
    };
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
  ): Promise<SingleAttestation> {
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

    if (this.config.getForkSeq(signingSlot) >= ForkSeq.electra) {
      return {
        committeeIndex: duty.committeeIndex,
        attesterIndex: duty.validatorIndex,
        data: attestationData,
        signature: await this.getSignature(duty.pubkey, signingRoot, signingSlot, signableMessage),
      };
    }

    return {
      aggregationBits: BitArray.fromSingleBit(duty.committeeLength, duty.validatorCommitteeIndex),
      data: attestationData,
      signature: await this.getSignature(duty.pubkey, signingRoot, signingSlot, signableMessage),
    } as phase0.Attestation;
  }

  async signAggregateAndProof(
    duty: routes.validator.AttesterDuty,
    selectionProof: BLSSignature,
    aggregate: Attestation
  ): Promise<SignedAggregateAndProof> {
    this.validateAttestationDuty(duty, aggregate.data);

    const aggregateAndProof: AggregateAndProof = {
      aggregate,
      aggregatorIndex: duty.validatorIndex,
      selectionProof,
    };

    const signingSlot = aggregate.data.slot;
    const domain = this.config.getDomain(signingSlot, DOMAIN_AGGREGATE_AND_PROOF);
    const isPostElectra = this.config.getForkSeq(signingSlot) >= ForkSeq.electra;
    const signingRoot = computeSigningRoot(
      this.config.getForkTypes(signingSlot).AggregateAndProof,
      aggregateAndProof,
      domain
    );

    const signableMessage: SignableMessage = {
      type: isPostElectra ? SignableMessageType.AGGREGATE_AND_PROOF_V2 : SignableMessageType.AGGREGATE_AND_PROOF,
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

  async signPayloadAttestation(
    duty: routes.validator.PtcDuty,
    data: gloas.PayloadAttestationData,
    currentSlot: Slot,
    logger?: LoggerVc
  ): Promise<gloas.PayloadAttestationMessage> {
    if (data.slot > currentSlot) {
      throw Error(`Not signing payload attestation with slot ${data.slot} greater than current slot ${currentSlot}`);
    }

    this.assertDoppelgangerSafe(duty.pubkey);
    this.validatePtcDuty(duty, data);

    const signingSlot = data.slot;
    const domain = this.config.getDomain(signingSlot, DOMAIN_PTC_ATTESTER);
    const signingRoot = computeSigningRoot(ssz.gloas.PayloadAttestationData, data, domain);

    logger?.debug("Signing payload attestation message", {
      slot: signingSlot,
      beaconBlockRoot: toRootHex(data.beaconBlockRoot),
      signingRoot: toRootHex(signingRoot),
    });

    const signableMessage: SignableMessage = {
      type: SignableMessageType.PAYLOAD_ATTESTATION,
      data,
    };

    return {
      validatorIndex: duty.validatorIndex,
      data,
      signature: await this.getSignature(duty.pubkey, signingRoot, signingSlot, signableMessage),
    };
  }

  async signProposerPreferences(
    duty: routes.validator.ProposerDuty,
    dependentRoot: Uint8Array,
    feeRecipient: ExecutionAddress,
    gasLimit: number,
    currentSlot: Slot
  ): Promise<gloas.SignedProposerPreferences> {
    if (duty.slot <= currentSlot) {
      throw Error(`Not signing proposer preferences for past slot ${duty.slot} (current ${currentSlot})`);
    }

    this.assertDoppelgangerSafe(duty.pubkey);

    const message: gloas.ProposerPreferences = {
      dependentRoot,
      proposalSlot: duty.slot,
      validatorIndex: duty.validatorIndex,
      feeRecipient: fromHex(feeRecipient),
      targetGasLimit: BigInt(gasLimit),
    };

    const signingSlot = duty.slot;
    const domain = this.config.getDomain(signingSlot, DOMAIN_PROPOSER_PREFERENCES);
    const signingRoot = computeSigningRoot(ssz.gloas.ProposerPreferences, message, domain);

    const signableMessage: SignableMessage = {
      type: SignableMessageType.PROPOSER_PREFERENCES,
      data: message,
    };

    return {
      message,
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
    regAttributes: {feeRecipient: ExecutionAddress; gasLimit: number},
    _slot: Slot
  ): Promise<bellatrix.SignedValidatorRegistrationV1> {
    const pubkey = typeof pubkeyMaybeHex === "string" ? fromHex(pubkeyMaybeHex) : pubkeyMaybeHex;
    const feeRecipient = fromHex(regAttributes.feeRecipient);
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

  async signRequestAuth(
    pubkeyMaybeHex: BLSPubkeyMaybeHex,
    data: Uint8Array,
    proposalSlot: Slot
  ): Promise<gloas.SignedRequestAuth> {
    if (data.length === 0 || data.length > MAX_DATA_SIZE) {
      throw Error(`Invalid request auth data length=${data.length}, must be within 1 and ${MAX_DATA_SIZE} bytes`);
    }

    const message: gloas.RequestAuth = {data, slot: proposalSlot};

    const signingSlot = 0;
    const domain = computeDomain(DOMAIN_REQUEST_AUTH, this.config.GENESIS_FORK_VERSION, ZERO_HASH);
    const signingRoot = computeSigningRoot(ssz.gloas.RequestAuth, message, domain);

    const signableMessage: SignableMessage = {
      type: SignableMessageType.REQUEST_AUTH,
      data: message,
    };

    return {
      message,
      signature: await this.getSignature(pubkeyMaybeHex, signingRoot, signingSlot, signableMessage),
    };
  }

  /**
   * Return a pre-signed request auth for the auth data and proposal slot, or sign and cache a new
   * one. Signing happens off the block proposal hot path when preferences are submitted ahead of
   * time, cached auths are then used just-in-time when requesting bids at proposal time.
   */
  async getRequestAuth(
    pubkeyMaybeHex: BLSPubkeyMaybeHex,
    data: Uint8Array,
    proposalSlot: Slot,
    currentSlot: Slot
  ): Promise<gloas.SignedRequestAuth> {
    const pubkeyHex = typeof pubkeyMaybeHex === "string" ? pubkeyMaybeHex : toPubkeyHex(pubkeyMaybeHex);
    const authKey = `${proposalSlot}-${toHex(data)}`;
    const validatorData = this.validators.get(pubkeyHex);
    const cached = validatorData?.requestAuths?.get(authKey);
    if (cached !== undefined) {
      return cached;
    }

    const signedRequestAuth = await this.signRequestAuth(pubkeyMaybeHex, data, proposalSlot);

    if (validatorData !== undefined) {
      const requestAuths = validatorData.requestAuths ?? new Map<string, gloas.SignedRequestAuth>();
      // Prune auths for proposal slots that are already in the past
      for (const key of requestAuths.keys()) {
        if (Number(key.slice(0, key.indexOf("-"))) < currentSlot) {
          requestAuths.delete(key);
        }
      }
      requestAuths.set(authKey, signedRequestAuth);
      validatorData.requestAuths = requestAuths;
    }

    return signedRequestAuth;
  }

  async getValidatorRegistration(
    pubkeyMaybeHex: BLSPubkeyMaybeHex,
    regAttributes: {feeRecipient: ExecutionAddress; gasLimit: number},
    slot: Slot
  ): Promise<bellatrix.SignedValidatorRegistrationV1> {
    const pubkeyHex = typeof pubkeyMaybeHex === "string" ? pubkeyMaybeHex : toPubkeyHex(pubkeyMaybeHex);
    const {feeRecipient, gasLimit} = regAttributes;
    const regFullKey = `${feeRecipient}-${gasLimit}`;
    const validatorData = this.validators.get(pubkeyHex);
    const builderData = validatorData?.builderData;
    if (builderData?.regFullKey === regFullKey) {
      return builderData.validatorRegistration;
    }
    const validatorRegistration = await this.signValidatorRegistration(pubkeyMaybeHex, regAttributes, slot);
    // If pubkeyHex was actually registered, then update the regData
    if (validatorData !== undefined) {
      validatorData.builderData = {validatorRegistration, regFullKey};
      this.validators.set(pubkeyHex, validatorData);
    }
    return validatorRegistration;
  }

  private async getSignature(
    pubkey: BLSPubkeyMaybeHex,
    signingRoot: Uint8Array,
    signingSlot: Slot,
    signableMessage: SignableMessage
  ): Promise<BLSSignature> {
    // TODO: Refactor indexing to not have to run toHex() on the pubkey every time
    const pubkeyHex = typeof pubkey === "string" ? pubkey : toPubkeyHex(pubkey);

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
          return fromHex(signatureHex);
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

    const forkSeq = this.config.getForkSeq(data.slot);
    const isPostElectra = forkSeq >= ForkSeq.electra;
    const isPostGloas = forkSeq >= ForkSeq.gloas;

    if (!isPostElectra && duty.committeeIndex !== data.index) {
      throw Error(
        `Inconsistent duties during signing: duty.committeeIndex ${duty.committeeIndex} != att.committeeIndex ${data.index}`
      );
    }
    if (isPostGloas) {
      // After Gloas, data.index signals payload status: 0 (EMPTY) or 1 (FULL)
      if (data.index !== 0 && data.index !== 1) {
        throw Error(`Invalid payload status index post-gloas during signing: data.index=${data.index}`);
      }
    } else if (isPostElectra && data.index !== 0) {
      throw Error(`Non-zero committee index post-electra during signing: att.committeeIndex ${data.index}`);
    }
  }

  private validatePtcDuty(duty: routes.validator.PtcDuty, data: gloas.PayloadAttestationData): void {
    if (duty.slot !== data.slot) {
      throw Error(`Inconsistent PTC duties during signing: duty.slot ${duty.slot} != data.slot ${data.slot}`);
    }
  }

  private assertDoppelgangerSafe(pubKey: PubkeyHex | BLSPubkey): void {
    const pubkeyHex = typeof pubKey === "string" ? pubKey : toPubkeyHex(pubKey);
    if (!this.isDoppelgangerSafe(pubkeyHex)) {
      throw new Error(`Doppelganger state for key ${pubkeyHex} is not safe`);
    }
  }
}

function getSignerPubkeyHex(signer: Signer): PubkeyHex {
  switch (signer.type) {
    case SignerType.Local:
      return toPubkeyHex(signer.secretKey.toPublicKey().toBytes());

    case SignerType.Remote:
      if (!isValidatePubkeyHex(signer.pubkey)) {
        throw Error(`Bad format in RemoteSigner.pubkey ${signer.pubkey}`);
      }
      return signer.pubkey;
  }
}
