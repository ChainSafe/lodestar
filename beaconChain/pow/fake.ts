import {Deposit} from "../interfaces/blocks";

type int = number;
type hash32 = Uint8Array;

interface DummyChainStart {
  deposits: Deposit[];
  genesisTime: int;
  depositRoot: hash32;
}

export function getInitialDeposits(): DummyChainStart {
  return {
    deposits: generateFakeDeposits(),
    genesisTime: Date.now() / 1000 | 0,
    depositRoot: new Uint8Array(32)
  }
}

function generateFakeDeposits(): Deposit[] {
  let deposits: Deposit[] = [];

  for (let i: number = 0; i < 10; i++) {
    const deposit: Deposit = {
      branch: [new Uint8Array(32)],
      index: i,
      depositData: {
        amount: 32000000000,
        timestamp: Date.now() / 1000 | 0,
        depositInput: {
          pubkey: 0xe4b32544f1d3fa0a071e3629a1a22e76dc216312,
          withdrawalCredentials: new Uint8Array(32),
          randaoCommitment: new Uint8Array(32),
          custodyCommitment: new Uint8Array(32),
          proofOfPossession: [486468,486484]
        }
      }
    };
    deposits.push(deposit);
  }
  return deposits;
}
