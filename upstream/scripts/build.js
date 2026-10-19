"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const root = path.resolve(__dirname, "..");
const srcRoot = path.join(root, "src");
const outRoot = path.resolve(root, process.argv[2] || "dist");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const sources = walk(srcRoot).filter((file) => file.endsWith(".ts"));
const checkRoot = fs.mkdtempSync(path.join(require("os").tmpdir(), "dsh-ts-check-"));
try {
  childProcess.execFileSync("tsc", ["--project", path.join(root, "tsconfig.json"), "--outDir", checkRoot], {
    cwd: root,
    stdio: "pipe",
  });
} finally {
  fs.rmSync(checkRoot, { recursive: true, force: true });
}
for (const sourcePath of sources) {
  const source = fs.readFileSync(sourcePath, "utf8");
  const relative = path.relative(srcRoot, sourcePath).replace(/\.ts$/, ".js");
  const outputPath = path.join(outRoot, relative);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, source);
}

console.log(`Built ${sources.length} TypeScript modules into ${outRoot}`);
