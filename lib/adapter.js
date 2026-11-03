// Translates the page's claude.ai-connector dialect (read-design / edit-design) into the
// public Canva MCP server's tool set (get-design, get-design-pages, get-design-content,
// start-editing-transaction, perform-editing-operations, commit/cancel-editing-transaction).
import { mcpCallTool, toPagePayload } from "./canva.js";

const defaultCall = async (token, tool, args) => toPagePayload(await mcpCallTool(token, tool, args));

async function fetchImageBlock(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4_000_000) return null;
    return { type: "image", data: buf.toString("base64"), mimeType: r.headers.get("content-type")?.split(";")[0] || "image/png" };
  } catch { return null; }
}

// start-editing-transaction gives flat richtexts; the page expects pages[] with text elements.
export function pagesFromTransaction(p) {
  const rawPages = p.pages || [];
  const pages = rawPages.map((pg, i) => ({
    type: pg.is_responsive ? "responsive" : "fixed",
    id: pg.page_id || pg.id || "PB" + (i + 1),
    dimensions: pg.dimension || pg.dimensions || null,
    isEditable: pg.is_editable !== false,
    isEmpty: !!pg.is_empty,
    elements: [],
  }));
  const byNum = new Map(rawPages.map((pg, i) => [pg.page_number ?? pg.index ?? i + 1, pages[i]]));
  const pageFor = (n) => byNum.get(n) || pages[n - 1] || null;
  for (const rt of p.richtexts || []) {
    let pg = pageFor(rt.page_index ?? 1);
    if (!pg) { pg = { type: "fixed", id: "PB" + rt.page_index, dimensions: null, isEditable: true, elements: [] }; pages[rt.page_index - 1] = pg; }
    const pos = rt.containerElement?.position || {};
    const dim = rt.containerElement?.dimension || {};
    pg.elements.push({
      type: "text",
      id: rt.element_id,
      locator_id: rt.element_id, // the public server addresses edits by element_id directly
      top: pos.top ?? 0,
      left: pos.left ?? 0,
      width: dim.width ?? 200,
      height: dim.height ?? 50,
      rotation: rt.containerElement?.rotation ?? 0,
      opacity: rt.containerElement?.opacity ?? 1,
      textRegions: (rt.regions || [])
        .filter((r) => (r.text ?? r.characters ?? "") !== "")
        .map((r) => ({ characters: r.text ?? r.characters ?? "", formatting: r.formatting || {} })),
    });
  }
  return pages;
}

export async function readDesignAdapter(token, input, call = defaultCall) {
  const fields = input.filter?.fields || ["design_metadata", "design_content"];
  const out = { payload: {}, content: [] };
  const warnings = [];

  if (fields.includes("design_metadata") || input.open_transaction) {
    try {
      const r = await call(token, "get-design", { design_id: input.design_id });
      out.payload.design_metadata = r.payload.design || r.payload.design_metadata || r.payload;
    } catch (e) {
      if (!fields.includes("design_metadata")) warnings.push({ field: "design_metadata", code: "permission_denied" });
      else throw e;
    }
  }

  if (fields.includes("page_metadata")) {
    const r = await call(token, "get-design-pages", { design_id: input.design_id });
    out.payload.page_metadata = r.payload.items || r.payload.page_metadata || [];
  }

  if (fields.includes("thumbnails")) {
    const r = await call(token, "get-design-pages", { design_id: input.design_id });
    const items = r.payload.items || [];
    const want = input.filter?.thumbnail_pages || input.filter?.page_indices || [1];
    out.payload.thumbnails = [];
    for (const n of want) {
      const it = items.find((x) => (x.page_number ?? x.index) === n) || items[n - 1];
      const url = it?.thumbnail?.url;
      if (!url) continue;
      const block = await fetchImageBlock(url);
      if (block) out.content.push(block);
      out.payload.thumbnails.push({ page: n, url });
    }
  }

  if (input.open_transaction) {
    try {
      const r = await call(token, "start-editing-transaction", { design_id: input.design_id });
      const p = r.payload;
      const txid = p.transaction?.transaction_id || p.transaction_id;
      out.payload.transaction = { transaction_id: txid };
      out.payload.design_content = { title: out.payload.design_metadata?.title, pages: pagesFromTransaction(p) };
    } catch (e) {
      // View-only designs can't open a transaction: report it the way the page already understands.
      warnings.push({ field: "transaction", code: "permission_denied" }, { field: "design_content", code: "permission_denied" });
      out.payload.transaction_error = e.message;
    }
  } else if (fields.includes("design_content")) {
    const r = await call(token, "get-design-content", { design_id: input.design_id, content_types: ["richtexts"] });
    out.payload.design_content = typeof r.payload?.text === "string" ? r.payload.text : r.payload;
  }

  if (warnings.length) out.payload.warnings = warnings;
  return out;
}

// Operations the public server documents. Everything else (format_text, resize_element,
// position_element, add_text, replace_speaker_notes, …) is dropped and reported.
const SUPPORTED_OPS = new Set(["replace_text", "find_and_replace_text", "update_fill", "insert_fill"]);

export async function editDesignAdapter(token, input, call = defaultCall) {
  if (input.finalize === "commit") return call(token, "commit-editing-transaction", { transaction_id: input.transaction_id });
  if (input.finalize === "cancel") return call(token, "cancel-editing-transaction", { transaction_id: input.transaction_id });

  const dropped = [];
  const ops = (input.operations || [])
    .map((o) => {
      if (!SUPPORTED_OPS.has(o.type)) { dropped.push(o.type); return null; }
      const { locator_id, ...rest } = o;
      return locator_id ? { ...rest, element_id: locator_id } : rest;
    })
    .filter(Boolean);

  if (!ops.length) {
    return { payload: { skipped: true, dropped_operations: [...new Set(dropped)], note: "None of these operations exist on Canva's public API; nothing was changed." }, content: [] };
  }

  const r = await call(token, "perform-editing-operations", {
    transaction_id: input.transaction_id,
    page_index: input.page_index,
    operations: ops,
  });
  if (dropped.length) r.payload = { ...r.payload, dropped_operations: [...new Set(dropped)] };

  const failed = (r.payload?.edit_operation_results || []).filter((x) => x.status && x.status !== "success" && x.status !== "applied_unverified");
  if (failed.length) r.payload.failed_operations = failed;

  const th = r.payload?.thumbnails?.find((t) => t.url)?.url;
  if (th && !(r.content || []).some((b) => b.type === "image")) {
    const block = await fetchImageBlock(th);
    if (block) r.content = [...(r.content || []), block];
  }
  return r;
}
