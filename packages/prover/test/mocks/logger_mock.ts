import sinon from "sinon";
import {LogLevel, Logger} from "@lodestar/utils";

export const createMockLogger = (logLevel: LogLevel = LogLevel.info): Logger => ({
  info: sinon.stub(),
  error: sinon.stub(),
  warn: sinon.stub(),
  debug: sinon.stub(),
  verbose: sinon.stub(),
  child: () => createMockLogger(logLevel),
});
