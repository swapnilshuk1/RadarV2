import { GoogleAuth } from 'google-auth-library';

/** Standard ADC discovery: local users, service accounts, federation and metadata. */
export function adcTokenProvider(auth: Pick<GoogleAuth, 'getAccessToken'> = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
})) {
  let pending: Promise<string> | undefined;
  return () => {
    // The SDK owns expiry/refresh; coalesce simultaneous section requests.
    pending ??= auth.getAccessToken().then(token => {
      if (!token) throw new Error('ADC returned no access token');
      return token;
    }).catch(() => { throw new Error('Google ADC authentication unavailable'); })
      .finally(() => { pending = undefined; });
    return pending;
  };
}
