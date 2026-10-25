import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = (path) => readFileSync(path, 'utf8');

// Production regression contracts: a platform owner can see security-relevant
// Gateway integrations without exposing credentials or bypassing tenant fences.
test('platform integrations list authenticates and never projects credential material', () => {
  const path = 'src/app/api/platform/integrations/route.ts';
  assert.ok(existsSync(path), 'gateway integrations inventory endpoint is missing');
  const source = read(path);
  assert.match(source, /requirePlatformOwner/);
  assert.match(source, /queryWithTimeout/);
  assert.match(source, /tenantId/);
  assert.match(source, /Cache-Control.*no-store/);
  assert.doesNotMatch(source, /hashedKey\s*:/);
  assert.doesNotMatch(source, /secretHash\s*:/);
  assert.match(source, /odooInstallations/);
  assert.match(source, /apiKeys/);
});

test('platform key emergency revoke uses transactional actor recheck, tenant-scoped CAS, and audit', () => {
  const path = 'src/app/api/platform/integrations/revoke/route.ts';
  assert.ok(existsSync(path), 'audited emergency key revoke endpoint is missing');
  const source = read(path);
  assert.match(source, /requirePlatformOwner/);
  assert.match(source, /requirePlatformActorInTransaction/);
  assert.match(source, /writeAuditEvent/);
  assert.match(source, /for\("update"\)|FOR UPDATE/);
  assert.match(source, /tenantId/);
  assert.match(source, /revokedAt/);
  assert.match(source, /reason/);
  assert.doesNotMatch(source, /hashedKey\s*:/);
});

test('Odoo installation quarantine prevents unsafe historical replay and requires audit/authority', () => {
  const path = 'src/app/api/platform/integrations/quarantine/route.ts';
  assert.ok(existsSync(path), 'platform installation quarantine is missing');
  const source = read(path);
  assert.match(source, /requirePlatformOwner/);
  assert.match(source, /requirePlatformActorInTransaction/);
  assert.match(source, /writeAuditEvent/);
  assert.match(source, /tenantId/);
  assert.match(source, /enabled/);
  assert.match(source, /reason/);
  assert.doesNotMatch(source, /secretHash\s*:/);
});

test('integrations are real navigable operational controls, not sample UI actions', () => {
  const path = 'src/app/platform/integrations/page.tsx';
  assert.ok(existsSync(path), 'platform integration operations page is missing');
  const ui = read(path);
  const nav = read('src/app/platform/layout.tsx');
  assert.match(nav, /\/platform\/operations/);
  assert.match(read('src/app/platform/operations/page.tsx'), /integrations/);
  assert.match(ui, /\/api\/platform\/integrations/);
  assert.match(ui, /reason/);
  assert.match(ui, /endpoint = selected\.kind === "keys" \? "revoke"/);
  assert.match(ui, /"quarantine"/);
});

test('platform overview displays live API-backed operational metrics, not retired charts', () => {
  const code = read('src/app/platform/dashboard/page.tsx');
  assert.match(code, /adminJson\('\/api\/platform\/stats'\)/);
  assert.match(code, /data\.logicalUsage\[k\]/);
  assert.match(code, /data\.verifiedPrinters/);
  assert.doesNotMatch(code, /overview-charts/);
});

test('Gateway database documentation required by CI remains checked in', () => {
  assert.ok(existsSync('docs/DATABASE.md'));
});

test('emergency key revoke also extinguishes live read-only rotation grace', () => {
  const route = read('src/app/api/platform/integrations/revoke/route.ts');
  const inventory = read('src/app/api/platform/integrations/route.ts');
  const ui = read('src/app/platform/integrations/page.tsx');
  // Rotation sets revoked_at AND read_only_until; a revoke that refuses
  // all revoked rows leaves the grace credential authorized for reads.
  assert.doesNotMatch(route, /if \(rows\[0\]\.revokedAt\) return/);
  assert.match(route, /rows\[0\]\.readOnlyUntil/);
  assert.match(route, /isNotNull\(apiKeys\.readOnlyUntil\)/);
  assert.match(route, /readOnlyUntil:\s*null/);
  assert.match(inventory, /gt\(apiKeys\.readOnlyUntil,/);
  assert.match(inventory, /readOnlyGrace|graceActive/);
  assert.match(ui, /readOnlyGrace|graceActive/);
});

test('integration inventory describes historical read-only grace correctly', () => {
  const inventory = read('src/app/api/platform/integrations/route.ts');
  const ui = read('src/app/platform/integrations/page.tsx');
  assert.match(inventory, /clock_timestamp\(\)/);
  assert.match(ui, /readOnlyGrace|graceActive/);
  assert.match(ui, /Legacy v1|legacy v1|v1 القديم/);
});

test('platform print operations offers a payload-free diagnostic detail view', () => {
  const ui = read('src/app/platform/jobs/page.tsx');
  assert.match(ui, /<Modal\s+open=\{selectedJob !== null\}/);
  assert.match(ui, /deliveryAttempts/);
  assert.match(ui, /physicalOutcome/);
  assert.match(ui, /claimedAt/);
  assert.match(ui, /ackedAt/);
  assert.match(ui, /requestedBy/);
  assert.doesNotMatch(ui, /job\.payload|job\.fileContent|rawDocument/i);
});
