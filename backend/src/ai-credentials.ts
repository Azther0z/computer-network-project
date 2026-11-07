type Credentials = { accountId?: string; token?: string };

const metadataUrl =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const secretVersionPattern =
  /^projects\/[a-zA-Z0-9_-]+\/secrets\/[a-zA-Z0-9_-]+\/versions\/[1-9][0-9]*$/;

/** GCE runtime access only: no service-account keys, secret files, or build-time token injection. */
export async function loadAiCredentials(
  env: NodeJS.ProcessEnv = process.env,
  request: typeof fetch = fetch,
): Promise<Credentials> {
  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const version = env.CLOUDFLARE_TOKEN_SECRET_VERSION;
  if (!version) {
    return { accountId, token: env.CLOUDFLARE_AUTH_TOKEN ?? env.CLOUDFLARE_API_TOKEN };
  }
  // An explicitly configured cloud secret never falls back to a raw environment token.
  if (!secretVersionPattern.test(version) || !accountId || !/^[a-f0-9]{32}$/i.test(accountId)) {
    return { accountId };
  }
  try {
    const signal = AbortSignal.timeout(5_000);
    const identity = await request(metadataUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
      redirect: 'error',
      signal,
    });
    if (!identity.ok || identity.headers.get('Metadata-Flavor') !== 'Google') {
      return { accountId };
    }
    const authentication = (await identity.json()) as { access_token?: unknown };
    if (typeof authentication.access_token !== 'string' || !authentication.access_token) {
      return { accountId };
    }
    const response = await request(`https://secretmanager.googleapis.com/v1/${version}:access`, {
      headers: { Authorization: `Bearer ${authentication.access_token}` },
      redirect: 'error',
      signal,
    });
    if (!response.ok) {
      return { accountId };
    }
    const body = (await response.json()) as { payload?: { data?: unknown } };
    const encoded = body?.payload?.data;
    if (
      typeof encoded !== 'string' ||
      !encoded ||
      encoded.length > 90_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)
    ) {
      return { accountId };
    }
    const token = new TextDecoder('utf-8', { fatal: true })
      .decode(Buffer.from(encoded, 'base64'))
      .trim();
    return token ? { accountId, token } : { accountId };
  } catch {
    // IAM, metadata, network, and payload errors disable AI without exposing upstream details.
    return { accountId };
  }
}
