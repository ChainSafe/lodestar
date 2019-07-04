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
import {Epoch, Slot, ValidatorIndex} from "../../types";
import {GenesisInfo, ValidatorCtx} from "./types";
import {RpcClient, RpcClientOverWs} from "./rpc";
import {AttestationService} from "./services/attestation";
import {ValidatorDB, IValidatorDB, LevelDbController} from "../db";
import {ILogger} from "../logger";

/**
 * Main class for the Validator client.
 */
class Validator {
  private ctx: ValidatorCtx;
  private rpcClient: RpcClient;
  private validatorIndex: ValidatorIndex;
  private blockService: BlockProposingService;
  private attestationService: AttestationService;
  private genesisInfo: GenesisInfo;
  private db: IValidatorDB;
  private logger: ILogger;
  public isActive: boolean;


  public constructor(ctx: ValidatorCtx, logger: ILogger) {
    this.ctx = ctx;
    this.logger = logger;
    this.isActive = false;
    this.db = ctx.db ? ctx.db : new ValidatorDB({
      controller: new LevelDbController({
        name: 'LodestarValidatorDB'
      },
      {
        logger: this.logger
      }
      )
    });
    if(ctx.rpc) {
      this.rpcClient = ctx.rpc;
    } else if(ctx.rpcUrl) {
      this.rpcClient = new RpcClientOverWs({rpcUrl: ctx.rpcUrl});
    } else {
      throw new Error("Validator requires either RpcClient instance or rpc url as params");
    }
  }

  /**
   * Creates a new block proccessing service and starts it.
   */
  private async start(): Promise<void> {
    await this.setup();
    this.run();
  }

  /**
   * Stops all validator functions
   */
  private async stop(): Promise<void> {}

  /**
   * Main method that starts a client.
   */
  public async setup(): Promise<void> {
    this.logger.info("Setting up validator client...");

    await this.setupRPC();

    // Wait for the ChainStart log and grab validator index
    this.isActive = await this.isChainLive();
    this.validatorIndex = await this.getValidatorIndex();

    this.blockService = new BlockProposingService(
      this.validatorIndex,
      this.rpcClient,
      this.ctx.keypair.privateKey,
      this.db, this.logger
    );

    this.attestationService = new AttestationService(
      this.validatorIndex,
      this.rpcClient,
      this.ctx.keypair.privateKey,
      this.db,
      this.logger
    );
  }

  /**
   * Establishes a connection to a specified beacon chain url.
   */
  private async setupRPC(): Promise<void> {
    this.logger.info("Setting up RPC connection...");
    await this.rpcClient.connect();
    this.logger.info(`RPC connection successfully established: ${this.ctx.rpcUrl || 'inmemory'}!`);
  }

  /**
   * Recursively checks for the chain start log event from the ETH1.x deposit contract
   */
  private async isChainLive(): Promise<boolean> {
    this.logger.info("Checking if chain has started...");
    const genesisTime =  await this.rpcClient.beacon.getGenesisTime();
    if (genesisTime) {
      this.genesisInfo = {
        startTime: genesisTime,
      };
      this.logger.info("Chain start has occured!");
      return true;
    }
    setTimeout(this.isChainLive, 1000);
  }

  /**
   * Checks to see if the validator has been processed on the beacon chain.
   */
  private async getValidatorIndex(): Promise<ValidatorIndex> {
    this.logger.info("Checking if validator has been processed...");
    const index = await this.rpcClient.validator.getIndex(
      this.ctx.keypair.publicKey.toBytesCompressed()
    );
    if (index) {
      this.logger.info("Validator has been processed!");
      return index;
    }
    setTimeout(this.getValidatorIndex, 1000);
  }

  private run(): void {
    this.rpcClient.onNewSlot(this.checkDuties);
    this.rpcClient.onNewEpoch(this.lookAhead);
  };

  private async checkDuties(slot: Slot): Promise<void> {
    const validatorDuty =
      (await this.rpcClient.validator.getDuties([
        this.ctx.keypair.publicKey.toBytesCompressed()
      ]))[0];
    const currentVersion = await this.rpcClient.beacon.getFork();
    const isAttester = validatorDuty.attestationSlot === slot;
    const isProposer = validatorDuty.blockProductionSlot === slot;
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
