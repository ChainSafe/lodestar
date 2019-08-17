import {BenchSuite} from "@chainsafe/benchmark-utils";


export const bench = (dir: string): BenchSuite => {

  // Set the function test
  const FUNCTION_NAME = "example"; // PLEASE FILL THIS OUT

  const regExp = () => {
    /o/.test('Hello World!');
  };

  const indexOf = () => {
    'Hello World!'.indexOf('o') > -1;
  };

  return {
    testFunctions: [regExp, indexOf],
    file: dir + FUNCTION_NAME + ".txt"
  };
};