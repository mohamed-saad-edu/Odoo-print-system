import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makeV2OdooKey, makeLegacyOdooKey, parseOdooIdentity, classifyLegacyCollision } from '../src/lib/odoo-idempotency.ts';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
test('legacy identity parity and v2 installation separation', () => {
  assert.equal(makeLegacyOdooKey('7','operation-123'),createHash('sha256').update('odoo:7:operation-123').digest('hex'));
  const keyA = makeV2OdooKey(a, '7', 'operation-123');
  assert.equal(keyA,createHash('sha256').update(JSON.stringify(['yaseir-odoo-v2',a,'7','operation-123'])).digest('hex'));
  assert.notEqual(keyA,makeV2OdooKey(b,'7','operation-123'));
});
test('proof and installation ownership required for versioned submission', () => {
  assert.throws(() => parseOdooIdentity({idempotencyVersion:2, installationId:a, sourceCompanyId:'7',sourceOperationId:'operation-123',idempotencyKey:'x'}));
  assert.throws(() => parseOdooIdentity({idempotencyVersion:2, installationId:'wrong', installationProof:'a'.repeat(43),sourceCompanyId:'7',sourceOperationId:'operation-123',idempotencyKey:'x'}));
  assert.deepEqual(parseOdooIdentity({idempotencyVersion:2,installationId:a,installationProof:'a'.repeat(43),sourceCompanyId:'7',sourceOperationId:'operation-123',idempotencyKey:makeV2OdooKey(a,'7','operation-123')}),{
    version:2, installationId:a, installationProof:'a'.repeat(43), sourceCompanyId:'7', sourceOperationId:'operation-123',legacyKey:makeLegacyOdooKey('7','operation-123'),key:makeV2OdooKey(a,'7','operation-123'),
  });
});
test('v2 operation identity uses UTF-16 code units, not Unicode code points', () => {
  const installationId = a;
  const installationProof = 'p'.repeat(43);
  const sourceCompanyId = '7';
  const goodOperation = '🖨'.repeat(100); // 200 UTF-16 units
  const badOperation = '🖨'.repeat(101); // 202 UTF-16 units
  const good = parseOdooIdentity({
    idempotencyVersion: 2, installationId, installationProof,
    sourceCompanyId, sourceOperationId: goodOperation,
    idempotencyKey: makeV2OdooKey(installationId, sourceCompanyId, goodOperation),
  });
  assert.equal(good.sourceOperationId, goodOperation);
  assert.throws(() => parseOdooIdentity({
    idempotencyVersion: 2, installationId, installationProof,
    sourceCompanyId, sourceOperationId: badOperation,
    idempotencyKey: makeV2OdooKey(installationId, sourceCompanyId, badOperation),
  }), /INVALID_INSTALLATION_IDENTITY/);
});

test('legacy history requires approved resolution and never infers owner from bytes alone', () => {
  assert.equal(classifyLegacyCollision(true,null),'RECONCILIATION_REQUIRED');
  assert.equal(classifyLegacyCollision(true,'reuse'),'reuse');
  assert.equal(classifyLegacyCollision(true,'distinct'),'distinct');
  assert.equal(classifyLegacyCollision(false,null),'clear');
});
