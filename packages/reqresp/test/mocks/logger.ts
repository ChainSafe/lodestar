import sinon from "sinon";
import {ILogger} from "@lodestar/utils";

export const createStubbedLogger = (): ILogger => ({
  debug: sinon.stub(),
  info: sinon.stub(),
  error: sinon.stub(),
  warn: sinon.stub(),
  verbose: sinon.stub(),
  child: sinon.stub(),
});
