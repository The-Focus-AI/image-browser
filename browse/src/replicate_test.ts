import Replicate from "replicate";
const replicate = new Replicate();

// const input = {
//     image: "https://replicate.delivery/pbxt/JLoGhBbZQQUR9tvNyUJTWQ9pVWC1aLbXscLNHieuAf0c0eE6/banksy_star_wars--id_86e4d693-12e1-4b58-a9d2-bb404a4df835.jpeg"
// };

const input = {text: "cat photo"};

const output = await replicate.run("krthr/clip-embeddings:1c0371070cb827ec3c7f2f28adcdde54b50dcd239aa6faea0bc98b174ef03fb4", { input });

console.log("output dimension: ", ((output as any)["embedding"] as number[]).length)
console.log(output)
//=> {"embedding":[1.0652785301208496,-0.24157510697841644,-0....