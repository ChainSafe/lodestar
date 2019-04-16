import BN from "bn.js";
import { assert } from "chai";
import { ethers } from "ethers";
import ganache from "ganache-core";
import sinon from "sinon";

import { EthersEth1Notifier } from "../../../src/eth1";
import defaults from "../../../src/eth1/defaults";
import promisify from "promisify-es6";

// TODO integrate this into longer running tests
describe("Eth1Notifier - using deployed contract", () => {
  const N = 10; // number of private keys to generate
  const privateKeys = Array.from({length: N}, (_, i) =>
    Buffer.concat([Buffer.alloc(16), (new BN(i+1)).toArrayLike(Buffer, 'le', 16)]));
  // Seed ephemeral testnet with balances for each privateKey
  const ganacheProvider = ganache.provider({
    accounts: privateKeys.map((secretKey) => ({
      secretKey,
      balance: "0x100000000000000000",
    })),
    locked: false,
  });
  const provider = new ethers.providers.Web3Provider(ganacheProvider);
  let address;
  let eth1;

  before(async function() {
    // This takes a while
    this.timeout(0);
    // deploy deposit contract
    console.log('deploying deposit contract...');
    const deployKey = privateKeys[privateKeys.length - 1];
    const deployWallet = new ethers.Wallet(deployKey, provider);
    const factory = new ethers.ContractFactory(defaults.depositContract.abi, defaults.depositContract.bytecode, deployWallet);
    const contract = await factory.deploy();
    address = contract.address;
    await contract.deployed();
    console.log('deployed!');

    eth1 = new EthersEth1Notifier({
      depositContract: {
        ...defaults.depositContract,
        address,
      },
      provider,
    });
  });

  it("should process a Deposit log", async function() {
    // This takes a while
    this.timeout(0);

    const depositKey = privateKeys[privateKeys.length - 2];
    const depositWallet = new ethers.Wallet(depositKey, provider);
    const contract = (new ethers.Contract(address, defaults.depositContract.abi, provider)).connect(depositWallet);

    const cb = sinon.spy();
    eth1.on('deposit', cb);
    await eth1.start();

    const depositData = Buffer.alloc(512);
    const tx = await contract.deposit(depositData, {value: ethers.utils.parseEther('32.0')});
    await tx.wait();
    await new Promise((resolve) => setTimeout(resolve, 5000));
    assert(cb.calledOnce, "deposit event did not fire");
  });

  after(async function() {
    await eth1.stop();
    await promisify(ganacheProvider.close)();
  })
})
