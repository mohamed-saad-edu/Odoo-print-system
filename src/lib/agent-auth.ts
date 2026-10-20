import { db } from "../db";
import { agents } from "../db/schema";
import { eq } from "drizzle-orm";
import { createHash, createHmac, hkdfSync, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { requireActiveTenantOrNull } from "./tenant-guard";
import { runtimeSecret } from "./runtime-secret";
import { logWarn } from "./log";

/**
 * Public pairing contract shared by Gateway, Go agent and Tauri manager.
 * 32-character unambiguous alphabet; excludes O/I and 0/1.
 */
export const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PAIRING_CODE_LENGTH = 6;
export const PAIRING_CODE_PATTERN = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`);

export const AGENT_ID_PATTERN = /^agt_[A-Za-z0-9_-]{8}$/;

export function isValidAgentId(value: unknown): value is string {
  return typeof value === "string" && AGENT_ID_PATTERN.test(value);
}

/**
 * Agent credentials and Odoo API keys are 192/256-bit random values, so a
 * single-pass fast hash is the correct storage form: there is no dictionary
 * to attack and no work factor worth paying for. Only the pairing code is
 * low-entropy (6 characters over a 32-symbol alphabet ≈ 30 bits), and it is
 * the one credential here that a database leak could be brute-forced
 * offline. It is therefore stored as a keyed hash so a leaked database row
 * cannot be reversed without the deployment secret.
 */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

const PAIRING_CODE_PEPPER_INFO = "yaseir/agent-pairing-code/v1";
const PAIRING_CODE_PEPPER_SALT = "yaseir-gateway";

let pairingCodePepperWarned = false;

function pairingCodePepperKey(): Buffer | null {
  const secret = runtimeSecret("GATEWAY_JWT_SECRET");
  // Production startup already refuses to boot without a real
  // GATEWAY_JWT_SECRET. Outside production the pepper is optional: the
  // pairing code keeps its previous plain hash so local development and
  // existing installations are unaffected.
  if (!secret || secret.length < 32) {
    if (!pairingCodePepperWarned) {
      pairingCodePepperWarned = true;
      logWarn("agent.pairing_code_unpeppered", {
        message: "GATEWAY_JWT_SECRET is not configured; pairing codes are stored without a server-side pepper. Configure it in production.",
      });
    }
    return null;
  }
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.from(PAIRING_CODE_PEPPER_SALT, "utf8"), Buffer.from(PAIRING_CODE_PEPPER_INFO, "utf8"), 32),
  );
}

export function hashPairingCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  const pepper = pairingCodePepperKey();
  if (!pepper) return createHash("sha256").update(normalized).digest("hex");
  return createHmac("sha256", pepper).update(normalized).digest("hex");
}

export function generateSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function generatePairingCode(): string {
  let code = "";
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_CODE_ALPHABET[randomInt(0, PAIRING_CODE_ALPHABET.length)];
  }
  return code;
}

export function isValidPairingCode(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toUpperCase();
  if (normalized.length !== PAIRING_CODE_LENGTH) return false;
  for (const char of normalized) {
    if (!PAIRING_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

export async function validateAgent(authHeader: string | null) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);
  const separatorIndex = token.indexOf(":");
  if (separatorIndex === -1) return null;

  const agentId = token.slice(0, separatorIndex);
  const secret = token.slice(separatorIndex + 1);
  if (!agentId || !secret) return null;
  // Validate canonical Gateway Agent ID format: agt_ prefix plus 8 Base64URL characters.
  if (!isValidAgentId(agentId)) return null;

  const agent = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!agent || !agent.secret || agent.lifecycle !== "active") return null;

  const providedHash = hashSecret(secret);
  if (!timingSafeStringEqual(agent.secret, providedHash)) return null;
  const tenantLifecycle = await requireActiveTenantOrNull(agent.tenantId);
  if (!tenantLifecycle) return null;
  return agent;
}
