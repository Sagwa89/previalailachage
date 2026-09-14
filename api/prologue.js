const crypto = require("crypto");

function send(response, status, payload) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function getConfig() {
  return {
    resendKey: String(process.env.RESEND_API_KEY || "").trim(),
    fromEmail: String(process.env.RESEND_FROM_EMAIL || "").trim(),
    lailaEmail: String(process.env.LAILA_CONTACT_EMAIL || "").trim(),
    prologueUrl: String(process.env.PROLOGUE_URL || "").trim(),
    turnstileSiteKey: String(process.env.TURNSTILE_SITE_KEY || "").trim(),
    turnstileSecretKey: String(process.env.TURNSTILE_SECRET_KEY || "").trim()
  };
}

function clientIp(request) {
  const forwarded = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(request.headers?.["x-real-ip"] || "").trim() || "unknown";
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

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

module.exports = async function handler(request, response) {
  const config = getConfig();

  if (request.method === "GET" && String(request.query?.config || "") === "1") {
    return send(response, 200, {
      turnstileEnabled: Boolean(config.turnstileSiteKey && config.turnstileSecretKey),
      turnstileSiteKey: config.turnstileSiteKey || null
    });
  }

  if (request.method !== "POST") {
    response.setHeader("Allow", "GET, POST");
    return send(response, 405, { error: "Método não permitido" });
  }

  if (!config.resendKey || !config.fromEmail || !config.lailaEmail || !config.prologueUrl) {
    return send(response, 503, { error: "O envio do prólogo ainda não foi configurado" });
  }

  let body;
  try {
    body = typeof request.body === "string" ? JSON.parse(request.body || "{}") : request.body || {};
  } catch {
    return send(response, 400, { error: "Dados inválidos" });
  }

  const name = String(body.name || "").trim().replace(/\s+/g, " ");
  const email = String(body.email || "").trim().toLowerCase();
  const phone = String(body.phone || "").trim().replace(/\s+/g, " ");
  const website = String(body.website || "").trim();
  const consent = body.consent === true || ["true", "on", "yes", "1"].includes(String(body.consent || "").toLowerCase());

  if (website) return send(response, 202, { received: true });
  if (name.length < 2 || name.length > 80) return send(response, 400, { error: "Informe um nome válido" });
  if (!validEmail(email)) return send(response, 400, { error: "Informe um email válido" });
  if (phone.length < 8 || phone.length > 30) return send(response, 400, { error: "Informe um telefone válido" });
  if (!consent) return send(response, 400, { error: "É necessário autorizar o envio" });

  try {
    const human = await verifyTurnstile(request, config, String(body.turnstileToken || ""));
    if (!human) return send(response, 400, { error: "Confirme que você é uma pessoa" });

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone);
    const safeUrl = escapeHtml(config.prologueUrl);
    const dateKey = new Date().toISOString().slice(0, 10);
    const submissionHash = crypto.createHash("sha256").update(`${email}:${phone}:${dateKey}`).digest("hex").slice(0, 32);

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `prologo-${submissionHash}`
      },
      body: JSON.stringify({
        from: config.fromEmail,
        to: [email],
        bcc: email === config.lailaEmail.toLowerCase() ? undefined : [config.lailaEmail],
        reply_to: config.lailaEmail,
        subject: "Seu prólogo | Quando a proteção fere",
        attachments: [{ path: config.prologueUrl, filename: "prologo-quando-a-protecao-fere.pdf" }],
        html: `<div style="margin:0;background:#f4ede4;padding:32px 16px;color:#4a2c1f;font-family:Arial,sans-serif"><div style="max-width:620px;margin:auto;background:#fff;padding:36px;border-top:6px solid #540b0e"><p style="margin:0 0 12px;color:#942023;font-size:12px;letter-spacing:2px;text-transform:uppercase">Leitura gratuita</p><h1 style="margin:0 0 20px;color:#540b0e;font-family:Georgia,serif;font-weight:400">Quando a proteção fere</h1><p>Olá, ${safeName}.</p><p>Obrigada pelo interesse. O prólogo completo já está disponível para sua leitura.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#c9a24b;color:#540b0e;padding:15px 22px;text-decoration:none;text-transform:uppercase;letter-spacing:1px">Ler o prólogo</a></p><p style="color:#6f5b50;font-size:13px">Se o botão não abrir, copie este endereço:<br><a href="${safeUrl}" style="color:#942023">${safeUrl}</a></p><hr style="border:0;border-top:1px solid #e2d7ca;margin:28px 0"><p style="margin-bottom:8px;font-size:13px"><strong>Dados do cadastro</strong></p><p style="margin:0;color:#6f5b50;font-size:13px">Nome: ${safeName}<br>Email: ${safeEmail}<br>WhatsApp: ${safePhone}</p><p style="margin:28px 0 0;color:#6f5b50;font-size:12px">Você receberá também novidades sobre o lançamento, conforme autorizado no formulário.</p></div></div>`,
        text: `Olá, ${name}.\n\nO prólogo completo de Quando a proteção fere está disponível em:\n${config.prologueUrl}\n\nDados do cadastro\nNome: ${name}\nEmail: ${email}\nWhatsApp: ${phone}\n\nVocê receberá também novidades sobre o lançamento, conforme autorizado no formulário.`
      })
    });

    if (!emailResponse.ok) {
      const detail = await emailResponse.text();
      console.error("Falha no Resend", emailResponse.status, detail.slice(0, 500));
      return send(response, 502, { error: "Não foi possível enviar o prólogo agora" });
    }

    return send(response, 201, { received: true });
  } catch (error) {
    console.error("Falha ao enviar prólogo", error);
    return send(response, 502, { error: "Não foi possível enviar o prólogo agora" });
  }
};
