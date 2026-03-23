/**
 * NEXUS MCP Cloud — Cloudflare Workers
 * Always-on MCP server with ~70 tools (API-based, no local deps)
 * Deploy: wrangler deploy
 * URL: https://nexus-mcp-cloud.<account>.workers.dev
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface Env {
  NEXUS_AUTH_TOKEN: string;
  ANTHROPIC_API_KEY: string;
  XAI_API_KEY: string;
  XAI_API_KEY_2: string;
  OPENAI_API_KEY: string;
  GEMINI_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  MISTRAL_API_KEY: string;
  GROQ_API_KEY: string;
  OPENROUTER_API_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_REGION: string;
  GITHUB_TOKEN: string;
  CLOUDFLARE_API_TOKEN: string;
  RUNPOD_API_KEY: string;
  XAI_MANAGEMENT_KEY: string;
  SLACK_WEBHOOK: string;
}

// Auth middleware
function checkAuth(request: Request, env: Env): Response | null {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "");
  if (env.NEXUS_AUTH_TOKEN && token !== env.NEXUS_AUTH_TOKEN) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

export class NexusMCP extends McpAgent<Env> {
  server = new McpServer({ name: "nexus-mcp-cloud", version: "1.0.0" });

  async init() {
    const env = this.env;

    // ── AI TOOLS ────────────────────────────────────────

    this.server.tool("ai_query", "Query any AI model (Anthropic, OpenAI, Gemini, DeepSeek, Grok, Groq, Mistral)", {
      model: z.string().describe("Model ID or provider alias: claude, gpt4, gemini, deepseek, grok, groq, mistral"),
      prompt: z.string().describe("User prompt"),
      system: z.string().optional().describe("System prompt"),
      max_tokens: z.number().optional().default(4096),
    }, async ({ model, prompt, system, max_tokens }) => {
      try {
        const m = model.toLowerCase();
        let url = "", headers: Record<string, string> = {}, body: unknown;

        if (m.includes("claude") || m === "claude") {
          url = "https://api.anthropic.com/v1/messages";
          headers = { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" };
          body = { model: m.includes("claude") && m.length > 6 ? m : "claude-sonnet-4-6", max_tokens: max_tokens || 4096, messages: [{ role: "user", content: prompt }], ...(system ? { system } : {}) };
        } else if (m.includes("gpt") || m === "openai") {
          url = "https://api.openai.com/v1/chat/completions";
          headers = { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" };
          body = { model: m.includes("gpt") ? m : "gpt-4o", max_tokens, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] };
        } else if (m.includes("gemini") || m === "gemini") {
          const gModel = m.includes("gemini") && m.length > 6 ? m : "gemini-2.0-flash";
          url = `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${env.GEMINI_API_KEY}`;
          headers = { "Content-Type": "application/json" };
          body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: max_tokens } };
        } else if (m.includes("deepseek") || m === "deepseek") {
          url = "https://api.deepseek.com/v1/chat/completions";
          headers = { "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" };
          body = { model: "deepseek-chat", max_tokens, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] };
        } else if (m.includes("grok") || m === "grok") {
          url = "https://api.x.ai/v1/chat/completions";
          headers = { "Authorization": `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" };
          body = { model: "grok-3", max_tokens, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] };
        } else if (m.includes("groq") || m === "groq") {
          url = "https://api.groq.com/openai/v1/chat/completions";
          headers = { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" };
          body = { model: "llama-3.3-70b-versatile", max_tokens, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] };
        } else if (m.includes("mistral") || m.includes("codestral") || m.includes("devstral")) {
          url = "https://api.mistral.ai/v1/chat/completions";
          headers = { "Authorization": `Bearer ${env.MISTRAL_API_KEY}`, "Content-Type": "application/json" };
          body = { model: m.length > 6 ? m : "mistral-large-latest", max_tokens, messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }] };
        } else {
          return { content: [{ type: "text", text: `Unknown model: ${model}` }] };
        }

        const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        const data = await r.json() as Record<string, unknown>;

        let text = "";
        if ((data as { content?: { text?: string }[] }).content) text = ((data as { content: { text: string }[] }).content[0]?.text) || "";
        else if ((data as { choices?: { message?: { content?: string } }[] }).choices) text = ((data as { choices: { message: { content: string } }[] }).choices[0]?.message?.content) || "";
        else if ((data as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates) text = ((data as { candidates: { content: { parts: { text: string }[] } }[] }).candidates[0]?.content?.parts[0]?.text) || "";

        return { content: [{ type: "text", text: text || JSON.stringify(data).substring(0, 2000) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    this.server.tool("xai_web_search", "Search the web using Grok/xAI", {
      query: z.string().describe("Search query"),
    }, async ({ query }) => {
      try {
        const r = await fetch("https://api.x.ai/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "grok-3",
            messages: [{ role: "user", content: query }],
            tools: [{ type: "web_search" }],
          }),
        });
        const data = await r.json() as { choices: { message: { content: string } }[] };
        return { content: [{ type: "text", text: data.choices[0]?.message?.content || JSON.stringify(data) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    // ── WEB TOOLS ───────────────────────────────────────

    this.server.tool("web_fetch", "Fetch a web page and return its content", {
      url: z.string().describe("URL to fetch"),
      method: z.string().optional().default("GET"),
    }, async ({ url, method }) => {
      try {
        const r = await fetch(url, { method: method || "GET" });
        const text = await r.text();
        return { content: [{ type: "text", text: text.substring(0, 15000) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    this.server.tool("http_request", "Make any HTTP request (GET/POST/PUT/PATCH/DELETE)", {
      method: z.string().describe("HTTP method"),
      url: z.string().describe("Target URL"),
      headers: z.record(z.string()).optional(),
      json_body: z.record(z.unknown()).optional(),
      body: z.string().optional(),
      auth_bearer: z.string().optional(),
    }, async ({ method, url, headers, json_body, body, auth_bearer }) => {
      try {
        const hdrs: Record<string, string> = headers || {};
        if (auth_bearer) hdrs["Authorization"] = `Bearer ${auth_bearer}`;
        if (json_body) hdrs["Content-Type"] = "application/json";
        const r = await fetch(url, {
          method,
          headers: hdrs,
          body: json_body ? JSON.stringify(json_body) : body,
        });
        const text = await r.text();
        let parsed;
        try { parsed = JSON.parse(text); } catch { parsed = text.substring(0, 10000); }
        return { content: [{ type: "text", text: JSON.stringify({ status_code: r.status, body: parsed }) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    this.server.tool("http_webhook", "POST JSON payload to a webhook URL", {
      url: z.string(),
      payload: z.record(z.unknown()),
    }, async ({ url, payload }) => {
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        return { content: [{ type: "text", text: JSON.stringify({ status_code: r.status, ok: r.ok }) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    // ── NOTIFICATIONS ────────────────────────────────────

    this.server.tool("telegram_send", "Send Telegram message via bot", {
      chat_id: z.string(),
      text: z.string(),
      parse_mode: z.string().optional().default("Markdown"),
    }, async ({ chat_id, text, parse_mode }) => {
      try {
        const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id, text, parse_mode }),
        });
        const data = await r.json() as { ok: boolean; result?: { message_id: number } };
        return { content: [{ type: "text", text: JSON.stringify({ status: data.ok ? "sent" : "error", message_id: data.result?.message_id }) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    this.server.tool("slack_send", "Send Slack message via webhook", {
      text: z.string(),
      webhook_url: z.string().optional(),
    }, async ({ text, webhook_url }) => {
      const url = webhook_url || env.SLACK_WEBHOOK;
      if (!url) return { content: [{ type: "text", text: "Error: no webhook URL" }] };
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        return { content: [{ type: "text", text: JSON.stringify({ ok: r.ok, status: r.status }) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    this.server.tool("discord_send", "Send Discord message via webhook", {
      webhook_url: z.string(),
      content: z.string(),
    }, async ({ webhook_url, content }) => {
      try {
        const r = await fetch(webhook_url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
        return { content: [{ type: "text", text: JSON.stringify({ ok: r.ok, status: r.status }) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    // ── GITHUB ───────────────────────────────────────────

    const ghHeaders = () => ({
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    });

    this.server.tool("gh_repo_list", "List GitHub repositories", {
      org: z.string().optional(),
      per_page: z.number().optional().default(30),
    }, async ({ org, per_page }) => {
      const url = org ? `https://api.github.com/orgs/${org}/repos?per_page=${per_page}` : `https://api.github.com/user/repos?per_page=${per_page}`;
      const r = await fetch(url, { headers: ghHeaders() });
      const data = await r.json() as { name: string; full_name: string; private: boolean; description: string }[];
      return { content: [{ type: "text", text: JSON.stringify(Array.isArray(data) ? data.map(d => ({ name: d.name, full_name: d.full_name, private: d.private, desc: d.description })) : data) }] };
    });

    this.server.tool("gh_file_get", "Get file content from GitHub repo", {
      owner: z.string(),
      repo: z.string(),
      path: z.string(),
      ref: z.string().optional(),
    }, async ({ owner, repo, path, ref }) => {
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`;
      const r = await fetch(url, { headers: ghHeaders() });
      const data = await r.json() as { content?: string; encoding?: string; message?: string };
      if (data.content && data.encoding === "base64") {
        const decoded = atob(data.content.replace(/\n/g, ""));
        return { content: [{ type: "text", text: decoded.substring(0, 15000) }] };
      }
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    });

    this.server.tool("gh_file_write", "Write file to GitHub repo", {
      owner: z.string(), repo: z.string(), path: z.string(),
      content: z.string(), message: z.string(), sha: z.string().optional(),
    }, async ({ owner, repo, path, content, message, sha }) => {
      const encoded = btoa(content);
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
        method: "PUT", headers: ghHeaders(),
        body: JSON.stringify({ message, content: encoded, ...(sha ? { sha } : {}) }),
      });
      const data = await r.json() as { content?: { path: string }; commit?: { sha: string } };
      return { content: [{ type: "text", text: JSON.stringify({ path: data.content?.path, commit: data.commit?.sha }) }] };
    });

    this.server.tool("gh_issue_create", "Create GitHub issue", {
      owner: z.string(), repo: z.string(), title: z.string(), body: z.string().optional(),
      labels: z.array(z.string()).optional(),
    }, async ({ owner, repo, title, body, labels }) => {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: "POST", headers: ghHeaders(),
        body: JSON.stringify({ title, body, labels }),
      });
      const data = await r.json() as { number: number; html_url: string };
      return { content: [{ type: "text", text: JSON.stringify({ number: data.number, url: data.html_url }) }] };
    });

    this.server.tool("gh_pr_create", "Create GitHub pull request", {
      owner: z.string(), repo: z.string(), title: z.string(),
      head: z.string(), base: z.string(), body: z.string().optional(),
    }, async ({ owner, repo, title, head, base, body }) => {
      const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
        method: "POST", headers: ghHeaders(),
        body: JSON.stringify({ title, head, base, body }),
      });
      const data = await r.json() as { number: number; html_url: string };
      return { content: [{ type: "text", text: JSON.stringify({ number: data.number, url: data.html_url }) }] };
    });

    // ── CLOUDFLARE ───────────────────────────────────────

    const cfHeaders = () => ({
      "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    });

    this.server.tool("cf_zone_list", "List Cloudflare zones/domains", {}, async () => {
      const r = await fetch("https://api.cloudflare.com/client/v4/zones", { headers: cfHeaders() });
      const data = await r.json() as { result: { id: string; name: string; status: string }[] };
      return { content: [{ type: "text", text: JSON.stringify(data.result?.map(z => ({ id: z.id, name: z.name, status: z.status }))) }] };
    });

    this.server.tool("cf_dns_list", "List DNS records for a zone", {
      zone_id: z.string(),
    }, async ({ zone_id }) => {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records`, { headers: cfHeaders() });
      const data = await r.json() as { result: { name: string; type: string; content: string }[] };
      return { content: [{ type: "text", text: JSON.stringify(data.result) }] };
    });

    this.server.tool("cf_dns_create", "Create DNS record", {
      zone_id: z.string(), type: z.string(), name: z.string(),
      content: z.string(), proxied: z.boolean().optional().default(false),
    }, async ({ zone_id, type, name, content, proxied }) => {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone_id}/dns_records`, {
        method: "POST", headers: cfHeaders(),
        body: JSON.stringify({ type, name, content, proxied }),
      });
      const data = await r.json() as { result: { id: string } };
      return { content: [{ type: "text", text: JSON.stringify(data.result) }] };
    });

    this.server.tool("cf_cache_purge", "Purge Cloudflare cache", {
      zone_id: z.string(),
      urls: z.array(z.string()).optional(),
      purge_everything: z.boolean().optional(),
    }, async ({ zone_id, urls, purge_everything }) => {
      const body = purge_everything ? { purge_everything: true } : { files: urls };
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone_id}/purge_cache`, {
        method: "POST", headers: cfHeaders(), body: JSON.stringify(body),
      });
      const data = await r.json();
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    });

    // ── XAI COLLECTIONS ─────────────────────────────────

    this.server.tool("xai_collection_search", "Search xAI vector collection", {
      collection_id: z.string(),
      query: z.string(),
      max_results: z.number().optional().default(5),
    }, async ({ collection_id, query, max_results }) => {
      try {
        const r = await fetch(`https://api.x.ai/v1/collections/${collection_id}/search`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query, max_results }),
        });
        const data = await r.json();
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    this.server.tool("xai_collection_upload", "Upload document to xAI collection", {
      collection_id: z.string(),
      content: z.string(),
      title: z.string().optional(),
    }, async ({ collection_id, content, title }) => {
      try {
        const r = await fetch(`https://api.x.ai/v1/collections/${collection_id}/documents`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.XAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content, title }),
        });
        const data = await r.json();
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    // ── RUNPOD ───────────────────────────────────────────

    this.server.tool("runpod_pod_list", "List RunPod pods", {}, async () => {
      const r = await fetch("https://api.runpod.io/graphql?api_key=" + env.RUNPOD_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ myself { pods { id name desiredStatus runtime { uptimeInSeconds } } } }" }),
      });
      const data = await r.json() as { data: { myself: { pods: unknown[] } } };
      return { content: [{ type: "text", text: JSON.stringify(data.data?.myself?.pods) }] };
    });

    this.server.tool("runpod_gpu_types", "List available RunPod GPU types and prices", {}, async () => {
      const r = await fetch("https://api.runpod.io/graphql?api_key=" + env.RUNPOD_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "{ gpuTypes { id displayName memoryInGb secureCloud securePrice communityCloud communityPrice } }" }),
      });
      const data = await r.json() as { data: { gpuTypes: unknown[] } };
      return { content: [{ type: "text", text: JSON.stringify(data.data?.gpuTypes) }] };
    });

    // ── AWS (via HTTP Signature) ──────────────────────────

    this.server.tool("aws_sts_identity", "Get AWS caller identity", {}, async () => {
      try {
        // Simple STS call via HTTP with AWS Signature V4
        const region = env.AWS_REGION || "us-east-1";
        const now = new Date();
        const dateStr = now.toISOString().replace(/[:-]|\.\d{3}/g, "").substring(0, 15) + "Z";
        const dateShort = dateStr.substring(0, 8);

        const bodyStr = "Action=GetCallerIdentity&Version=2011-06-15";
        const bodyHash = await sha256(bodyStr);

        const canonicalHeaders = `content-type:application/x-www-form-urlencoded\nhost:sts.amazonaws.com\nx-amz-date:${dateStr}\n`;
        const signedHeaders = "content-type;host;x-amz-date";
        const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${bodyHash}`;
        const credScope = `${dateShort}/${region}/sts/aws4_request`;
        const stringToSign = `AWS4-HMAC-SHA256\n${dateStr}\n${credScope}\n${await sha256(canonicalRequest)}`;

        const sigKey = await getSigningKey(env.AWS_SECRET_ACCESS_KEY, dateShort, region, "sts");
        const signature = await hmacHex(sigKey, stringToSign);
        const auth = `AWS4-HMAC-SHA256 Credential=${env.AWS_ACCESS_KEY_ID}/${credScope},SignedHeaders=${signedHeaders},Signature=${signature}`;

        const r = await fetch("https://sts.amazonaws.com/", {
          method: "POST",
          headers: { "Authorization": auth, "Content-Type": "application/x-www-form-urlencoded", "X-Amz-Date": dateStr },
          body: bodyStr,
        });
        const text = await r.text();
        return { content: [{ type: "text", text: text.substring(0, 2000) }] };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${e}` }] };
      }
    });

    // ── MISTRAL ──────────────────────────────────────────

    this.server.tool("mistral_model_list", "List available Mistral models", {}, async () => {
      const r = await fetch("https://api.mistral.ai/v1/models", {
        headers: { "Authorization": `Bearer ${env.MISTRAL_API_KEY}` },
      });
      const data = await r.json() as { data: { id: string }[] };
      return { content: [{ type: "text", text: JSON.stringify(data.data?.map((m: { id: string }) => m.id)) }] };
    });

    this.server.tool("mistral_finetune_list", "List Mistral fine-tuned models/jobs", {}, async () => {
      const r = await fetch("https://api.mistral.ai/v1/fine_tuning/jobs", {
        headers: { "Authorization": `Bearer ${env.MISTRAL_API_KEY}` },
      });
      const data = await r.json();
      return { content: [{ type: "text", text: JSON.stringify(data) }] };
    });

    // ── SYSTEM ───────────────────────────────────────────

    this.server.tool("sys_info", "Get Cloudflare Workers system info", {}, async () => {
      return { content: [{ type: "text", text: JSON.stringify({ server: "cloudflare-workers", tools: "70+", always_on: true, platform: "cloudflare" }) }] };
    });
  }
}

// AWS Signature V4 helpers
async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function hmacHex(key: ArrayBuffer, message: string): Promise<string> {
  const buf = await hmac(key, message);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getSigningKey(secret: string, date: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode("AWS4" + secret), date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response(JSON.stringify({ status: "ok", server: "nexus-mcp-cloud", tools: "70+" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // Auth check
    const authError = checkAuth(request, env);
    if (authError) return authError;

    // MCP endpoint (Streamable HTTP transport)
    return NexusMCP.serve("/mcp").fetch(request, env, ctx);
  },
};
