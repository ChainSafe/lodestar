import {ethers} from "ethers";
import {CommandBuilder} from "yargs";
import {ValidatorDirManager} from "../../../../validatorDir";
import {processValidatorPaths} from "../../../validator/paths";
import {IGlobalArgs} from "../../../../options";
import {IChainArgs} from "../../../dev/options/chain";
import {getBeaconConfig} from "../../../../util";

const DEPOSIT_GAS_LIMIT = 400000;

interface IValidatorDepositOptions extends IGlobalArgs, IChainArgs {
  validatorsDir: string;
  validator: string;
  eth1Http?: string;
}

export const command = "deposit";

export const description = `Submits a deposit to an Eth1 validator registration contract via an IPC endpoint
of an Eth1 client (e.g., Geth, OpenEthereum, etc.). The validators must already
have been created and exist on the file-system. The process will exit immediately
with an error if any error occurs. After each deposit is submitted to the Eth1
node, a file will be saved in the validator directory with the transaction hash.
The application does not wait for confirmations so there is not guarantee that
the transaction is included in the Eth1 chain; use a block explorer and the
transaction hash to check for confirmations. The deposit contract address will
be determined by the --testnet-dir flag on the primary Lighthouse binary.`;

// Constructs representations of the path structure to show in command's description
const defaultPaths = processValidatorPaths({rootDir: "$rootDir"});

export const builder: CommandBuilder<{}, IValidatorDepositOptions> = {
  validatorsDir:  {
    description: `The path where the validator directories will be created.\n[default: ${defaultPaths.validatorsDir}]`,
    normalize: true,
    type: "string",
  },

  validator: {
    description: "The name of the validator directory in $validatorsDir for which to deposit. \
    Set to 'all' to deposit all validators in the $validatorsDir.",
    normalize: true,
    type: "string",
  },

  eth1Http: {
    description: "URL to an Eth1 JSON-RPC endpoint",
    demandOption: true,
    type: "string"
  }
};

export async function handler(options: IValidatorDepositOptions): Promise<void> {
  const spec = options.chain.name;
  const validatorName = options.validator;
  const eth1Http = options.eth1Http;
  const {validatorsDir} = processValidatorPaths(options);
  const config = getBeaconConfig(spec);

  if (!config.params.DEPOSIT_CONTRACT_ADDRESS)
    throw Error("deposit_contract not in configuration");
  const depositContractAddress = String(config.params.DEPOSIT_CONTRACT_ADDRESS);

  // Load validators to deposit
  // depositData is already generated when building / creating the validator dir
  const validatorDirManager = new ValidatorDirManager(validatorsDir);
  const validatorDirs = validatorName === "all"
    ? validatorDirManager.openAllValidators()
    : [validatorDirManager.openValidator(validatorName)];

  const validatorDirsToSubmit = validatorDirs
    // txHash file is used as a flag of deposit submission
    .filter(validatorDir => validatorDir.eth1DepositTxHashExists());
  
  if (validatorDirsToSubmit.length === 0)
    throw Error("No validators to deposit");
  // eslint-disable-next-line no-console
  console.log(`Starting ${validatorDirsToSubmit.length} deposits`);

  // ### TODO:
  const eth1PrivateKey = "";
  
  const provider = new ethers.providers.JsonRpcProvider(eth1Http);
  const eth1Wallet = new ethers.Wallet(eth1PrivateKey, provider);
  eth1Wallet.connect(provider);

  for (const validatorDir of validatorDirsToSubmit) {
    const {rlp, depositData} = validatorDir.eth1DepositData(config);
    const value = depositData.amount * BigInt(1e9);
    const tx = await eth1Wallet.sendTransaction({
      to: depositContractAddress,
      gasLimit: DEPOSIT_GAS_LIMIT,
      value: value.toString(),
      data: rlp
    });
    const txHash = tx.hash || "";
    validatorDir.saveEth1DepositTxHash(txHash);
    // eslint-disable-next-line no-console
    console.log(`Submitted deposit. txHash: ${txHash}`);

    const receipt = await tx.wait();
    // eslint-disable-next-line no-console
    console.log(`Confirmed deposit. blocknumber: ${receipt.blockNumber}`);
  }
}
