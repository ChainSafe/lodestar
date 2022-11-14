import {sleep} from "@lodestar/utils";
import {startChildProcess, stopChildProcess} from "./child_process.js";
let status = false;

const cp = await startChildProcess({
  cli: {command: "docker", args: ["run", "--name", "test", "--rm", "nethermind/nethermind"]},
  logs: {stdoutFilePath: "test.log"},
  health: async () => {
    setTimeout(() => {
      status = true;
    }, 5000);

    return status;
  },
});
await stopChildProcess(cp);

let status2 = false;
const cp2 = await startChildProcess({
  cli: {command: "docker", args: ["run", "--name", "test", "--rm", "nethermind/nethermind"]},
  logs: {stdoutFilePath: "test.log"},
  health: async () => {
    setTimeout(() => {
      status2 = true;
    }, 5000);

    return status2;
  },
});
await stopChildProcess(cp2);
await sleep(40000);
