import {Endpoints} from "../../../../src/beacon/routes/lodestar.js";
import {GenericServerTestCases} from "../../../utils/genericServerTest.js";

export const testData: GenericServerTestCases<Pick<Endpoints, "getMonitoredValidatorIndices">> = {
  getMonitoredValidatorIndices: {
    args: undefined,
    res: {data: [0, 1, 2, 3, 10, 15, 20]},
  },
};
