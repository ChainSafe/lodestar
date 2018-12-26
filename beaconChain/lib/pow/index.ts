import { ethers, Contract } from 'ethers';
import { EtherscanProvider } from 'ethers/providers';
import { Deposit, DepositData, DepositInput } from '../../interfaces/blocks';
import { ChainStart } from "../../interfaces/state";
import { MAINNET_DEPOSIT_ADDRESS, DEPOSIT_CONTRACT_ADDRESS, DEPOSIT_CONTRACT_BLOCK_NUMBER, DEPOSIT_CONTRACT_ABI } from "../../constants/constants";

// Type stubs
type int = number;
type bytes = number;
type uint24 = number;
type uint64 = number;
type hash32 = string;

/**
 * NOTE: Haven't been able to test this yet. Waiting for contracts to test against.
 * TODO: We should find a way to reject the promise somehow.
 * TODO: There is porbably a better way to scrape the logs.
 */
const pollPowChain = () => {
  return new Promise<ChainStart>((resolve) => {
    const deposits: Deposit[] = [];
    
    // Connect to the network
    let provider = ethers.getDefaultProvider();
    let depositContract: ethers.Contract = new ethers.Contract(MAINNET_DEPOSIT_ADDRESS, DEPOSIT_CONTRACT_ABI, provider);
    
    // Eth1Deposit log filter
    let depositTopic: string = depositContract.Eth1Deposit();
    let depositFilter: ethers.EventFilter = {
      address: MAINNET_DEPOSIT_ADDRESS,
      topics: [ depositTopic ]
    };

    // ChainStart log filter
    let chainStartTopic: string = depositContract.ChainStart();
    let chainStartFilter: ethers.EventFilter = {
      address: MAINNET_DEPOSIT_ADDRESS,
      topics: [ chainStartTopic ]
    };

    // Listen for Eth1Deposit logs 
    provider.on(depositFilter, (previousReceiptRoot: hash32[], data: DepositData, totalDepositcount: uint64, log) => {
      // Unsure if depositInput & depositData should be unwrapped from the logs here...
      const newReceipt: Deposit = {
        depositData: data,
        merkleBranch: previousReceiptRoot,
        merkleTreeIndex: totalDepositcount
      };
      deposits.push(newReceipt);
    });

    // Listen for ChainStart log
    provider.on(chainStartFilter, (receiptRoot, time, log) => {
      resolve({ deposits, receiptRoot, time });
    })

    // Reset filter to start when the contract was mined.
    provider.resetEventsBlock(DEPOSIT_CONTRACT_BLOCK_NUMBER);
  });
};

export default pollPowChain;