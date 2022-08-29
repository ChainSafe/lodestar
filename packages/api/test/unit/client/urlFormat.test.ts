import {expect} from "chai";
import {compileRouteUrlFormater} from "../../../src/utils/urlFormat.js";

/* eslint-disable @typescript-eslint/naming-convention */

describe("utils / urlFormat", () => {
  const testCases: {
    urlTemplate: string;
    cases: {
      args: Record<string, string | number>;
      url: string;
    }[];
  }[] = [
    {
      urlTemplate: "/beacon/{var1}/{var2}",
      cases: [{args: {var1: "aaa", var2: "bbb"}, url: "/beacon/aaa/bbb"}],
    },
    {
      urlTemplate: "/beacon/{state_id}/states/{block_id}/root",
      cases: [{args: {state_id: "head", block_id: 1000}, url: "/beacon/head/states/1000/root"}],
    },
  ];

  for (const {urlTemplate, cases} of testCases) {
    it(urlTemplate, () => {
      const utlFormater = compileRouteUrlFormater(urlTemplate);

      for (const [i, {args, url}] of cases.entries()) {
        expect(utlFormater(args)).to.equal(url, `wrong case ${i}`);
      }
    });
  }
});
