// Diagnostic protocol/operation model safety regressions. The live UI still
// has legacy diagnostic actions: verify their request fencing separately.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as model from '../src/shared/diagnostic-test.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const good = (status='queued', id='printer1', extras={}) => ({ok:true,jobId:`job-${id}`,printerId:id,status,...extras});

test('Gateway diagnostic POST requires a stable operation key', () => {
  const dashboard = read('src/app/dashboard/dashboard-client.tsx');
  const send = dashboard.slice(dashboard.indexOf('async function sendGatewayTestPage('), dashboard.indexOf('/* ---------- Local presentational helpers ---------- */'));
  assert.match(send, /"Idempotency-Key": operationKey/);
  assert.match(send, /decodeDiagnosticResult\(body, printerId\)/);
});

test('strict decoder rejects malformed2xx and wrong printer/status/optional fields',()=>{
  for(const value of [null,{},[],{ok:false}, {ok:true,printerId:'printer1',status:'queued'},
    good('bogus'),good('queued','elsewhere'),good('queued','printer1',{jobId:'   '}),
    good('queued','printer1',{virtualCapture:'yes'}),good('queued','printer1',{virtualCapture:true}),good('queued','printer1',{isReused:1}),
    good('failed','printer1',{physicalOutcome:'maybe'})]){
      assert.throws(()=>model.decodeDiagnosticResult(value,'printer1'),model.InvalidDiagnosticResponse);
    }
    assert.equal(model.decodeDiagnosticResult(good('queued','printer1',{isReused:true}),'printer1').isReused,true);
});

test('valid terminal outcomes must not be announced as newly queued or guaranteed paper',()=>{
  for(const [status,outcome,key] of [
    ['queued',undefined,'diagnostic.queued'],['claimed',undefined,'diagnostic.inProgress'],
    ['printing',undefined,'diagnostic.inProgress'],['success','unknown','diagnostic.delivered'],
    ['failed',undefined,'diagnostic.unverified'],['failed','not_printed','diagnostic.failed'],
    ['expired','not_printed','diagnostic.expired'],['expired','unknown','diagnostic.unverified'],
    ['success','printed','diagnostic.delivered'],
  ]){
    assert.equal(model.diagnosticMessageKey(model.decodeDiagnosticResult(good(status,'printer1',{physicalOutcome:outcome}),'printer1')),key);
  }
  assert.throws(()=>model.decodeDiagnosticResult(good('success','printer1',{virtualCapture:true}),'printer1'),model.InvalidDiagnosticResponse);
  assert.equal(model.diagnosticIsInProgress(model.decodeDiagnosticResult(good('queued'),'printer1')),true);
  assert.equal(model.diagnosticIsInProgress(model.decodeDiagnosticResult(good('success'),'printer1')),false);
});

test('model owns one synchronous identity, retains ambiguous key and fences origins/actors',()=>{
  let seq=0;const ops=new model.DiagnosticOperations(()=>`operation-key-${++seq}`);
  const a=model.diagnosticScope('https://host/', 'tenant1:user1','p1');
  const b=model.diagnosticScope('https://host','tenant1:user1','p2');
  const c=model.diagnosticScope('https://host','tenant2:user2','p1');
  const d=model.diagnosticScope('https://other','tenant1:user1','p1');
  const first=ops.begin(a);
  assert.equal(ops.begin(a),null);
  ops.uncertain(a); assert.equal(ops.begin(a),first);
  assert.equal(ops.confirmRepeat(a),false);
  ops.accept(a,model.decodeDiagnosticResult(good(),'printer1')); // printer evidence bound to scope by caller
  assert.equal(ops.observed(a)?.jobId,'job-printer1');
  assert.equal(ops.confirmRepeat(a),true);
  assert.notEqual(ops.begin(a),first);
  ops.uncertain(a);
  for (const scope of [b,c,d]) { const key=ops.begin(scope); assert.notEqual(key,first); ops.uncertain(scope); }
});

