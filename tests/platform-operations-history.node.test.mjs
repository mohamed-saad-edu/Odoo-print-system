import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = path => readFileSync(path, 'utf8');

test('completed print jobs remain listable from durable receipt history in customer and platform views', () => {
  assert.ok(existsSync('src/lib/job-history.ts'), 'a shared history read model is required');
  const model = read('src/lib/job-history.ts');
  assert.match(model, /print_job_receipts/);
  assert.match(model, /print_jobs/);
  assert.match(model, /tenant_id/);
  assert.match(model, /LIMIT\s+\$\{|limit.*offset/is);
  assert.doesNotMatch(model, /SELECT\s+\*/i);
  for (const path of ['src/app/actions.ts', 'src/lib/dashboard-state.ts', 'src/app/api/jobs/route.ts', 'src/app/api/platform/jobs/route.ts']) {
    assert.match(read(path), /listPrintJobHistory/, `no receipt-aware history read in ${path}`);
  }
});

test('platform metrics count both live and archived jobs and disclose the source', () => {
  const stats = read('src/app/api/platform/stats/route.ts');
  assert.match(stats, /print_job_receipts/);
  assert.match(stats, /print_jobs/);
  assert.match(stats, /clock_timestamp\(\)/);
  assert.match(stats, /interval '24 hours'/);
});

test('platform operations are owner-only, read models do not disclose print document payloads', () => {
  for (const file of ['src/app/api/platform/jobs/route.ts','src/app/api/platform/fleet/route.ts']) {
    const src = read(file);
    assert.match(src, /requirePlatformOwner/);
    assert.match(src, /Cache-Control/);
    assert.match(src, /no-store/);
  }
  const history = read('src/lib/job-history.ts');
  assert.doesNotMatch(history, /(?:^|\n)\s*payload\s*:/m);
  assert.doesNotMatch(history, /j\.payload/);
});

test('platform operations appear as real navigable pages and do not offer silent destructive actions', () => {
  for (const page of ['src/app/platform/jobs/page.tsx','src/app/platform/fleet/page.tsx']) assert.ok(existsSync(page), page);
  const nav = read('src/app/platform/layout.tsx');
  assert.match(nav, /\/platform\/operations/);
  const hub=read('src/app/platform/operations/page.tsx');
  assert.match(hub, /'jobs'|\"jobs\"/);
  assert.match(hub, /'fleet'|\"fleet\"/);
  const action = read('src/app/api/platform/fleet/lifecycle/route.ts');
  assert.match(action, /requirePlatformActorInTransaction/);
  assert.match(action, /writeAuditEvent/);
  assert.match(action, /expectedLifecycle/);
});

test('unknown job filters return the same coded 400 contract across tenant and platform routes', () => {
  for (const path of ['src/app/api/jobs/route.ts', 'src/app/api/platform/jobs/route.ts']) {
    const source = read(path);
    assert.match(source, /code: "INVALID_STATUS_FILTER"/);
    assert.match(source, /isJobFilterStatus/);
  }
});
