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
import {Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IRpcClient, RpcClientOverWs} from "./rpc";
import {AttestationService} from "./services/attestation";
import {IValidatorDB, LevelDbController, ValidatorDB} from "../db";
import {ILogger} from "../logger";
import defaultValidatorOptions, {IValidatorOptions} from "./options";
import deepmerge from "deepmerge";
import {getKeyFromFileOrKeystore} from "../util/io";
import {isPlainObject} from "../util/objects";
import {computeEpochOfSlot} from "../chain/stateTransition/util";
import {ApiClientOverRest} from "./rest/apiClient";

/**
 * Main class for the Validator client.
 */
class Validator {
  private opts: IValidatorOptions;
  private config: IBeaconConfig;
  // @ts-ignore
  private apiClient: IRpcClient;
  // @ts-ignore
  private blockService: BlockProposingService;
  // @ts-ignore
  private attestationService: AttestationService;
  private db: IValidatorDB;
  private logger: ILogger;
  private isRunning: boolean;

  public constructor(opts: Partial<IValidatorOptions>, modules: {config: IBeaconConfig; logger: ILogger}) {
    this.opts = deepmerge(defaultValidatorOptions, opts, {isMergeableObject: isPlainObject});
    this.config = modules.config;
    this.logger = modules.logger.child(this.opts.logger);
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

  /**
   * Creates a new block processing service and starts it.
   */
  public async start(): Promise<void> {
    this.isRunning = true;
    await this.setup();
    this.logger.info("Checking if chain has started...");
    this.apiClient.waitForChainLived();
    this.apiClient.once("chainLived", this.run.bind(this));
  }

  public run(): void {
    this.logger.info("Chain start has occured!");
    this.apiClient.onNewSlot(this.checkDuties);
    // this.apiClient.onNewEpoch(this.lookAhead);
  }

  /**
   * Stops all validator functions
   */
  public async stop(): Promise<void> {
    this.isRunning = false;
    await this.apiClient.disconnect();

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

  private async setup(): Promise<void> {
    this.logger.info("Setting up validator client...");
    if(this.opts.keystore) {
      this.opts.keypair = await getKeyFromFileOrKeystore(this.opts.keystore);
    } else if(!this.opts.keypair) {
      throw new Error("Missing validator keypair");
    }

    await this.setupRPC();

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
    this.logger.info(`RPC connection successfully established: ${this.apiClient.url}!`);
  }


  private checkDuties = async (slot: Slot): Promise<void> => {
    const validatorDuty =
      (await this.apiClient.validator.getDuties(
        [this.opts.keypair.publicKey.toBytesCompressed()],
        computeEpochOfSlot(this.config, slot))
      )[0];
    const {fork} = await this.apiClient.beacon.getFork();
    const isAttester = validatorDuty.attestationSlot === slot;
    const isProposer = validatorDuty.blockProposalSlot === slot;
    if (isAttester) {
      this.logger.info(`Validator is attester at slot ${slot} and shard ${validatorDuty.attestationShard}`);
      this.attestationService.createAndPublishAttestation(
        validatorDuty.attestationSlot,
        validatorDuty.attestationShard,
        fork
      );
    }
    if (isProposer) {
      this.logger.info(`Validator is proposer at slot ${slot}`);
      this.blockService.createAndPublishBlock(slot, fork);
    }
  };
}

export default Validator;
