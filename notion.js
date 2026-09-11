const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";
const POSTS_PER_PAGE = 6;
let cachedDataSourceId = null;

function json(response, status, body) {
  response.status(status).json(body);
}

async function notionRequest(path, token, options = {}) {
  const response = await fetch(`${NOTION_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const error = new Error(`Notion request failed with status ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function getDataSourceId(databaseId, token) {
  if (cachedDataSourceId) return cachedDataSourceId;

  const database = await notionRequest(`/databases/${encodeURIComponent(databaseId)}`, token);
  cachedDataSourceId = database.data_sources?.[0]?.id || null;

  if (!cachedDataSourceId) {
    throw new Error("No data source was found in the configured database");
  }

  return cachedDataSourceId;
}

async function queryDatabase(databaseId, token, cursor) {
  const dataSourceId = await getDataSourceId(databaseId, token);

  const result = await notionRequest(`/data_sources/${encodeURIComponent(dataSourceId)}/query`, token, {
    method: "POST",
    body: JSON.stringify({
      page_size: POSTS_PER_PAGE,
      ...(cursor ? { start_cursor: cursor } : {}),
      sorts: [{ timestamp: "created_time", direction: "descending" }]
    })
  });

  return {
    pages: result.results.filter(item => item.object === "page"),
    nextCursor: result.has_more ? result.next_cursor : null
  };
}

async function retrieveBlockChildren(blockId, token) {
  const blocks = [];
  let cursor = null;

  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);

    const result = await notionRequest(
      `/blocks/${encodeURIComponent(blockId)}/children?${query.toString()}`,
      token
    );

    for (const block of result.results) {
      if (block.has_children) {
        block.children = await retrieveBlockChildren(block.id, token);
      }
      blocks.push(block);
    }

    cursor = result.has_more ? result.next_cursor : null;
  } while (cursor);

  return blocks;
}

function normalizeRichText(items = []) {
  return items.map(item => ({
    text: item.plain_text || "",
    href: item.href || null,
    bold: Boolean(item.annotations?.bold),
    italic: Boolean(item.annotations?.italic),
    underline: Boolean(item.annotations?.underline),
    code: Boolean(item.annotations?.code)
  }));
}

function normalizeBlock(block) {
  const type = block.type;
  const data = block[type] || {};
  const children = Array.isArray(block.children)
    ? block.children.map(normalizeBlock).filter(Boolean)
    : [];

  if (["paragraph", "heading_1", "heading_2", "heading_3", "quote", "bulleted_list_item", "numbered_list_item"].includes(type)) {
    return {
      type,
      richText: normalizeRichText(data.rich_text),
      children
    };
  }

  if (type === "image") {
    return {
      type,
      url: data.type === "external" ? data.external?.url : data.file?.url,
      caption: normalizeRichText(data.caption)
    };
  }

  if (type === "divider") return { type };

  if (type === "code") {
    return {
      type,
      language: data.language || "plain text",
      richText: normalizeRichText(data.rich_text)
    };
  }

  return null;
}

function getPageTitle(page) {
  const titleProperty = Object.values(page.properties || {}).find(property => property.type === "title");
  const title = titleProperty?.title?.map(item => item.plain_text).join("").trim();
  return title || "Publicação sem título";
}

function getPageDate(page) {
  const dateProperty = Object.values(page.properties || {}).find(
    property => property.type === "date" && property.date?.start
  );
  return dateProperty?.date?.start || page.created_time;
}

function createSlug(title, id) {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 70);

  return slug || id.replace(/-/g, "");
}

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return json(response, 405, { error: "Method not allowed" });
  }

  const token = process.env.NOTION_API_KEY;
  const databaseId = process.env.DATABASE_ID;
  const url = new URL(request.url, "https://local.invalid");
  const cursor = url.searchParams.get("cursor");

  if (!token || !databaseId) {
    return json(response, 500, { error: "Notion environment variables are not configured" });
  }

  if (cursor && cursor.length > 500) {
    return json(response, 400, { error: "Invalid pagination cursor" });
  }

  try {
    const { pages, nextCursor } = await queryDatabase(databaseId, token, cursor);
    const posts = [];

    for (const page of pages) {
      const title = getPageTitle(page);
      const blocks = await retrieveBlockChildren(page.id, token);

      posts.push({
        id: page.id,
        slug: createSlug(title, page.id),
        title,
        date: getPageDate(page),
        content: blocks.map(normalizeBlock).filter(Boolean)
      });
    }

    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=86400");
    return json(response, 200, { posts, nextCursor });
  } catch (error) {
    console.error("Notion blog error", {
      message: error.message,
      status: error.status || 500
    });

    return json(response, 502, { error: "Unable to load blog posts" });
  }
};
