const FEED_URL = "https://jliahendler.substack.com/feed";
const SITE_URL = "https://previalailachage.vercel.app";

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

function tag(item, name) {
  const escaped = name.replace(":", "\\:");
  const match = item.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function attribute(item, element, name) {
  const escaped = element.replace(":", "\\:");
  const match = item.match(new RegExp(`<${escaped}\\b[^>]*\\b${name}=["']([^"']+)["'][^>]*>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function stripHtml(value = "") {
  return decodeXml(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function imageFrom(content, item) {
  const image = content.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  return image ? decodeXml(image[1]) : attribute(item, "media:content", "url") || attribute(item, "enclosure", "url");
}

function escapeHtml(value = "") {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function findPost(xml, slug) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  for (const item of items) {
    const link = tag(item, "link") || tag(item, "guid");
    let itemSlug = "";
    try { itemSlug = new URL(link).pathname.split("/").filter(Boolean).at(-1) || ""; } catch (error) { itemSlug = ""; }
    if (itemSlug !== slug) continue;
    const content = tag(item, "content:encoded") || tag(item, "description");
    return {
      title: stripHtml(tag(item, "title")) || "Texto de Laila Hage",
      description: stripHtml(content).slice(0, 220) || "Leia esta reflexão de Laila Hage.",
      image: imageFrom(content, item)
    };
  }
  return null;
}

module.exports = async function handler(request, response) {
  const slug = String(request.query?.slug || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(slug)) return response.status(404).send("Texto não encontrado");

  try {
    const feedResponse = await fetch(FEED_URL, { headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "LailaHageShare/1.0" } });
    const xml = await feedResponse.text();
    const post = feedResponse.ok ? findPost(xml, slug) : null;
    if (!post) return response.status(404).send("Texto não encontrado");

    const shareUrl = `${SITE_URL}/artigo/${encodeURIComponent(slug)}`;
    const destination = `${SITE_URL}/blog.html?post=${encodeURIComponent(slug)}`;
    const image = /^https:\/\//i.test(post.image || "") ? post.image : `${SITE_URL}/ogimage.png`;
    const title = escapeHtml(post.title);
    const description = escapeHtml(`Um convite à leitura: ${post.description}`);

    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    return response.status(200).send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Laila Hage</title><meta name="description" content="${description}"><link rel="canonical" href="${shareUrl}"><meta property="og:type" content="article"><meta property="og:locale" content="pt_BR"><meta property="og:site_name" content="Laila Hage"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${shareUrl}"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:image:alt" content="Imagem do artigo ${title}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${escapeHtml(image)}"><script>location.replace(${JSON.stringify(destination)})<\/script></head><body><p><a href="${destination}">Ler o texto de Laila Hage</a></p></body></html>`);
  } catch (error) {
    console.error("Falha ao preparar compartilhamento", error);
    return response.redirect(302, `${SITE_URL}/blog.html`);
  }
};
