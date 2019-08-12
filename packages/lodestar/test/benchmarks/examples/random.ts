import Benchmark from "benchmark";
import { writeReport } from "../utils";

// Initiate the benchmark suite
const suite = new Benchmark.Suite;

export interface BenchSuite {
  suite: Benchmark.Suite;
  file: string;
}

export const bench = (dir: string): BenchSuite => {

  // Set the function test
  const FUNCTION_NAME = "example"; // PLEASE FILL THIS OUT

  // Add tests
  const tests = suite
  .add('RegExp#test', () => {
    /o/.test('Hello World!');
  })
  .add('String#indexOf', () => {
    'Hello World!'.indexOf('o') > -1;
  })
  .add('String#indexOf', () => {
    'Helldd World!'.indexOf('o') > -1;
  })

  return {
    suite: tests,
    file: dir + FUNCTION_NAME + ".txt"
  }
}