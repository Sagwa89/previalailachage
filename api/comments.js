const TABLE_NAME = "blog_comments";

function send(response, status, payload) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function getConfig() {
  const url = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !key) return null;
  return { url, key };
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

module.exports = async function handler(request, response) {
  const config = getConfig();
  if (!config) return send(response, 503, { error: "Comentários ainda não configurados" });

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

    if (website) return send(response, 202, { received: true });
    if (!validPostId(postId)) return send(response, 400, { error: "Texto inválido" });
    if (authorName.length < 2 || authorName.length > 80) return send(response, 400, { error: "Informe um nome válido" });
    if (message.length < 3 || message.length > 2000) return send(response, 400, { error: "O comentário deve ter entre 3 e 2000 caracteres" });

    try {
      const result = await supabaseRequest(config, `${TABLE_NAME}?select=id,author_name,body,created_at`, {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ post_id: postId, author_name: authorName, body: message, status: "approved" })
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
