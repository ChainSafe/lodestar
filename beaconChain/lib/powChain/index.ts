import { ethers, Contract } from 'ethers';
import { EtherscanProvider } from 'ethers/providers';
import { Deposit, DepositData, DepositInput } from '../../interfaces/blocks';
import { ChainStart } from "../../interfaces/state";
import { DEPOSIT_CONTRACT_ADDRESS, DEPOSIT_CONTRACT_BLOCK_NUMBER, DEPOSIT_CONTRACT_ABI } from "../../constants/constants";

// Type stubs
type uint64 = number;
type hash32 = string;


// NOTE: This is stubbed
// TODO: We should find a way to reject the promise somehow.
// TODO: There is porbably a better way to scrape the logs.
/**
 * Polls the eth1.x deposit contract for validator deposits. If the ChainStart log is emitted, return the promise with
 * intial state data.
 * @returns {Promise<ChainStart>}
 */
const waitForChainStart = () => {
  return new Promise<ChainStart>((resolve) => {
    const deposits: Deposit[] = [];

    // Connect to the network
    let provider = ethers.getDefaultProvider();

    // Deposit Contract
    let depositContract: ethers.Contract = new ethers.Contract(DEPOSIT_CONTRACT_ADDRESS, DEPOSIT_CONTRACT_ABI, provider);

    // Eth1Deposit log filter
    let depositTopic: string = depositContract.Eth1Deposit();
    let depositFilter: ethers.EventFilter = {
      address: DEPOSIT_CONTRACT_ADDRESS,
      topics: [ depositTopic ]
    };

    // ChainStart log filter
    let chainStartTopic: string = depositContract.ChainStart();
    let chainStartFilter: ethers.EventFilter = {
      address: DEPOSIT_CONTRACT_ADDRESS,
      topics: [ chainStartTopic ]
    };

    // Listen for Eth1Deposit logs
    provider.on(depositFilter, (previousReceiptRoot: hash32[], data: DepositData, totalDepositcount: uint64, log) => {
      const newDeposit: Deposit = formatDeposit(previousReceiptRoot, data, totalDepositcount);
      deposits.push(newDeposit);
    });

    // Listen for ChainStart log and resolve the promise.
    provider.on(chainStartFilter, (receiptRoot, time, log) => {
      resolve({ deposits, receiptRoot, time });
    });

    // Reset filter to start when the contract was mined.
    provider.resetEventsBlock(DEPOSIT_CONTRACT_BLOCK_NUMBER);
  });
};

// NOTE This is stubbed.
// TODO Create custom type for param data.
// TODO Test against contract
/**
 * Helper function for processing the Eth1Deposit event.
 * @param {hash32[]} previousReceiptRoot
 * @param data
 * @param {uint64} totalDepositCount
 * @returns {Deposit}
 */
const formatDeposit = (previousReceiptRoot: hash32[], data: any, totalDepositCount: uint64): Deposit => {
  // Reassign values to stay consistent with camel case
  const depositInput: DepositInput = {
    pubkey: data.deposit_input.pubkey,
    proofOfPossession: data.deposit_input.proof_of_possession,
    withdrawalCredentials: data.deposit_input.withdrawal_credentials,
    randaoCommitment: data.deposit_input.randao_commitment,
    pocCommitment: data.deposit_input.poc_commitment
  };

  const depositData: DepositData = {
    depositInput: depositInput,
    value: data.msg_gwei_bytes8,
    timestamp: data.timestamp_bytes8
  };

  // Formatted Deposit
  return {
    depositData: depositData,
    merkleBranch: previousReceiptRoot,
    merkleTreeIndex: totalDepositCount
  };
};

export {
  waitForChainStart,
};
