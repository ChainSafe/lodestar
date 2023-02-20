import {InterchangeCompleteV4} from "./completeV4.js";
import {InterchangeV5} from "./v5.js";

export type InterchangeFormat = {
  v4: InterchangeCompleteV4;
  v5: InterchangeV5;
};
