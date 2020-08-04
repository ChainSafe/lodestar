import {CommandBuilder} from "yargs";
import {BigNumber} from "ethers";
import {toHexString} from "@chainsafe/ssz";

import {ValidatorDirManager} from "../../../../validatorDir";
import {getAccountPaths} from "../../paths";
import {getEthersSigner, YargsError} from "../../../../util";
import {IAccountValidatorOptions} from "./options";
import {IInitOptions} from "../../../init/options";
import {initHandler as initCmd} from "../../../init/init";
import {getMergedIBeaconConfig} from "../../../../config/params";

const DEPOSIT_GAS_LIMIT = 400000;

export const command = "deposit";

export const description = "Submits a deposit to an Eth1 validator registration contract via an IPC endpoint \
of an Eth1 client (e.g., Geth, OpenEthereum, etc.). The validators must already \
have been created and exist on the file-system. The process will exit immediately \
with an error if any error occurs. After each deposit is submitted to the Eth1 \
node, a file will be saved in the validator directory with the transaction hash. \
The deposit contract address will be determined by the spec config flag.";

interface IAccountValidatorDepositOptions extends IAccountValidatorOptions {
  keystoresDir: string;
  validator: string;
  keystorePath?: string;
  keystorePassword?: string;
  rpcUrl?: string;
  rpcPassword?: string;
  ipcPath?: string;
}

export const builder: CommandBuilder<{}, IAccountValidatorDepositOptions> = {
  validator: {
    description: "The name of the validator directory in $keystoresDir for which to deposit. \
    Set to 'all' to deposit all validators in the $keystoresDir.",
    normalize: true,
    demandOption: true,
    type: "string",
  },

  keystorePath: {
    description: "Path to a keystore with an Eth1 account. Must provide its password with keystorePassword",
    type: "string"
  },

  keystorePassword: {
    description: "Password to unlock the Eth1 keystore in keystorePath",
    type: "string"
  },

  rpcUrl: {
    description: "URL to an Eth1 JSON-RPC endpoint. It can have an unlocked account to sign, \
    use rpcPassword to unlock it, or provide a local keystore and password.",
    type: "string"
  },

  rpcPassword: {
    description: "Password to unlock an Eth1 node's account provided with rpcUrl.",
    type: "string"
  },

  ipcPath: {
    description: "Path to an Eth1 node IPC.",
    type: "string"
  }
};

export async function handler(options: IAccountValidatorDepositOptions): Promise<void> {
  await initCmd(options as unknown as IInitOptions);
  const validatorName = options.validator;
  const accountPaths = getAccountPaths(options);
  const config = await getMergedIBeaconConfig(options.preset, accountPaths.paramsFile, options.params);

  if (!config.params.DEPOSIT_CONTRACT_ADDRESS)
    throw new YargsError("deposit_contract not in configuration");
  const depositContractAddress = toHexString(config.params.DEPOSIT_CONTRACT_ADDRESS);

  // Load validators to deposit
  // depositData is already generated when building / creating the validator dir
  const validatorDirManager = new ValidatorDirManager(accountPaths);
  const validatorDirs = validatorName === "all"
    ? validatorDirManager.openAllValidators()
    : [validatorDirManager.openValidator(validatorName)];

  const validatorDirsToSubmit = validatorDirs
    // txHash file is used as a flag of deposit submission
    .filter(validatorDir => !validatorDir.eth1DepositTxHashExists());

  if (validatorDirsToSubmit.length === 0)
    throw new YargsError("No validators to deposit");
  // eslint-disable-next-line no-console
  console.log(`Starting ${validatorDirsToSubmit.length} deposits`);

  const eth1Signer = await getEthersSigner(options);

  for (const validatorDir of validatorDirsToSubmit) {
    const {rlp, depositData} = validatorDir.eth1DepositData(config);
    const tx = await eth1Signer.sendTransaction({
      to: depositContractAddress,
      gasLimit: DEPOSIT_GAS_LIMIT,
      value: BigNumber.from(depositData.amount * BigInt(1e9)),
      data: rlp,
      chainId: config.params.DEPOSIT_CHAIN_ID
    });
    if (!tx.hash) throw Error("No transaction hash");
    validatorDir.saveEth1DepositTxHash(tx.hash);
    // eslint-disable-next-line no-console
    console.log(`Submitted deposit. txHash: ${tx.hash}`);

    const receipt = await tx.wait();
    // eslint-disable-next-line no-console
    console.log(`Confirmed deposit. blocknumber: ${receipt.blockNumber}`);
  }
}
