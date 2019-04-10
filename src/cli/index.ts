// NOTE :: All commands are stubbed as examples
// Useful repo https://github.com/tsantef/commander-starter
import program from "commander";
import {PrivateEth1Network} from "../eth1/dev/network";

program
  .version('0.0.1');

// Below are some useful examples

program
  .command('dev')
  .description('Start private eth1 chain with deposit contract and 10 accounts with balance')
  .option("-p, --port [port]", 'Port on which private network node should start', 8545)
  .option("-h, --host [host]", 'Host on which node will be', '127.0.0.1')
  .option("-n, --network [networkId]", "Id of eth1 chain", 200)
  .option("-d, --database [db_path]", 'Path to database, if specified chain will be initialized from stored point')
  .action(({port, host, network, database}) => {
      new PrivateEth1Network({port, host, networkId: network, db_path:database}).start();
  });

// // Try $ ./bin/lodestar setup
// // Try $ ./bin/lodestar setup foo
// // Try $ ./bin/lodestar setup foo bar
// // Try $ ./bin/lodestar setup foo bar -s
// // Try $ ./bin/lodestar setup foo bar -s next
// program
//   .command('setup [first] [second]')
//   .description('run setup commands for all envs')
//   .option("-s, --setup_mode [mode]", "Which setup mode to use")
//   .action((first, second, options) => {
//     console.log("First: ", first);
//     console.log("Second: ", second);
//     console.log("Flag: ", options.setup_mode)
//   });
//
// // Try $ ./bin/lodestar exec
// // Try $ ./bin/lodestar exec something
// // Try $ ./bin/lodestar exec -e
// // Try $ ./bin/lodestar exec -e else
// // Try $ ./bin/lodestar exec -e else --help
// program
//   .command('exec <cmd>')
//   .alias('ex')
//   .description('execute the given remote cmd')
//   .option("-e, --exec_mode <mode>", "Which exec mode to use")
//   .action((cmd, options) => {
//     console.log("cmd: ", cmd);
//     console.log("Flag: ", options.exec_mode);
//   })
//   .on('--help', () => {
//     console.log('');
//     console.log('Examples:');
//     console.log('');
//     console.log('  $ deploy exec sequential');
//     console.log('  $ deploy exec async');
//   });

program.on('command:*', function () {
  console.error('Invalid command: %s \n', program.args.join(' '));
  program.help();
});

// CLI ends after being parsed
program.parse(process.argv);

// This catches all other statements
if (!program.args.length) program.help();


