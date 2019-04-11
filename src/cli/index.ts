// NOTE :: All commands are stubbed as examples
// Useful repo https://github.com/tsantef/commander-starter
import program from "commander";
import {PrivateEth1Network} from "../eth1/dev/";
import * as commands from "./commands";

program
  .version('0.0.1');

Object.keys(commands)
  .forEach(commandName => {
    new commands[commandName]().register(program);
  });

program.on('command:*', function () {
  console.error('Invalid command: %s \n', program.args.join(' '));
  program.help();
});

// CLI ends after being parsed
program.parse(process.argv);

// This catches all other statements
if (!program.args.length) program.help();


