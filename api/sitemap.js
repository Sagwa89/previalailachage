const FEED_URL = "https://lailahage.substack.com/feed";
const SITE_URL = "https://lailahage.com.br";

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

function escapeXml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function sitemapEntry(location, lastModified = "") {
  const lastmod = lastModified ? `<lastmod>${escapeXml(lastModified)}</lastmod>` : "";
  return `<url><loc>${escapeXml(location)}</loc>${lastmod}</url>`;
}

module.exports = async function handler(request, response) {
  const entries = [
    sitemapEntry(`${SITE_URL}/`),
    sitemapEntry(`${SITE_URL}/blog.html`)
  ];

  try {
    const freshFeedUrl = new URL(FEED_URL);
    freshFeedUrl.searchParams.set("refresh", String(Date.now()));
    const feedResponse = await fetch(freshFeedUrl, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "LailaHageSitemap/1.0",
        "Cache-Control": "no-cache"
      }
    });

    if (feedResponse.ok) {
      const xml = await feedResponse.text();
      const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
      for (const item of items) {
        const link = tag(item, "link") || tag(item, "guid");
        let slug = "";
        try {
          slug = new URL(link).pathname.split("/").filter(Boolean).at(-1) || "";
        } catch (error) {
          slug = "";
        }
        if (!/^[a-z0-9][a-z0-9-]{0,159}$/.test(slug)) continue;
        const published = tag(item, "pubDate");
        const lastModified = published && !Number.isNaN(Date.parse(published))
          ? new Date(published).toISOString()
          : "";
        entries.push(sitemapEntry(`${SITE_URL}/artigo/${encodeURIComponent(slug)}`, lastModified));
      }
    }
  } catch (error) {
    console.error("Falha ao atualizar o sitemap", error);
  }

  response.setHeader("Content-Type", "application/xml; charset=utf-8");
  response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
  return response.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</urlset>`);
};
