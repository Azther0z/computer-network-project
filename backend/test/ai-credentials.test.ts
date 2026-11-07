import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAiCredentials } from '../src/ai-credentials.js';

const version = 'projects/synthetic-project/secrets/ai-token/versions/7';
const accountId = '0'.repeat(32);
const env = { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_TOKEN_SECRET_VERSION: version };
const identity = () =>
  Response.json(
    { access_token: 'synthetic-metadata-token' },
    {
      headers: { 'Metadata-Flavor': 'Google' },
    },
  );

test('local configuration makes no metadata or Secret Manager requests', async () => {
  const noNetwork: typeof fetch = async () => {
    throw Error('Unexpected network request');
  };
  assert.deepEqual(await loadAiCredentials({}, noNetwork), {
    accountId: undefined,
    token: undefined,
  });
  assert.deepEqual(
    await loadAiCredentials(
      { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_AUTH_TOKEN: 'synthetic-local-token' },
      noNetwork,
    ),
    { accountId, token: 'synthetic-local-token' },
  );
  assert.deepEqual(
    await loadAiCredentials({ CLOUDFLARE_API_TOKEN: 'synthetic-alias-token' }, noNetwork),
    { accountId: undefined, token: 'synthetic-alias-token' },
  );
});

test('GCE identity reads one pinned secret version into runtime memory', async () => {
  const calls: string[] = [];
  const request: typeof fetch = async (input, options) => {
    const url = String(input);
    calls.push(url);
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal instanceof AbortSignal);
    if (calls.length === 1) {
      assert.equal(
        url,
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      );
      assert.equal(new Headers(options?.headers).get('Metadata-Flavor'), 'Google');
      return identity();
    }
    assert.equal(url, `https://secretmanager.googleapis.com/v1/${version}:access`);
    assert.equal(
      new Headers(options?.headers).get('Authorization'),
      'Bearer synthetic-metadata-token',
    );
    return Response.json({
      payload: { data: Buffer.from('synthetic-runtime-token\n').toString('base64') },
    });
  };
  assert.deepEqual(await loadAiCredentials(env, request), {
    accountId,
    token: 'synthetic-runtime-token',
  });
  assert.equal(calls.length, 2);
});

test('invalid or unpinned resource names cannot redirect credentials or fall back to env tokens', async () => {
  for (const resource of [
    version.replace('/7', '/latest'),
    'https://example.invalid/secret',
    `${version}?redirect=x`,
    '../secret',
  ]) {
    let calls = 0;
    const result = await loadAiCredentials(
      {
        ...env,
        CLOUDFLARE_TOKEN_SECRET_VERSION: resource,
        CLOUDFLARE_AUTH_TOKEN: 'synthetic-fallback',
      },
      async () => {
        calls++;
        return identity();
      },
    );
    assert.deepEqual(result, { accountId });
    assert.equal(calls, 0);
  }
});

test('a secret reference without a valid Cloudflare account does not access Google', async () => {
  for (const accountId of [undefined, '', 'invalid-account']) {
    let calls = 0;
    assert.deepEqual(
      await loadAiCredentials({ ...env, CLOUDFLARE_ACCOUNT_ID: accountId }, async () => {
        calls++;
        return identity();
      }),
      { accountId },
    );
    assert.equal(calls, 0);
  }
});

test('unavailable metadata and secrets disable AI without leaking errors or rejecting startup', async () => {
  const failures: Array<typeof fetch> = [
    async () => {
      throw Error('synthetic private upstream details');
    },
    async () => Response.json({}, { status: 403 }),
    async () => Response.json({ access_token: 'synthetic-untrusted-token' }),
    async () => Response.json({}, { headers: { 'Metadata-Flavor': 'Google' } }),
  ];
  for (const request of failures) {
    assert.deepEqual(await loadAiCredentials(env, request), { accountId });
  }
  for (const secret of [
    Response.json({}, { status: 403 }),
    Response.json({}),
    Response.json({ payload: { data: 'invalid base64!' } }),
    Response.json({ payload: { data: Buffer.from('  ').toString('base64') } }),
    Response.json({ payload: { data: Buffer.from([255]).toString('base64') } }),
  ]) {
    let calls = 0;
    assert.deepEqual(
      await loadAiCredentials(env, async () => (++calls === 1 ? identity() : secret)),
      { accountId },
    );
  }
});
