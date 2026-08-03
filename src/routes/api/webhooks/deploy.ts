/**
 * src/routes/api/webhooks/deploy.ts
 *
 * Render-style Git Auto-Deploy Webhook endpoint.
 * Triggers on GitHub `push` webhook or manual POST request.
 *
 * Usage:
 *  POST http://130.210.40.98.sslip.io/api/webhooks/deploy
 *  Header: X-Deploy-Secret: <DEPLOY_SECRET>
 */

import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { exec } from "child_process";
import crypto from "crypto";

export const triggerDeployFn = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const secretHeader = request.headers.get("x-deploy-secret");
  const githubSignature = request.headers.get("x-hub-signature-256");
  const expectedSecret = process.env.DEPLOY_SECRET || "radar-deploy-secret-2026";

  let isAuthorized = false;

  // 1. Direct Secret Header Match
  if (secretHeader && secretHeader === expectedSecret) {
    isAuthorized = true;
  }

  // 2. GitHub HMAC SHA256 Signature Match
  if (!isAuthorized && githubSignature) {
    try {
      const rawBody = await request.clone().text();
      const hmac = "sha256=" + crypto.createHmac("sha256", expectedSecret).update(rawBody).digest("hex");
      if (crypto.timingSafeEqual(Buffer.from(githubSignature), Buffer.from(hmac))) {
        isAuthorized = true;
      }
    } catch {}
  }

  // 3. Admin session fallback (when triggered from UI button)
  if (!isAuthorized) {
    // If request comes from same origin with session cookie, allow trigger
    const cookie = request.headers.get("cookie") || "";
    if (cookie.includes("radar_session") || cookie.includes("session=")) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    console.warn("[Deploy Webhook] Unauthorized deployment attempt.");
    return { success: false, error: "Unauthorized deploy request" };
  }

  console.log("[Deploy Webhook] Auto-deploy triggered! Running git pull & build...");

  // Execute git pull & npm run build in background asynchronously
  const cmd = `cd ${process.cwd()} && git pull origin main && npm run build && sudo pm2 restart ecosystem.config.cjs`;

  exec(cmd, (error, stdout, stderr) => {
    if (error) {
      console.error("[Deploy Webhook] Auto-deploy error:", error);
    } else {
      console.log("[Deploy Webhook] Auto-deploy finished successfully:\n", stdout);
    }
  });

  return { success: true, message: "Auto-deploy process initiated" };
});

export const Route = createFileRoute("/api/webhooks/deploy")({
  loader: async () => {
    return {
      status: "Render-style Auto-Deploy Webhook Active",
      webhookUrl: "http://130.210.40.98.sslip.io/api/webhooks/deploy"
    };
  },
});
