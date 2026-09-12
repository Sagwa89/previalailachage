const crypto = require("crypto");
const TABLE_NAME = "blog_comments";
const REPORTS_TABLE = "blog_comment_reports";

function send(response, status, payload) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function getConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return {
    url,
    key,
    turnstileSiteKey: String(process.env.TURNSTILE_SITE_KEY || "").trim(),
    turnstileSecretKey: String(process.env.TURNSTILE_SECRET_KEY || "").trim()
  };
}

function validPostId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,159}$/.test(value);
}

async function supabaseRequest(config, path, options = {}) {
  const authorization = config.key.startsWith("sb_") ? {} : { Authorization: `Bearer ${config.key}` };
  return fetch(`${config.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: config.key,
      ...authorization,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
}

function clientIp(request) {
  const forwarded = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(request.headers?.["x-real-ip"] || "").trim() || "unknown";
}

function visitorHash(request, config) {
  return crypto.createHash("sha256").update(`${clientIp(request)}:${config.key.slice(-24)}`).digest("hex");
}

async function verifyTurnstile(request, config, token) {
  if (!config.turnstileSiteKey || !config.turnstileSecretKey) return true;
  if (!token) return false;
  const form = new URLSearchParams({ secret: config.turnstileSecretKey, response: token });
  const ip = clientIp(request);
  if (ip !== "unknown") form.set("remoteip", ip);
  const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString()
  });
  if (!result.ok) return false;
  const data = await result.json();
  return data.success === true;
}

module.exports = async function handler(request, response) {
  const config = getConfig();
  if (!config) return send(response, 503, { error: "Comentários ainda não configurados" });

  if (request.method === "GET" && String(request.query?.config || "") === "1") {
    return send(response, 200, {
      turnstileEnabled: Boolean(config.turnstileSiteKey && config.turnstileSecretKey),
      turnstileSiteKey: config.turnstileSiteKey || null
    });
  }

  if (request.method === "GET") {
    const postId = String(request.query?.post || "").trim().toLowerCase();
    if (!validPostId(postId)) return send(response, 400, { error: "Texto inválido" });

    try {
      const query = `${TABLE_NAME}?select=id,author_name,body,created_at&post_id=eq.${encodeURIComponent(postId)}&status=eq.approved&order=created_at.asc&limit=100`;
      const result = await supabaseRequest(config, query, { method: "GET" });
      if (!result.ok) {
        const error = new Error(`Supabase ${result.status}`);
        error.upstreamStatus = result.status;
        throw error;
      }
      const comments = await result.json();
      return send(response, 200, { comments });
    } catch (error) {
      console.error("Falha ao carregar comentários", error);
      return send(response, 502, { error: "Não foi possível carregar os comentários", upstreamStatus: error.upstreamStatus || null });
    }
  }

  if (request.method === "POST") {
    let body;
    try {
      body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
    } catch (error) {
      return send(response, 400, { error: "Dados inválidos" });
    }
    const postId = String(body.postId || "").trim().toLowerCase();
    const authorName = String(body.name || "").trim().replace(/\s+/g, " ");
    const message = String(body.message || "").trim();
    const website = String(body.website || "").trim();
    const action = String(body.action || "comment");
    const hash = visitorHash(request, config);

    if (website) return send(response, 202, { received: true });

    if (action === "report") {
      const commentId = Number(body.commentId);
      if (!Number.isSafeInteger(commentId) || commentId < 1) return send(response, 400, { error: "Comentário inválido" });
      try {
        const result = await supabaseRequest(config, `${REPORTS_TABLE}?on_conflict=comment_id,visitor_hash`, {
          method: "POST",
          headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({ comment_id: commentId, visitor_hash: hash })
        });
        if (!result.ok) throw new Error(`Supabase ${result.status}`);
        return send(response, 202, { received: true });
      } catch (error) {
        console.error("Falha ao registrar denúncia", error);
        return send(response, 502, { error: "Não foi possível registrar a denúncia" });
      }
    }

    if (!validPostId(postId)) return send(response, 400, { error: "Texto inválido" });
    if (authorName.length < 2 || authorName.length > 80) return send(response, 400, { error: "Informe um nome válido" });
    if (message.length < 3 || message.length > 2000) return send(response, 400, { error: "O comentário deve ter entre 3 e 2000 caracteres" });

    try {
      const human = await verifyTurnstile(request, config, String(body.turnstileToken || ""));
      if (!human) return send(response, 400, { error: "Confirme que você é uma pessoa" });

      const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const rateQuery = `${TABLE_NAME}?select=id&visitor_hash=eq.${hash}&created_at=gte.${encodeURIComponent(since)}&limit=3`;
      const recentResult = await supabaseRequest(config, rateQuery, { method: "GET" });
      if (!recentResult.ok) throw new Error(`Supabase ${recentResult.status}`);
      const recent = await recentResult.json();
      if (Array.isArray(recent) && recent.length >= 3) {
        return send(response, 429, { error: "Aguarde alguns minutos antes de comentar novamente" });
      }

      const result = await supabaseRequest(config, `${TABLE_NAME}?select=id,author_name,body,created_at`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ post_id: postId, author_name: authorName, body: message, visitor_hash: hash, status: "approved" })
      });
      if (!result.ok) {
        const error = new Error(`Supabase ${result.status}`);
        error.upstreamStatus = result.status;
        throw error;
      }
      const rows = await result.json();
      return send(response, 201, { received: true, comment: Array.isArray(rows) ? rows[0] || null : null });
    } catch (error) {
      console.error("Falha ao receber comentário", error);
      return send(response, 502, { error: "Não foi possível enviar o comentário", upstreamStatus: error.upstreamStatus || null });
    }
  }

  response.setHeader("Allow", "GET, POST");
  return send(response, 405, { error: "Método não permitido" });
};
