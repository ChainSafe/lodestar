import {IInterchangeCompleteV4} from "./completeV4.js";
import {IInterchangeV5} from "./v5.js";

export type InterchangeFormat = {
  v4: IInterchangeCompleteV4;
  v5: IInterchangeV5;
};
