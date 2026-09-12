const FEED_URL = "https://jliahendler.substack.com/feed";

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
  const escapedName = name.replace(":", "\\:");
  const match = item.match(new RegExp(`<${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedName}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function attribute(item, element, name) {
  const escapedElement = element.replace(":", "\\:");
  const match = item.match(new RegExp(`<${escapedElement}\\b[^>]*\\b${name}=["']([^"']+)["'][^>]*>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function stripHtml(value = "") {
  return decodeXml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function imageFrom(content, item) {
  const image = content.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  return image ? decodeXml(image[1]) : attribute(item, "media:content", "url") || attribute(item, "enclosure", "url");
}

function parseFeed(xml) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.slice(0, 12).map((item) => {
    const content = tag(item, "content:encoded") || tag(item, "description");
    const link = tag(item, "link") || tag(item, "guid");
    let slug = "";
    try {
      const segments = new URL(link).pathname.split("/").filter(Boolean);
      slug = segments.at(-1) || "";
    } catch (error) {
      slug = "";
    }
    const plainText = stripHtml(content);
    return {
      title: stripHtml(tag(item, "title")) || "Novo texto",
      date: tag(item, "pubDate"),
      link,
      slug,
      category: stripHtml(tag(item, "category")) || "Reflexão",
      excerpt: plainText.slice(0, 260),
      image: imageFrom(content, item),
      content
    };
  }).filter((post) => post.link);
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Método não permitido" });
  }

  try {
    const feedResponse = await fetch(FEED_URL, {
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml",
        "User-Agent": "LailaHageBlog/1.0"
      },
      redirect: "follow"
    });
    const xml = await feedResponse.text();
    const isFeed = /<rss\b|<feed\b/i.test(xml);

    if (!feedResponse.ok || !isFeed) {
      response.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
      return response.status(200).json({ posts: [], setupRequired: true });
    }

    response.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=3600");
    return response.status(200).json({ posts: parseFeed(xml), source: "substack" });
  } catch (error) {
    console.error("Falha ao consultar o Substack", error);
    return response.status(502).json({ posts: [], error: "Não foi possível carregar os textos agora" });
  }
};
