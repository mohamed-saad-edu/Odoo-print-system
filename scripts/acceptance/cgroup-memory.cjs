/* Test-only memory probe support for cgroup v2, v1 and ordinary hosts. */
"use strict";
const fs = require("node:fs");

const MEMORY_PATHS = Object.freeze([
  "/sys/fs/cgroup/memory.current", // unified cgroup v2
  "/sys/fs/cgroup/memory/memory.usage_in_bytes", // legacy cgroup v1
]);

function readCgroupMemoryBytes(readFile = fs.readFileSync) {
  for (const file of MEMORY_PATHS) {
    try {
      const raw = readFile(file, "utf8").trim();
      if (!/^\\d+$/.test(raw)) continue;
      const bytes = Number(raw);
      if (Number.isSafeInteger(bytes) && bytes >= 0) return bytes;
    } catch (error) {
      // A CI runner can have /proc but no mounted or readable memory cgroup.
      // No memory metric must ever crash Gateway or its test harness.
      if (!["ENOENT", "ENOTDIR", "EPERM", "EACCES"].includes(error?.code)) throw error;
    }
  }
  return null;
}

module.exports = { readCgroupMemoryBytes };
