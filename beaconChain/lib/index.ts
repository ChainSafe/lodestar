import { ethers } from 'ethers';

// Relative imports
import { MAINNET_DEPOSIT_ADDRESS } from "../constants/constants";

const Start = (): void => {

};

// This is stubbed
const pollSmartContract = () => {
  // The Contract interface
  let abi = [
    "event ValueChanged(address indexed author, string oldValue, string newValue)",
    "constructor(string value)",
    "function getValue() view returns (string value)",
    "function setValue(string value)"
  ];

  // Connect to the network
  let provider = ethers.getDefaultProvider();
  let depositContract = new ethers.Contract(MAINNET_DEPOSIT_ADDRESS, abi, provider);

};


export default Start;
