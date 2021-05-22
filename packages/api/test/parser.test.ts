import {compileRouteUrlFormater} from "../src/utils/urlFormat";

describe("route parse", () => {
  it("/eth/v1/validator/:name/attester/:epoch", () => {
    const path = "/eth/v1/validator/:name/attester/:epoch";
    const args = {epoch: 5, name: "HEAD"};

    console.time("compile");
    for (let i = 0; i < 1e6; i++) {
      compileRouteUrlFormater(path);
    }
    console.timeEnd("compile");

    const fn = compileRouteUrlFormater(path);

    console.log(fn(args));

    console.time("execute");
    for (let i = 0; i < 1e6; i++) {
      fn(args);
    }
    console.timeEnd("execute");

    console.time("execute-template");
    for (let i = 0; i < 1e6; i++) {
      const a = `/eth/v1/validator/${args.name}/attester/${args.epoch}`;
    }
    console.timeEnd("execute-template");
  });
});
