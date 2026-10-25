import { derivePhysicalOutcome } from "./job-status";

export interface FileOutputEvidence extends Record<string, unknown> {
  output_medium: "file";
  artifact_id: string;
  sha256: string;
  page_count: number;
  bytes: number;
}
export function validateFileOutputEvidence(value: unknown): FileOutputEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 5 || Object.keys(row).some(key => !["output_medium", "artifact_id", "sha256", "page_count", "bytes"].includes(key))
      || row.output_medium !== "file" || typeof row.artifact_id !== "string" || row.artifact_id !== row.artifact_id.trim() || !/^[A-Za-z0-9_-]{1,128}$/.test(row.artifact_id)
      || typeof row.sha256 !== "string" || row.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(row.sha256)
      || typeof row.page_count !== "number" || !Number.isSafeInteger(row.page_count) || row.page_count < 1 || row.page_count > 10000
      || typeof row.bytes !== "number" || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 64 * 1024 * 1024) return null;
  return { output_medium: "file", artifact_id: row.artifact_id, sha256: row.sha256, page_count: row.page_count, bytes: row.bytes };
}
export function sameFileOutputEvidence(a: unknown, b: unknown): boolean {
  const first = validateFileOutputEvidence(a), second = validateFileOutputEvidence(b);
  return Boolean(first && second && JSON.stringify(first) === JSON.stringify(second));
}
export function printOutputPresentation(row: { status: string; error?: string | null; outputMedium?: string | null; outputEvidence?: unknown }) {
  if (row.outputMedium !== "file") return { outputMedium: "physical" as const, physicalOutcome: derivePhysicalOutcome(row.status, row.error), outputEvidence: null };
  const evidence = row.status === "success" ? validateFileOutputEvidence(row.outputEvidence) : null;
  return { outputMedium: "file" as const, physicalOutcome: "unknown" as const, outputEvidence: evidence,
    outputOutcome: evidence ? "file_created" as const : row.status === "queued" ? "pending" as const
      : derivePhysicalOutcome(row.status, row.error) === "not_printed" ? "not_created" as const : "unknown" as const };
}
