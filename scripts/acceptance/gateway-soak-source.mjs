import { spawn } from "node:child_process";

/** Hash the entire tracked delta without execFileSync's stdout buffer ceiling. */
export async function updateGitDeltaHash(root, digest, args = ["diff", "--binary", "HEAD"]) {
  await new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", bytes => digest.update(bytes));
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`Git source-delta hashing failed (exit ${code})`)));
  });
}
