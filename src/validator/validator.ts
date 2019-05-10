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
import BlockProcessingService from "./block";
import logger, {AbstractLogger} from "../logger";
import {Slot, ValidatorIndex} from "../types";
import {GenesisInfo, ValidatorCtx} from "./types";
import {RpcClient, RpcClientOverWs} from "./rpc";
import {AttestationService} from "./attestation";

/**
 * Main class for the Validator client.
 */
class Validator {
  private ctx: ValidatorCtx;
  private logger: AbstractLogger;
  private rpcClient: RpcClient;
  private validatorIndex: ValidatorIndex;
  private blockService: BlockProcessingService;
  private attestationService: AttestationService;
  private genesisInfo: GenesisInfo;
  public isActive: boolean;

  public constructor(ctx: ValidatorCtx) {
    this.ctx = ctx;
    this.logger = logger;
    this.isActive = false;
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

    this.blockService = new BlockProcessingService(
      this.validatorIndex, this.rpcClient, this.ctx.privateKey
    );
    this.attestationService = new AttestationService();
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
    const index = await this.rpcClient.validator.getIndex(this.ctx.publicKey);
    if (index) {
      this.logger.info("Validator has been processed!");
      return index;
    }
    setTimeout(this.getValidatorIndex, 1000);
  }

  // private async checkAssignment(): Promise<void> {
  //   // If epoch boundary then look up for new assignment
  //   if ((Date.now() - this.genesisInfo.startTime) % SLOTS_PER_EPOCH === 0) {
  //
  //     const epoch = await this.rpcClient.getCurrentEpoch();
  //     const assignment: CommitteeAssignment = await this.rpcClient.getCommitteeAssignment(epoch, this.validatorIndex);
  //     const isProposer: boolean = this.rpcClient.isProposerAtSlot(assignment.slot, this.validatorIndex);
  //
  //     if (assignment.validators.includes(this.validatorIndex) && isProposer) {
  //       // Run attestation and then block proposer on `slot`
  //       this.logger.info(`Validator: ${this.validatorIndex}, Attesting: True, Proposing: True`);
  //     } else if (assignment.validators.includes(this.validatorIndex)) {
  //       // Run attestation on `slot`
  //       this.logger.info(`Validator: ${this.validatorIndex}, Attesting: True, Proposing: False`);
  //     } else {
  //       this.logger.info(`Validator with index ${this.validatorIndex} has no role for slot ${assignment.slot}`);
  //     }
  //   }
  // }



  private run(): void {
    this.rpcClient.onNewSlot(async (slot: Slot) => {
      const {currentVersion, validatorDuty} =
        await this.rpcClient.validator.getDuties(this.validatorIndex);
      if(validatorDuty.attestationSlot === slot) {
        this.attestationService.attest();
      }
      if(validatorDuty.blockProductionSlot === slot) {
        this.blockService.buildBlock(slot);
      }
    });
  };
}

export default Validator;
