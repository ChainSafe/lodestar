import sinon, {SinonSandbox, SinonStubbedInstance} from "sinon";
import {LoggerNode} from "@lodestar/logger/node";

export const createStubbedLogger = (sandbox?: SinonSandbox): LoggerNode & SinonStubbedInstance<LoggerNode> => {
  sandbox = sandbox ?? sinon;
  return {
    debug: sandbox.stub(),
    info: sandbox.stub(),
    error: sandbox.stub(),
    warn: sandbox.stub(),
    verbose: sandbox.stub(),
    child: sandbox.stub(),
    toOpts: sandbox.stub(),
  } as unknown as LoggerNode & SinonStubbedInstance<LoggerNode>;
};
