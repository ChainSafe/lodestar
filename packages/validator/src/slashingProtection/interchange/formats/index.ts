import {IInterchangeCompleteV4} from "./completeV4";
import {IInterchangeV5} from "./v5";

export type InterchangeFormat = {
  V4: IInterchangeCompleteV4;
  V5: IInterchangeV5;
};
