import {generateState} from "../utils/state.js";

beforeAll(() => {
  // this is the 1st test to run, it sets up the cached tree-backed beacon state
  generateState();
});
