import sinon from "sinon";
import {Logger} from "@lodestar/utils";

export const createStubbedLogger = (): Logger => ({
  debug: sinon.stub(),
  info: sinon.stub(),
  error: sinon.stub(),
  warn: sinon.stub(),
  verbose: sinon.stub(),
  child: sinon.stub(),
});
