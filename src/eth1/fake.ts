import BN = require("bn.js");
import { Deposit, DepositData, DepositInput, Eth1Data, int } from "../types";

interface DummyChainStart {
  deposits: Deposit[];
  genesisTime: int;
  eth1Data: Eth1Data;
}

function generateEthData(): Eth1Data {
  return {
    blockHash: Buffer.alloc(32),
    depositRoot: Buffer.alloc(32),
  };
}

function generateFakeDeposits(): Deposit[] {
  const deposits: Deposit[] = [];

  for (let i = 0; i < 10; i++) {
    const depositInput: DepositInput = {
      proofOfPossession: Buffer.alloc(2),
      pubkey: Buffer.alloc(2),
      withdrawalCredentials: Buffer.alloc(32),
    };

    const depositData: DepositData = {
      amount: new BN(32).mul(new BN(10).muln(9)), // 32000000000
      depositInput,
      timestamp: new BN(Date.now()).divn(1000),
    };

    const deposit: Deposit = {
      branch: [Buffer.alloc(32)],
      depositData,
      index: new BN(i),
    };
    deposits.push(deposit);
  }
  return deposits;
}

export function getInitialDeposits(): DummyChainStart {
  return {
    deposits: generateFakeDeposits(),
    eth1Data: generateEthData(),
    genesisTime: Date.now() / 1000 | 0,
  };
}


