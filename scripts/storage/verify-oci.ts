import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { ConfigFileAuthenticationDetailsProvider, DefaultRequestSigner } from "oci-common";
import type { HttpRequest } from "oci-common";
import { OciObjectBlobStore, ociOptionsFromEnv, BlobIntegrityError } from "../../src/lib/storage/oci-blob-store";

// Only synthetic data, no database or candidate/portal material. Never deletes historical objects.
const options = ociOptionsFromEnv();
const writer = new OciObjectBlobStore(options);
const reader = new OciObjectBlobStore(options);
const key = `_health/integration-${randomUUID()}.json`;
const payload = JSON.stringify({ synthetic: true, purpose: "RADAR OCI storage verification" });
try {
  await writer.put(key, payload, "application/json");
  await writer.put(key, payload, "application/json");
  const read = await reader.get(key);
  if (read?.toString() !== payload) throw new Error("Independent client readback failed");
  let conflict = false;
  try { await writer.put(key, "conflicting bytes"); } catch (error) { if (!(error instanceof BlobIntegrityError)) throw error; conflict = true; }
  if (!conflict) throw new Error("Conflicting upload was not rejected");
  if (await reader.get(`${key}.missing`) !== null) throw new Error("Missing object did not return null");
  const sshHost = process.argv.find(arg => arg.startsWith("--ssh="))?.slice(6);
  if (sshHost) {
    // Send only one request's temporary signature; the private key stays on the laptop.
    if (options.auth === "instance_principal") throw new Error("SSH proof requires local config-file auth");
    const request: HttpRequest = { method: "GET" as HttpRequest["method"], uri: `https://objectstorage.${options.region}.oraclecloud.com/n/${options.namespace}/b/${options.bucket}/o/${encodeURIComponent(key)}`, headers: new Headers() };
    await new DefaultRequestSigner(new ConfigFileAuthenticationDetailsProvider(options.configFile, options.profile)).signHttpRequest(request);
    const remoteCode = `let input="";process.stdin.on("data",d=>input+=d);process.stdin.on("end",async()=>{try{const p=JSON.parse(input);const r=await fetch(p.url,{headers:p.headers,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error("OCI status "+r.status);const b=Buffer.from(await r.arrayBuffer());const h=require("node:crypto").createHash("sha256").update(b).digest("hex");if(h!==p.sha256)throw Error("Hash mismatch");console.log("Oracle cross-host SHA-256 readback verified");}catch(e){console.error(e.message);process.exitCode=1;}});`;
    await new Promise<void>((resolve, reject) => {
      const child = spawn("ssh", ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-o", "ConnectTimeout=10", sshHost, `node -e '${remoteCode}'`], { stdio: ["pipe", "pipe", "pipe"] });
      child.stdout.on("data", chunk => process.stdout.write(chunk));
      child.stderr.on("data", chunk => process.stderr.write(chunk));
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Oracle readback exited ${code}`)));
      child.stdin.end(JSON.stringify({ url: request.uri, headers: Object.fromEntries(request.headers.entries()), sha256: createHash("sha256").update(payload).digest("hex") }));
    });
  }
  console.log(JSON.stringify({ bucket: options.bucket, region: options.region, independentReadback: true,
    duplicateIdempotency: true, immutableConflictRejected: true, missingObject: true, oracleReadback: Boolean(sshHost) }));
} finally { await writer.delete(key); }
