const STS = "https://sts.googleapis.com/v1/token";
const IAM = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts";
const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const LIFETIME = "300s";
const MAX_TOKEN = 8192;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export const ACCOUNT = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
export const AUDIENCE = /^\/\/iam\.googleapis\.com\/projects\/\d{1,20}\/locations\/global\/workloadIdentityPools\/[a-z0-9-]{4,32}\/providers\/[a-z0-9-]{4,32}$/;

const text = (value) => (typeof value === "string" ? value.trim() : "");
const tokenOk = (value) => typeof value === "string" && value.length > 0 && value.length <= MAX_TOKEN && !/\s/.test(value);

export function oidcToken(header) {
  return [text(header), text(process.env.VERCEL_OIDC_TOKEN)].find((token) => token.length <= MAX_TOKEN && JWT.test(token)) || "";
}

export async function call(url, init, ms) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    const body = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

export async function accessToken({ audience, account }, oidc, scope, ms) {
  const exchanged = await call(
    STS,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        audience,
        scope: CLOUD_SCOPE,
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        subject_token: oidc,
      }).toString(),
    },
    ms,
  );
  const federated = exchanged.body && exchanged.body.access_token;
  if (!exchanged.ok || !tokenOk(federated)) return { stage: "sts", status: exchanged.status };
  const issued = await call(
    `${IAM}/${account}:generateAccessToken`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${federated}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ scope: [scope], lifetime: LIFETIME }),
    },
    ms,
  );
  const token = issued.body && issued.body.accessToken;
  if (!issued.ok || !tokenOk(token)) return { stage: "iam", status: issued.status };
  return { token };
}
