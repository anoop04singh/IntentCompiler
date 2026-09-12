import { resolve } from "node:path";
import { usdc } from "../examples/usdc.js";
import { generateProject, writeProject } from "../src/compiler.js";
import { validateDefinition } from "../src/spec.js";
const root = resolve("builds/example-usdc");
await writeProject(root, generateProject(validateDefinition(usdc)));
console.log(
  `Generated example at ${root}. This does not deploy or spend funds.`,
);
