// NOTE :: All commands are stubbed as examples
// Useful repo https://github.com/tsantef/commander-starter
import program from "commander";
import {PrivateEth1Network} from "../eth1/dev/";
import {ethers, Wallet} from "ethers";
import {Eth1Wallet} from "../eth1";
import defaults from "../eth1/defaults";
import logger from "../logger/winston";

program
  .version('0.0.1');

program
  .command('eth1:dev')
  .description('Start private eth1 chain with deposit contract and 10 accounts with balance')
  .option("-p, --port [port]", 'Port on which private network node should start', 8545)
  .option("-h, --host [host]", 'Host on which node will be', '127.0.0.1')
  .option("-m, --mnemonic [mnemonic]", 'mnemonic string to be used for generating account')
  .option("-n, --network [networkId]", "Id of eth1 chain", 200)
  .option("-d, --database [db_path]", 'Path to database, if specified chain will be initialized from stored point')
  .action(({port, host, network, mnemonic, database}) => {
      new PrivateEth1Network({port, host, mnemonic, networkId: network, db_path:database}).start();
  });

program
  .command('deposit')
  .description('Start private network with deposit contract and 10 accounts with balance')
  .option("-k, --privateKey [privateKey]", 'Private key of account that will make deposit')
  .option("-m, --mnemonic [mnemonic]", 'If mnemonic is submitted, first 10 accounts will make deposit')
  .option("-n, --node [node]", 'Url of eth1 node', 'http://127.0.0.1:8545')
  .option("-v, --value [value]", 'Amount of ether to deposit', "32")
  .option("-c, --contract [contract]", 'Address of deposit contract', defaults.depositContract.address)
  .action(async ({privateKey, mnemonic, node, value, contract}) => {
      const provider = new ethers.providers.JsonRpcProvider(node);
      const wallets = [];
      if(mnemonic) {
        for (let i=0; i<10; i++) {
          const wallet = Wallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${i}`);
          wallet.connect(provider);
          wallets.push(wallet);
        }
      } else if (privateKey) {
        wallets.push(new Wallet(privateKey, provider))
      } else {
        return logger.error('You have to submit either privateKey or mnemonic. Check --help');
      }
      wallets.forEach(async wallet => {
        try {
          const hash = await (new Eth1Wallet(wallet.privateKey, provider))
            .createValidatorDeposit(contract, ethers.utils.parseEther(value));
          logger.info(`Successfully deposited ${value} ETH from ${wallet.address} to deposit contract. Tx hash: ${hash}`);
        } catch (e) {
          logger.error(`Failed to make deposit for account ${wallet.address}. Reason: ${e.message}`);
        }
      });
  });

program.on('command:*', function () {
  console.error('Invalid command: %s \n', program.args.join(' '));
  program.help();
});

// CLI ends after being parsed
program.parse(process.argv);

// This catches all other statements
if (!program.args.length) program.help();


