import Benchmark from "benchmark";
import { writeReport } from "../utils";

// Initiate the benchmark suite
const suite = new Benchmark.Suite;

const bench = (dir: string) => {

  // Set the function test
  const FUNCTION_NAME = "example"; // PLEASE FILL THIS OUT
  const FILE_TO_WRITE = dir + FUNCTION_NAME;

  // Add tests
  suite
  .add('RegExp#test', () => {
    /o/.test('Hello World!');
  })
  .add('String#indexOf', () => {
    'Hello World!'.indexOf('o') > -1;
  })
  .add('String#indexOf', () => {
    'Helldd World!'.indexOf('o') > -1;
  })

  // EVERYTHING BELOW IS COOKIE CUTTER
  // add listeners
  .on('cycle', (event) => {
    writeReport(FILE_TO_WRITE, String(event.target));
  })
  // Scoping issue requires function decleration
  .on('complete', function() {
    const msg: string = 'Fastest is ' + this.filter('fastest').map('name');
    writeReport(FILE_TO_WRITE, msg);
  })
  // run async
  .run({ 'async': true });
}