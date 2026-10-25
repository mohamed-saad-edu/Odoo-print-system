import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (path) => readFileSync(join(root, path), 'utf8');
const compose = load('docker-compose.yml');
const ciCompose = load('docker-compose.ci.yml');
const dockerfile = load('Dockerfile');
const workflow = load('.github/workflows/docker.yml');
const ci = load('.github/workflows/ci.yml');
const resilience = load('.github/workflows/security-supply-chain.yml');
const postgresHelper = load('scripts/ci-postgres.sh');
const mirrorPrefix = 'public.ecr.aws/docker/library/';

function officialMirrorOf(image) {
  // Every official image must name a stable release AND an immutable digest.
  assert.match(image, /^[a-z][a-z0-9-]*:[a-z0-9.\-]+@sha256:[a-f0-9]{64}$/);
  return mirrorPrefix + image;
}
function imageAfter(source, key) {
  const regex = new RegExp(`(?:^|\\n)\\s*${key}:\\s*([^\\s#]+)`);
  const match = source.match(regex);
  assert.ok(match, `image ${key} must exist`);
  return match[1];
}

const secure = load('Dockerfile.secure-images');
const prodPostgres = secure.match(/^ARG POSTGRES_BASE=(postgres:[^\s#]+)$/m)?.[1];
const prodCaddy = secure.match(/^ARG CADDY_BASE=(caddy:[^\s#]+)$/m)?.[1];
const prodNode = dockerfile.match(/^ARG NODE_BASE_IMAGE=(node:[^\s#]+)$/m)?.[1];
assert.ok(prodCaddy && prodNode);

test('Docker CI uses the same sha256-pinned Official Images as production', () => {
  assert.ok(compose.includes('target: postgres'));
  assert.ok(compose.includes('target: caddy'));
  assert.ok(compose.includes('dockerfile: Dockerfile.secure-images'));
  assert.ok(secure.includes('FROM ${POSTGRES_BASE} AS postgres'));
  assert.ok(secure.includes('FROM ${CADDY_BASE} AS caddy'));
  assert.ok(secure.includes('go1.26.10'));
  assert.match(load('docs/runtime-hardening/caddy/go.mod'), /golang\.org\/x\/net v0\.61\.0(?:\s|$)/);
  assert.ok(secure.includes('go build -mod=readonly -trimpath'));
  assert.equal(ciCompose.split(`NODE_BASE_IMAGE: ${prodNode}`).length - 1, 2);
  assert.equal((dockerfile.match(/^FROM \$\{NODE_BASE_IMAGE\} AS /gm) ?? []).length, 3);
  assert.ok(postgresHelper.includes(officialMirrorOf(prodPostgres)));
  assert.ok(postgresHelper.includes('docker.io/library/' + prodPostgres));
  assert.ok(!ci.includes('    services:\\n      postgres:'));
  assert.ok(!resilience.includes('    services:\\n      postgres:'));
  assert.doesNotMatch(ci, /^    env:\n          POSTGRES_USER:/m);
  assert.doesNotMatch(resilience, /^    env:\n          POSTGRES_USER:/m);
  assert.equal(ci.split('run: bash scripts/ci-postgres.sh start').length - 1, 2);
  assert.equal(ci.split('run: bash scripts/ci-postgres.sh stop').length - 1, 2);
  assert.equal(resilience.split('run: bash scripts/ci-postgres.sh start').length - 1, 1);
  assert.equal(resilience.split('run: bash scripts/ci-postgres.sh stop').length - 1, 1);
  assert.ok(ci.includes('CI_PG_USER: odoo'));
  assert.ok(ci.includes('CI_PG_USER: postgres'));
  assert.ok(resilience.includes('CI_PG_USER: postgres'));
  assert.ok(postgresHelper.includes("127.0.0.1:5432:5432"));
  assert.match(postgresHelper, /if ! grep -Eqi '[^']*toomanyrequests[^']*rate exceeded[^']*429[^']*'/);
});

test('Compose CLI selects the CI overlay without changing default production references', () => {
  assert.match(workflow, /COMPOSE_FILE: docker-compose\.yml:docker-compose\.ci\.yml/);
  assert.match(secure, /^ARG POSTGRES_BASE=postgres:16\.15-alpine@sha256:[0-9a-f]{64}$/m);
  assert.match(secure, /^ARG CADDY_BASE=caddy:2\.11\.7-alpine@sha256:[0-9a-f]{64}$/m);
  assert.match(dockerfile, /^ARG NODE_BASE_IMAGE=node:24\.22\.1-alpine@sha256:[a-f0-9]{64}$/m);
});

test('Odoo CI tests the built hardened runtime by content ID with verified immutable inputs', () => {
  const hardened = load('Dockerfile.odoo-hardened');
  const provenance = JSON.parse(load('docs/runtime-hardening/container-bases.json'));
  for (const [argument, name] of [['ODOO_BASE', 'odoo'], ['PYTHON_BUILD_BASE', 'python']]) {
    const reference = hardened.match(new RegExp(`^ARG ${argument}=(\\S+)$`, 'm'))?.[1];
    assert.ok(reference, `${argument} must be explicit`);
    officialMirrorOf(reference); // Reject mutable tags and missing digests.
    const verified = provenance.images.find(image => image.image === name);
    assert.equal(reference.split('@')[1], verified?.manifestDigest);
    assert.equal(verified?.platform, 'linux/amd64');
    assert.equal(verified?.manifestAndConfigBytesSha256Verified, true);
    assert.ok(hardened.includes(`FROM \${${argument}} AS `));
  }
  assert.ok(hardened.includes('git -C /opt/odoo fetch --depth=1 origin 14f9b8149d5260d92fb74404df09483fb42dd820'));
  assert.ok(hardened.includes('--require-hashes'));
  assert.ok(hardened.includes('apply-odoo19-pdf-bounds.py /opt/odoo'));
  assert.ok(hardened.includes('verify-odoo19-pdf-bounds.py /opt/odoo'));
  assert.ok(ci.includes('--file Dockerfile.odoo-hardened'));
  assert.ok(ci.includes('--iidfile "$RUNNER_TEMP/odoo-hardened.image-id"'));
  assert.ok(ci.includes('odoo_image="$(cat "$RUNNER_TEMP/odoo-hardened.image-id")"'));
  assert.ok(ci.includes('"$odoo_image" \\'));
  assert.ok(ci.includes('--addons-path=/opt/odoo/odoo/addons,/opt/odoo/addons,/opt/yaseir-addons'));
  // Runtime code and dependencies must come from the tested image itself.
  assert.doesNotMatch(ci, /odoo_image="(?:public\.ecr\.aws\/docker\/library\/)?odoo:/);
  assert.doesNotMatch(ci, /-v "\$GITHUB_WORKSPACE\/odoo_addons:/);
  assert.ok(ci.includes('python3 scripts/verify-odoo-test-results.py'));
  assert.ok(ci.includes('--tests-dir odoo_addons/print_gateway/tests'));
  assert.ok(ci.includes('--log /tmp/odoo19_test.log'));
  assert.ok(!ci.includes('Expected at least 80 Odoo addon tests'));
  assert.equal(ci.split('image-ref: ${{ steps.hardened-image.outputs.image_id }}').length - 1, 2);
  assert.ok(ci.includes('output: odoo-hardened.cdx.json'));
  assert.ok(ci.includes('output: odoo-hardened.sarif'));
  // Keep every finding in the exact image SARIF. A separate source-bound,
  // expiring review must reject all new, high-risk and secret findings.
  const scan = ci.split('      - name: Scan the exact tested Odoo image')[1]
    ?.split('      - name: Enforce reviewed Odoo image findings')[0];
  const gate = ci.split('      - name: Enforce reviewed Odoo image findings')[1]
    ?.split('      - name: Retain exact Odoo image evidence')[0];
  assert.ok(scan && gate);
  for (const field of [
    'output: odoo-hardened.sarif',
    'severity: UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL',
    'limit-severities-for-sarif: true',
    'ignore-unfixed: false',
    "exit-code: '0'",
  ]) assert.ok(scan.includes(field), field);
  for (const file of [
    'Dockerfile.odoo-hardened',
    'docs/runtime-hardening/requirements-python312-linux-x86_64.lock',
    'docs/runtime-hardening/build-tools.lock',
  ]) assert.ok(gate.includes('git hash-object ' + file), file);
  assert.ok(gate.includes('scripts/check-trivy-baseline.py odoo-hardened.sarif yaseir-odoo-hardened:review-20261025'));
  const findings = JSON.parse(load('security/image-vulnerability-baseline.json')).images['yaseir-odoo-hardened:review-20261025'].findings;
  assert.equal(findings.length, 72);
  assert.ok(findings.every((row) => row.length === 3 && ['LOW', 'MEDIUM'].includes(row[2])));
});

test('Docker scans the shipped npm-free Gateway runtime and retains upstream advisory evidence', () => {
  assert.ok(workflow.includes('docker build --file Dockerfile --target runtime --tag yaseir-gateway:ci-node24.22.1 .'));
  assert.ok(workflow.includes("test ! -e /usr/local/lib/node_modules/npm"));
  assert.ok(workflow.includes('Scan release image (Trivy)'));
  assert.ok(workflow.includes('trivy-upstream-node.sarif'));
  assert.ok(workflow.includes("image='yaseir-gateway:ci-node24.22.1'"));
  assert.ok(workflow.includes('scripts/check-trivy-baseline.py trivy.sarif "$image"'));
  assert.ok(workflow.includes('POSTGRES_RUNTIME_PASSWORD: ci-only-runtime-'));
  assert.ok(workflow.includes('POSTGRES_OWNER_PASSWORD: ci-only-owner-'));
  const rolePasswords = ["POSTGRES_PASSWORD", "POSTGRES_OWNER_PASSWORD", "POSTGRES_RUNTIME_PASSWORD"]
    .map(key => {
      const match = workflow.match(new RegExp("^  " + key + ": ([^\\s]+)$", "m"));
      assert.ok(match, key + " must be explicit for disposable CI, never inherited from production secrets");
      assert.ok(match[1].length >= 32, key + " must satisfy V4 independent role secret length");
      return match[1];
    });
  assert.equal(new Set(rolePasswords).size, 3, "CI role credentials must be independent");
  assert.ok(workflow.includes('fs.readFileSync("/run/secrets/postgres_runtime_password"'));
  assert.ok(!workflow.includes('const pgPassword = fs.readFileSync("/run/secrets/postgres_password"'));
});

test('Docker CI image references remain immutable and reject mutable tags', () => {
  const ciRefs = [...ciCompose.matchAll(/^\s*NODE_BASE_IMAGE:\s*(\S+)/gm)].map(m => m[1]);
  assert.equal(ciRefs.length, 2);
  for (const image of [prodPostgres, prodCaddy, ...ciRefs]) assert.match(image, /^(?:postgres|caddy|node):[a-z0-9.\-]+@sha256:[a-f0-9]{64}$/);
  assert.throws(() => officialMirrorOf('node:latest'), /sha256/);
});
