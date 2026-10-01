import { ConfigFileAuthenticationDetailsProvider, DefaultRequestSigner } from "oci-common";
import type { HttpRequest } from "oci-common";
import { randomUUID } from "node:crypto";

// Explicit, narrow instance membership; no private key is installed on the worker.
const instance = process.argv.find(a => a.startsWith("--instance="))?.slice(11);
if (!instance || !/^ocid1\.instance\.[A-Za-z0-9.-]+$/.test(instance)) throw new Error("--instance=<VM OCID> is required");
const provider = new ConfigFileAuthenticationDetailsProvider(process.env.OCI_CONFIG_FILE, process.env.OCI_CONFIG_PROFILE || "DEFAULT");
const signer = new DefaultRequestSigner(provider);
const compartmentId = provider.getTenantId();
const region = process.env.OCI_REGION || "ap-mumbai-1";
const bucket = process.env.OCI_BUCKET || "radar-blobstore";
if (!/^[A-Za-z0-9_-]+$/.test(bucket)) throw new Error("Invalid bucket name");
const name = "radar-blobstore-worker";
const matchingRule = `instance.id = '${instance}'`;
const statements = [
  `Allow dynamic-group ${name} to manage objects in tenancy where all {target.bucket.name='${bucket}', any {request.permission='OBJECT_READ', request.permission='OBJECT_INSPECT', request.permission='OBJECT_CREATE'}}`,
  `Allow dynamic-group ${name} to manage objects in tenancy where all {target.bucket.name='${bucket}', target.object.name=/_health*/, request.permission='OBJECT_DELETE'}`,
];
async function request(resource: string, body?: object): Promise<any> {
  const text = body ? JSON.stringify(body) : undefined;
  const req: HttpRequest = { method: (body ? "POST" : "GET") as HttpRequest["method"],
    uri: `https://identity.${region}.oci.oraclecloud.com/20160918/${resource}`,
    headers: new Headers(text ? { "content-type": "application/json", "opc-retry-token": randomUUID() } : {}),
    body: text };
  await signer.signHttpRequest(req);
  const response = await fetch(req.uri, { method: req.method, headers: req.headers, body: text, signal: AbortSignal.timeout(30000) });
  if (!response.ok) { const error = await response.json(); throw new Error(`OCI IAM ${response.status}: ${error.code}: ${error.message}`); }
  return response.json();
}
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ name, matchingRule, statements, apply: false }, null, 2));
} else {
  const groups = await request(`dynamicGroups?compartmentId=${encodeURIComponent(compartmentId)}`);
  const summary = groups.find((g: any) => g.name === name);
  const group = summary ? await request(`dynamicGroups/${summary.id}`) : undefined;
  if (group && group.matchingRule !== matchingRule) throw new Error("Existing group has different membership; refusing to broaden it");
  if (!group) await request("dynamicGroups", { compartmentId, name, matchingRule, description: "RADAR processing VM only" });
  const policies = await request(`policies?compartmentId=${encodeURIComponent(compartmentId)}`);
  const policy = policies.find((p: any) => p.name === name);
  if (policy && JSON.stringify(policy.statements) !== JSON.stringify(statements)) throw new Error("Existing policy differs; refusing to overwrite it");
  if (!policy) await request("policies", { compartmentId, name, statements, description: "RADAR bucket create/read; delete synthetic health probes only" });
  console.log(JSON.stringify({ name, applied: true, instance, bucket }));
}
