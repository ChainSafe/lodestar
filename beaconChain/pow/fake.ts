import { Deposit, DepositData, DepositInput, Eth1Data } from "../types";
import BN = require("bn.js");

type int = number;

interface DummyChainStart {
  deposits: Deposit[];
  genesisTime: int;
  eth1Data: Eth1Data;
}

export function getInitialDeposits(): DummyChainStart {
  return {
    deposits: generateFakeDeposits(),
    eth1Data: generateEthData(),
    genesisTime: Date.now() / 1000 | 0,
  };
}

function generateEthData(): Eth1Data {
  return {
    blockHash: new Uint8Array(32),
    depositRoot: new Uint8Array(32),
  };
}

function generateFakeDeposits(): Deposit[] {
  const deposits: Deposit[] = [];

  for (let i: number = 0; i < 10; i++) {
    const depositInput: DepositInput = {
      proofOfPossession: new Uint8Array(2),
      pubkey: new Uint8Array(2),
      withdrawalCredentials: new Uint8Array(32),
    };

    const depositData: DepositData = {
      amount: new BN(32).mul(new BN(10).muln(9)), // 32000000000
      depositInput,
      timestamp: new BN(Date.now()).divn(1000),
    };

    const deposit: Deposit = {
      branch: [new Uint8Array(32)],
      depositData,
      index: new BN(i),
    };
    deposits.push(deposit);
  }
  return deposits;
}
