import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');

test('Queue Pressure uses current live jobs, including open jobs older than 24 hours', () => {
  const stats = read('src/app/api/platform/stats/route.ts');
  const dashboard = read('src/app/platform/dashboard/page.tsx');
  assert.match(stats, /\.from\(printJobs\)\.where\(inArray\(printJobs\.status,\s*\["queued",\s*"claimed",\s*"printing"\]\)\)/, 'live queue must query all open print_jobs by status, without a creation-time filter');
  assert.match(stats, /queueNow:\s*liveQueueStats\[0\]/, 'API must return current queue pressure separately from the historical 24h series');
  assert.match(dashboard, /data\.queueNow\.queued/, 'dashboard must use the live queue for queued pressure');
  assert.match(dashboard, /data\.queueNow\.inFlight/, 'dashboard must use the live queue for in-flight pressure');
  assert.doesNotMatch(dashboard, /queued:\s*stats\?\.jobs24h\.queued/, 'historical jobs cannot masquerade as current backlog');
});
