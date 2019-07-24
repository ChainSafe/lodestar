import Benchmark from "benchmark";
import { appendReport } from "../utils";

const suite = new Benchmark.Suite;

export const bench = (file: string) => {
  // add tests
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
  // add listeners
  .on('cycle', (event) => {
    appendReport(file, String(event.target));
  })
  // Scoping issue requires function decleration
  .on('complete', function() {
    const msg: string = 'Fastest is ' + this.filter('fastest').map('name');
    appendReport(file, msg, true);
  })
  // run async
  .run({ 'async': true });
}