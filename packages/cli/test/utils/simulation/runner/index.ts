import {Runner, RunnerType} from "../interfaces.js";

export {ChildProcessRunner} from "./ChildProcessRunner.js";
export {DockerRunner} from "./DockerRunner.js";

export const isChildProcessRunner = (
  runner: Runner<RunnerType.ChildProcess> | Runner<RunnerType.Docker>
): runner is Runner<RunnerType.ChildProcess> => runner.type === RunnerType.ChildProcess;

export const isDockerRunner = (
  runner: Runner<RunnerType.ChildProcess> | Runner<RunnerType.Docker>
): runner is Runner<RunnerType.Docker> => runner.type === RunnerType.Docker;
