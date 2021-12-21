import fs from "fs";
// import {load} from "js-yaml";
const filename = "./keyPairs.txt";
try {
  const data = fs.readFileSync(filename, {encoding: "utf8", flag: "r"}).split("\n");
//   const newData = data.map((item) => item.split(","));
  const publicKeys = data.map((item) => item.split(",")[0]);
  console.log(publicKeys);
} catch (err) {
  const result = (err as Error).message;
  console.log(result);
  if (result === `EACCES: permission denied, open '${filename}'`) {
    console.log("true");
  }
}

// type YourType = {
//   pubkey1: string;
//   pubkey2: string;
// };

// const abc = async (): Promise<void> => {
//   fs.chmod("s.yaml", 0, function () {
//     console.log("DONE");
//   });
//   await new Promise((r) => setTimeout(r, 2000));
//   try {
//     const file = readFileSync("s.yaml", "utf8");
//     const yaml = load(file) as YourType;
//     console.log(yaml.pubkey1.split(","));
//   } catch (error) {
//     console.log(`${error}`);
//     // console.log(error);
//   }
// };

// // // eslint-disable-next-line @typescript-eslint/no-floating-promises
// // abc().then(() => {
// //   fs.chmod("s.yaml", 777, function () {
// //     console.log("DONE");
// //   });
// // });
