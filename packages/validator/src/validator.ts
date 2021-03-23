/**
 * @module validator
 */

// This file makes some naive assumptions surrounding the way RPC like calls will be made in ETH2.0
/**
 * 1. Setup any necessary connections (RPC,...)
 * 2. Check if the chain start log has been emitted
 * 3. Get the validator index
 * 4. Setup block processing and attestation services
 * 5. Wait for role change
 * 6. Execute role
 * 7. Wait for new role
 * 8. Repeat step 5
 */
import BlockProposingService from "./services/block";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IApiClient} from "./api";
import {AttestationService} from "./services/attestation";
import {fromHex, ILogger} from "@chainsafe/lodestar-utils";
import {IValidatorOptions} from "./options";
import {ApiClientOverRest} from "./api/impl/rest/apiClient";
import {ISlashingProtection} from "./slashingProtection";
import {mapSecretKeysToValidators} from "./services/utils";
import {computeSigningRoot, computeDomain} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0} from "@chainsafe/lodestar-types";

/**
 * Main class for the Validator client.
 */
export class Validator {
  private opts: IValidatorOptions;
  private config: IBeaconConfig;
  private apiClient: IApiClient;
  private blockService?: BlockProposingService;
  private attestationService?: AttestationService;
  private slashingProtection: ISlashingProtection;
  private logger: ILogger;

  constructor(opts: IValidatorOptions) {
    this.opts = opts;
    this.config = opts.config;
    this.logger = opts.logger;
    this.slashingProtection = opts.slashingProtection;
    this.apiClient = this.initApiClient(opts.api);
  }

  /**
   * Instantiates block and attestation services and runs them once the chain has been started.
   */
  async start(): Promise<void> {
    await this.setup();
    this.logger.info("Waiting for chain start...");
    this.apiClient.once("beaconChainStarted", this.run);
  }

  /**
   * Start the blockService and attestationService.
   * Should only be called once the beacon chain has been started.
   */
  run = async (): Promise<void> => {
    this.logger.info("Chain has started");
    if (!this.blockService) throw Error("blockService not setup");
    if (!this.attestationService) throw Error("attestationService not setup");
    // Run both services at once to prevent missing first attestation
    await Promise.all([this.blockService.start(), this.attestationService.start()]);
  };

  /**
   * Stops all validator functions.
   */
  async stop(): Promise<void> {
    await this.apiClient.disconnect();
    if (this.attestationService) await this.attestationService.stop();
    if (this.blockService) await this.blockService.stop();
  }

  /**
   * Perform a voluntary exit for the given validator by its key.
   */
  async voluntaryExit(publicKey: string, exitEpoch: number): Promise<void> {
    await this.apiClient.connect();

    const stateValidator = await this.apiClient.beacon.state.getStateValidator(
      "head",
      this.config.types.BLSPubkey.fromJson(publicKey)
    );
    if (!stateValidator) throw new Error("Validator not found in beacon chain.");

    const epoch = exitEpoch || this.apiClient.clock.currentEpoch;

    const voluntaryExit = {
      epoch,
      validatorIndex: stateValidator.index,
    };

    const forkSchedule = await this.apiClient.configApi.getForkSchedule();
    const fork = forkSchedule[0] || (await this.apiClient.beacon.state.getFork("head"));
    if (!fork) throw new Error("VoluntaryExit: Fork not found");
    const genesisValidatorsRoot = (await this.apiClient.beacon.getGenesis())?.genesisValidatorsRoot;
    const domain = computeDomain(
      this.config,
      this.config.params.DOMAIN_VOLUNTARY_EXIT,
      fork.currentVersion,
      genesisValidatorsRoot
    );
    const signingRoot = computeSigningRoot(this.config, this.config.types.phase0.VoluntaryExit, voluntaryExit, domain);

    let secretKey;
    for (const sk of this.opts.secretKeys) {
      if (this.config.types.BLSPubkey.equals(sk.toPublicKey().toBytes(), fromHex(publicKey))) secretKey = sk;
    }
    if (!secretKey) throw new Error(`No matching secret key found for public key ${publicKey}`);

    const signedVoluntaryExit: phase0.SignedVoluntaryExit = {
      message: voluntaryExit,
      signature: secretKey.sign(signingRoot).toBytes(),
    };

    try {
      await this.apiClient.beacon.pool.submitVoluntaryExit(signedVoluntaryExit);
      this.logger.info(`Submitted voluntary exit for ${publicKey} to the network`);
    } finally {
      await this.apiClient.disconnect();
    }
  }

  /**
   * Create and return a new rest API client.
   */
  private initApiClient(api: string | IApiClient): IApiClient {
    if (typeof api === "string") {
      return new ApiClientOverRest(this.config, api, this.logger);
    }
    return api;
  }

  /**
   * Creates a new block processing service and attestation service.
   */
  private async setup(): Promise<void> {
    await this.setupAPI();
    const validators = mapSecretKeysToValidators(this.opts.secretKeys);

    this.blockService = new BlockProposingService(
      this.config,
      validators,
      this.apiClient,
      this.slashingProtection,
      this.logger,
      this.opts.graffiti
    );

    this.attestationService = new AttestationService(
      this.config,
      validators,
      this.apiClient,
      this.slashingProtection,
      this.logger
    );
  }

  /**
   * Establishes a connection to a specified beacon chain url.
   */
  private async setupAPI(): Promise<void> {
    await this.apiClient.connect();
    this.logger.info("RPC connection successfully established", {url: this.apiClient.url});
  }
}
