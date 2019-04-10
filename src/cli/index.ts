// NOTE :: All commands are stubbed as examples
// Useful repo https://github.com/tsantef/commander-starter
import program from "commander";
import {PrivateEth1Network} from "../eth1/dev/network";

program
  .version('0.0.1');

program
  .command('dev')
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
  .option("-k, --privateKey [privateKey]", 'Private key of account that will deposit 32 ETH')
  .option("-p, --seed [seed]", 'If seed is submitted, first 10 accounts will deposit 32 ETH')
  .option("-h, --host [host]", 'Host on which eth node is running', '127.0.0.1')
  .option("-p, --port [host]", 'Port on which eth node is running', 8545)
  .action(({privateKey, seed, port, host}) => {

  });

program.on('command:*', function () {
  console.error('Invalid command: %s \n', program.args.join(' '));
  program.help();
});

// CLI ends after being parsed
program.parse(process.argv);

// This catches all other statements
if (!program.args.length) program.help();


