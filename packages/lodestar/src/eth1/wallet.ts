/**
 * @module eth1
 */

import {ContractTransaction, ethers, Wallet} from "ethers";
import {Provider} from "ethers/providers";
import {BigNumber} from "ethers/utils";
import BN from "bn.js";
import bls from "@chainsafe/bls";
import {hash, signingRoot} from "@chainsafe/ssz";
import {DepositData} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DomainType} from "../constants";
import {ILogger} from "../logger";


export class Eth1Wallet {

  private wallet: Wallet;

  private contractAbi;

  private config: IBeaconConfig;

  private logger: ILogger;

  public constructor(privateKey: string, contractAbi: any, config: IBeaconConfig, logger: ILogger, provider?: Provider) {
    this.config = config;
    this.logger = logger;
    if(!provider) {
      provider = ethers.getDefaultProvider();
    }
    this.wallet = new Wallet(privateKey, provider);
    this.contractAbi = contractAbi;
  }

  /**
   * Will deposit 32 ETH to eth2.0 deposit contract.
   * @param address address of deposit contract
   * @param value amount to wei to deposit on contract
   */

  public async createValidatorDeposit(address: string, value: BigNumber): Promise<string> {
    const amount = new BN(value.toString()).div(new BN(1000000000));

    let contract = new ethers.Contract(address, this.contractAbi, this.wallet);
    const privateKey = hash(Buffer.from(address, 'hex'));
    const pubkey = bls.generatePublicKey(privateKey);
    const withdrawalCredentials = Buffer.concat([
      this.config.params.BLS_WITHDRAWAL_PREFIX_BYTE,
      hash(pubkey).slice(1),
    ]);

    // Create deposit data
    const depositData: DepositData = {
      pubkey,
      withdrawalCredentials,
      amount,
      signature: Buffer.alloc(96)
    };

    const signature = bls.sign(
      privateKey,
      signingRoot(depositData, this.config.types.DepositData),
      Buffer.from([0, 0, 0, DomainType.DEPOSIT])
    );
    // Send TX
    try {
      const tx: ContractTransaction = await contract.deposit(
        pubkey,
        withdrawalCredentials,
        signature,
        {value});
      await tx.wait();
      return tx.hash;
    } catch(e) {
      this.logger.error(e.message);
    }
  }

}
