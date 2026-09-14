function send(response, status, payload) {
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  return response.status(status).json(payload);
}

function getConfig() {
  return {
    lailaEmail: String(process.env.LAILA_CONTACT_EMAIL || "lailachage@gmail.com").trim(),
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

  if (!config.lailaEmail || !config.prologueUrl) {
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
  const phoneDigits = phone.replace(/\D/g, "");
  const website = String(body.website || "").trim();
  const consent = body.consent === true || ["true", "on", "yes", "1"].includes(String(body.consent || "").toLowerCase());

  if (website) return send(response, 202, { received: true });
  if (name.length < 3 || name.length > 80 || !/^[A-Za-zÀ-ÖØ-öø-ÿ'’ ]+$/.test(name) || name.split(" ").filter(Boolean).length < 2) return send(response, 400, { error: "Informe nome e sobrenome usando apenas letras" });
  if (!validEmail(email)) return send(response, 400, { error: "Informe um email válido" });
  if (phoneDigits.length < 10 || phoneDigits.length > 11) return send(response, 400, { error: "Informe um telefone com DDD e 10 ou 11 números" });
  if (!consent) return send(response, 400, { error: "É necessário autorizar o envio" });

  try {
    const human = await verifyTurnstile(request, config, String(body.turnstileToken || ""));
    if (!human) return send(response, 400, { error: "Confirme que você é uma pessoa" });

    const emailResponse = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(config.lailaEmail)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        Nome: name,
        Email: email,
        WhatsApp: phone,
        Consentimento: "Autorizou receber o prólogo, novidades, publicações, eventos, palestras e informações sobre o lançamento",
        _subject: `Novo cadastro para o prólogo | ${name}`,
        _template: "table",
        _captcha: "false"
      })
    });

    if (!emailResponse.ok) {
      const detail = await emailResponse.text();
      console.error("Falha no FormSubmit", emailResponse.status, detail.slice(0, 500));
      return send(response, 502, { error: "Não foi possível enviar o prólogo agora" });
    }

    return send(response, 201, { received: true, downloadUrl: config.prologueUrl });
  } catch (error) {
    console.error("Falha ao enviar prólogo", error);
    return send(response, 502, { error: "Não foi possível enviar o prólogo agora" });
  }
};
