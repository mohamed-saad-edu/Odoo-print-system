-- 0107: invalidate pending pairing codes minted before the pepper (v3).
-- Forward-only, backward-compatible, safe to apply in either order with
-- the companion code change (src/lib/agent-auth.ts: hashPairingCode now
-- refuses to mint or verify without a >=32-char GATEWAY_JWT_SECRET pepper).
--
-- Why invalidation, not conversion: drizzle/0022 hashed unexpired codes
-- with plain SHA-256, and plain hashes are indistinguishable from HMAC
-- hashes (both 64 hex chars) and cannot be re-hashed without the plaintext.
-- Pending codes live only 10 minutes, so blanket invalidation is safe:
-- operators reissue codes for agents not yet paired. Secret rotation
-- invalidates all pending codes by design (the pepper is HKDF-derived
-- from GATEWAY_JWT_SECRET); document reissue as the rotation procedure.
-- Expired codes are also cleared: they cannot authenticate, but they
-- permanently occupy the partial unique index on pairing_code_hash.
UPDATE agents
SET pairing_code_hash = NULL, pairing_code_expires_at = NULL
WHERE pairing_code_hash IS NOT NULL;
