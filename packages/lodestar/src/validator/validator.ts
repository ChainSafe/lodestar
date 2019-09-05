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
 * 6. Repeat step 5
 */
import BlockProposingService from "./services/block";
import {Epoch, Slot, ValidatorIndex} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {GenesisInfo} from "./types";
import {RpcClient, RpcClientOverWs} from "./rpc";
import {AttestationService} from "./services/attestation";
import {IValidatorDB, LevelDbController, ValidatorDB} from "../db";
import {ILogger} from "../logger";
import defaultValidatorOptions, {IValidatorOptions} from "./options";
import deepmerge from "deepmerge";
import {getKeyFromFileOrKeystore} from "../util/io";
import {isPlainObject} from "../util/objects";
import {computeEpochOfSlot} from "../chain/stateTransition/util";
import { ApiClientOverRest } from "./rest/apiClient";

/**
 * Main class for the Validator client.
 */
class Validator {
  private opts: IValidatorOptions;
  private config: IBeaconConfig;
  private apiClient: RpcClient;
  private blockService: BlockProposingService;
  private attestationService: AttestationService;
  private genesisInfo: GenesisInfo;
  private db: IValidatorDB;
  private logger: ILogger;
  private isActive: boolean;
  private isRunning: boolean;

  public constructor(opts: Partial<IValidatorOptions>, modules: {config: IBeaconConfig; logger: ILogger}) {
    this.opts = deepmerge(defaultValidatorOptions, opts, {isMergeableObject: isPlainObject});
    this.config = modules.config;
    this.logger = modules.logger.child(this.opts.logger);
    this.isActive = false;
    this.isRunning = false;
    this.db = new ValidatorDB({
      config: this.config,
      controller: new LevelDbController({
        name: this.opts.db.name
      }, {
        logger: this.logger
      })
    });
    this.initApiClient();
  }

  private initApiClient(): void {
    if(this.opts.rpcInstance) {
      this.apiClient = this.opts.rpcInstance;
    } else if(this.opts.rpc) {
      this.apiClient = new RpcClientOverWs({rpcUrl: this.opts.rpc}, {config: this.config});
    } else if(this.opts.restUrl) {
      this.apiClient = new ApiClientOverRest(this.opts.restUrl, this.logger);
    } else {
      throw new Error("Validator requires either RpcClient instance or rpc url as params");
    }
  }

  /**
   * Creates a new block processing service and starts it.
   */
  public async start(): Promise<void> {
    this.isRunning = true;
    await this.setup();
    this.run();
  }

  /**
   * Stops all validator functions
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    await this.apiClient.disconnect();
  }

  private async setup(): Promise<void> {
    this.logger.info("Setting up validator client...");
    if(this.opts.keystore) {
      this.opts.keypair = await getKeyFromFileOrKeystore(this.opts.keystore);
    } else if(!this.opts.keypair) {
      throw new Error("Missing validator keypair");
    }

    await this.setupRPC();

    // Wait for the ChainStart log and grab validator index
    this.isActive = await this.isChainLive();

    this.blockService = new BlockProposingService(
      this.config,
      this.opts.keypair,
      this.apiClient,
      this.db,
      this.logger
    );

    this.attestationService = new AttestationService(
      this.config,
      this.opts.keypair,
      this.apiClient,
      this.db,
      this.logger
    );
  }

  /**
   * Establishes a connection to a specified beacon chain url.
   */
  private async setupRPC(): Promise<void> {
    this.logger.info("Setting up RPC connection...");
    await this.apiClient.connect();
    this.logger.info(`RPC connection successfully established: ${this.opts.rpc || 'inmemory'}!`);
  }

  /**
   * Recursively checks for the chain start log event from the ETH1.x deposit contract
   */
  private async isChainLive(): Promise<boolean> {
    this.logger.info("Checking if chain has started...");
    const genesisTime =  await this.apiClient.beacon.getGenesisTime();
    if (genesisTime) {
      this.genesisInfo = {
        startTime: genesisTime,
      };
      this.logger.info("Chain start has occured!");
      return true;
    }
    if(this.isRunning) {
      setTimeout(this.isChainLive, 1000);
    }
  }

  private run(): void {
    this.apiClient.onNewSlot(this.checkDuties);
    this.apiClient.onNewEpoch(this.lookAhead);
  };

  private async checkDuties(slot: Slot): Promise<void> {
    const validatorDuty =
      (await this.apiClient.validator.getDuties(
        [this.opts.keypair.publicKey.toBytesCompressed()],
        computeEpochOfSlot(this.config, slot))
      )[0];
    const currentVersion = await this.apiClient.beacon.getFork();
    const isAttester = validatorDuty.attestationSlot === slot;
    const isProposer = validatorDuty.blockProposalSlot === slot;
    this.logger.info(
      `[Validator] Slot: ${slot}, Fork: ${currentVersion}, 
      isProposer: ${isProposer}, isAttester: ${isAttester}`
    );
    if (isAttester) {
      this.attestationService.createAndPublishAttestation(
        slot,
        validatorDuty.attestationShard,
        currentVersion
      );
    }
    if (isProposer) {
      this.blockService.createAndPublishBlock(slot, currentVersion);
    }
  }

  private async lookAhead(currentEpoch: Epoch): Promise<void> {
    //in phase 1, it should obtain duties for next epoch and trigger required shard sync
  }
}

export default Validator;
