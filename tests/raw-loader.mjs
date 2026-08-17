import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const isAsset = (specifier) => /\.(csv|yaml|yml)(\?|$)/.test(specifier);

export async function resolve(specifier, context, nextResolve) {
  if (isAsset(specifier)) {
    const clean = specifier.split("?")[0];
    const url = new URL(clean, context.parentURL);
    return { url: `${url.href}?raw`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.includes(".csv") || url.includes(".yaml") || url.includes(".yml")) {
    const fileUrl = url.split("?")[0];
    const source = fs.readFileSync(fileURLToPath(fileUrl), "utf8");
    return { format: "module", source: `export default ${JSON.stringify(source)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
