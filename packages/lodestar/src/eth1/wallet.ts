/**
 * @module eth1
 */

import {ContractTransaction, ethers, Wallet} from "ethers";
import {Provider} from "ethers/providers";
import {BigNumber, ParamType} from "ethers/utils";
import bls, {PrivateKey} from "@chainsafe/bls";
import {hash, hashTreeRoot, signingRoot} from "@chainsafe/ssz";
import {DepositData} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {DomainType} from "../constants";
import {ILogger} from "../logger";


export class Eth1Wallet {

  private wallet: Wallet;

  private contractAbi: string|ParamType[];

  private config: IBeaconConfig;

  private logger: ILogger;

  public constructor(
    privateKey: string,
    contractAbi: string|ParamType[],
    config: IBeaconConfig,
    logger: ILogger,
    provider?: Provider
  ) {
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
    const amount = BigInt(value.toString()) / 1000000000n;

    console.log("createValidatorDeposit 000");
    const contract = new ethers.Contract(address, this.contractAbi, this.wallet);
    console.log("createValidatorDeposit 111");

    const privateKey = PrivateKey.random();
    console.log("createValidatorDeposit 222");

    const pubkey = privateKey.toPublicKey().toBytesCompressed();
    console.log("createValidatorDeposit 333");

    const withdrawalCredentials = Buffer.concat([
      this.config.params.BLS_WITHDRAWAL_PREFIX_BYTE,
      hash(pubkey).slice(1),
    ]);

    console.log("createValidatorDeposit 444");

    // Create deposit data
    const depositData: DepositData = {
      pubkey,
      withdrawalCredentials,
      amount,
      signature: Buffer.alloc(96)
    };

    console.log("createValidatorDeposit 555");


    depositData.signature = bls.sign(
      privateKey.toBytes(),
      signingRoot(this.config.types.DepositData, depositData),
      Buffer.from([0, 0, 0, DomainType.DEPOSIT])
    );
    console.log("createValidatorDeposit 666");

    // Send TX
    try {
      const tx: ContractTransaction = await contract.deposit(
        pubkey,
        withdrawalCredentials,
        depositData.signature,
        hashTreeRoot(this.config.types.DepositData, depositData),
        {value});
      console.log("createValidatorDeposit 777");

      await tx.wait();
      console.log("createValidatorDeposit 888");

      return tx.hash || "";
    } catch(e) {
      this.logger.error(e.message);
      return "";
    }
  }

}
