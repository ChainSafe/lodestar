import {BigNumber} from "ethers";
import {toHexString} from "@chainsafe/ssz";
import {getBeaconConfigFromArgs} from "../../../../config";
import {ValidatorDirManager} from "../../../../validatorDir";
import {getAccountPaths} from "../../paths";
import {getEthersSigner, YargsError, ICliCommand} from "../../../../util";
import {IAccountValidatorArgs} from "./options";
import {IGlobalArgs} from "../../../../options";

const DEPOSIT_GAS_LIMIT = 400000;

interface IAccountValidatorDepositArgs {
  validator: string;
  keystorePath?: string;
  keystorePassword?: string;
  rpcUrl?: string;
  rpcPassword?: string;
  ipcPath?: string;
}

export const deposit: ICliCommand<IAccountValidatorDepositArgs, IAccountValidatorArgs & IGlobalArgs> = {
  command: "deposit",

  describe:
    "Submits a deposit to an Eth1 validator registration contract via an IPC endpoint \
of an Eth1 client (e.g., Geth, OpenEthereum, etc.). The validators must already \
have been created and exist on the file-system. The process will exit immediately \
with an error if any error occurs. After each deposit is submitted to the Eth1 \
node, a file will be saved in the validator directory with the transaction hash. \
The deposit contract address will be determined by the spec config flag.",

  examples: [
    {
      command:
        "account validator deposit --validator 0x88f92 \
--keystorePath keystore.json --keystorePassword my-secret-pass",
      description: "Fund a deposit using a local keystore file",
    },
    {
      command: "account validator deposit --validator 0x88f92 \
--ipcPath /home/your_folder/geth.ipc",
      description: "Fund a deposit using a local Eth1 node via IPC",
    },
    {
      command:
        "account validator deposit --validator 0x88f92 \
--rpcUrl http://localhost:8545 --rpcPassword my-secret-pass",
      description: "Fund a deposit using a local Eth1 node unlockable via JSON RPC",
    },
  ],

  options: {
    validator: {
      description:
        "The name of the validator directory in $keystoresDir for which to deposit. \
      Set to 'all' to deposit all validators in the $keystoresDir.",
      normalize: true,
      demandOption: true,
      type: "string",
    },

    keystorePath: {
      description: "Path to a keystore with an Eth1 account. Must provide its password with keystorePassword",
      type: "string",
    },

    keystorePassword: {
      description: "Password to unlock the Eth1 keystore in keystorePath",
      type: "string",
    },

    rpcUrl: {
      description:
        "URL to an Eth1 JSON-RPC endpoint. It can have an unlocked account to sign, \
      use rpcPassword to unlock it, or provide a local keystore and password.",
      type: "string",
    },

    rpcPassword: {
      description: "Password to unlock an Eth1 node's account provided with rpcUrl.",
      type: "string",
    },

    ipcPath: {
      description: "Path to an Eth1 node IPC.",
      type: "string",
    },
  },

  handler: async (args) => {
    const validatorName = args.validator;
    const accountPaths = getAccountPaths(args);
    const config = getBeaconConfigFromArgs(args);

    if (!config.params.DEPOSIT_CONTRACT_ADDRESS) throw new YargsError("deposit_contract not in configuration");
    const depositContractAddress = toHexString(config.params.DEPOSIT_CONTRACT_ADDRESS);

    // Load validators to deposit
    // depositData is already generated when building / creating the validator dir
    const validatorDirManager = new ValidatorDirManager(accountPaths);
    const validatorDirs =
      validatorName === "all"
        ? validatorDirManager.openAllValidators()
        : [validatorDirManager.openValidator(validatorName)];

    const validatorDirsToSubmit = validatorDirs
      // txHash file is used as a flag of deposit submission
      .filter((validatorDir) => !validatorDir.eth1DepositTxHashExists());

    if (validatorDirsToSubmit.length === 0) throw new YargsError("No validators to deposit");
    // eslint-disable-next-line no-console
    console.log(`Starting ${validatorDirsToSubmit.length} deposits`);

    const eth1Signer = await getEthersSigner({
      ...args,
      chainId: config.params.DEPOSIT_NETWORK_ID,
    });

    for (const validatorDir of validatorDirsToSubmit) {
      const {rlp, depositData} = validatorDir.eth1DepositData(config);
      const tx = await eth1Signer.sendTransaction({
        to: depositContractAddress,
        gasLimit: DEPOSIT_GAS_LIMIT,
        value: BigNumber.from(depositData.amount * BigInt(1e9)),
        data: rlp,
        chainId: config.params.DEPOSIT_CHAIN_ID,
      });
      if (!tx.hash) throw Error("No transaction hash");
      validatorDir.saveEth1DepositTxHash(tx.hash);
      // eslint-disable-next-line no-console
      console.log(`Submitted deposit. txHash: ${tx.hash}`);

      const receipt = await tx.wait();
      // eslint-disable-next-line no-console
      console.log(`Confirmed deposit. blocknumber: ${receipt.blockNumber}`);
    }
  },
};
