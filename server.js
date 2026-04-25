const path = require("path");
const fs = require("fs/promises");
const express = require("express");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, "public");
const PRODUCTS_FILE = path.join(ROOT, "data", "products.json");
const ORDERS_FILE = path.join(ROOT, "data", "orders.json");

const CARRIER_DEFAULT = "Sunripe Local";

const TRACK_STEPS = [
  { key: "received", label: "Order received" },
  { key: "preparing", label: "Picking & packing" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
];

const app = express();
app.use(express.json({ limit: "100kb" }));

function generateTrackingCode() {
  return crypto.randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
}

function normalizeTrackingId(raw) {
  if (raw == null || typeof raw !== "string") return "";
  let s = raw.trim().toUpperCase().replace(/^#/, "");
  s = s.replace(/\s+/g, "");
  s = s.replace(/^SR-?/, "");
  if (/^[A-F0-9]{6}$/.test(s)) return `SR-${s}`;
  return raw.trim().toUpperCase();
}

function buildTrackingTimeline(createdAt) {
  const t0 = new Date(createdAt).getTime();
  if (Number.isNaN(t0)) {
    return {
      currentStep: "received",
      currentLabel: "Order received",
      steps: TRACK_STEPS.map((s, i) => ({
        key: s.key,
        label: s.label,
        status: i === 0 ? "current" : "pending",
      })),
      estimatedDelivery: null,
    };
  }
  const elapsed = Date.now() - t0;
  const m = 60 * 1000;
  let idx = 0;
  if (elapsed >= 45 * m) idx = 3;
  else if (elapsed >= 15 * m) idx = 2;
  else if (elapsed >= 2 * m) idx = 1;

  const steps = TRACK_STEPS.map((s, i) => ({
    key: s.key,
    label: s.label,
    status: i < idx ? "complete" : i === idx ? "current" : "pending",
  }));

  const etaMs = 45 * m;
  const estimatedDelivery = new Date(t0 + etaMs).toISOString();

  return {
    currentStep: TRACK_STEPS[idx].key,
    currentLabel: TRACK_STEPS[idx].label,
    steps,
    estimatedDelivery,
  };
}

function publicOrderPayload(order) {
  const tracking = buildTrackingTimeline(order.createdAt);
  return {
    orderId: order.orderId,
    trackingId: order.trackingId,
    carrier: order.carrier || CARRIER_DEFAULT,
    createdAt: order.createdAt,
    subtotal: order.subtotal,
    lines: order.lines,
    tracking,
  };
}

async function loadProducts() {
  const raw = await fs.readFile(PRODUCTS_FILE, "utf8");
  const list = JSON.parse(raw);
  if (!Array.isArray(list)) throw new Error("Invalid products file");
  return list;
}

function productMap(products) {
  return new Map(products.map((p) => [p.id, p]));
}

async function readOrders() {
  try {
    const raw = await fs.readFile(ORDERS_FILE, "utf8");
    const data = JSON.parse(raw);
    const orders = Array.isArray(data) ? data : [];
    await backfillOrders(orders);
    return orders;
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

async function backfillOrders(orders) {
  const used = new Set(
    orders.map((o) => o.trackingId).filter(Boolean)
  );
  let dirty = false;
  for (const o of orders) {
    if (!o.trackingId) {
      let code;
      let tid;
      do {
        code = generateTrackingCode();
        tid = `SR-${code}`;
      } while (used.has(tid));
      used.add(tid);
      o.trackingId = tid;
      dirty = true;
    }
    if (!o.carrier) {
      o.carrier = CARRIER_DEFAULT;
      dirty = true;
    }
  }
  if (dirty) await saveOrders(orders);
}

async function saveOrders(orders) {
  await fs.mkdir(path.dirname(ORDERS_FILE), { recursive: true });
  await fs.writeFile(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");
}

function findOrder(orders, query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const norm = normalizeTrackingId(q);
  return (
    orders.find((o) => o.orderId === q) ||
    orders.find((o) => normalizeTrackingId(o.trackingId) === norm) ||
    null
  );
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/products", async (_req, res) => {
  try {
    const products = await loadProducts();
    res.json(products);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load products" });
  }
});

app.get("/api/orders/track/:id", async (req, res) => {
  try {
    const orders = await readOrders();
    const order = findOrder(orders, req.params.id);
    if (!order) {
      return res.status(404).json({ error: "No order found for that tracking or order id" });
    }
    res.json(publicOrderPayload(order));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not look up order" });
  }
});

app.post("/api/orders/summaries", async (req, res) => {
  const ids = req.body?.trackingIds;
  if (!Array.isArray(ids)) {
    return res.status(400).json({ error: "Request body must include trackingIds array" });
  }
  const normalized = [...new Set(ids.map((x) => normalizeTrackingId(String(x))).filter(Boolean))].slice(
    0,
    30
  );
  try {
    const orders = await readOrders();
    const summaries = normalized.map((tid) => {
      const order = findOrder(orders, tid);
      if (!order) {
        return { trackingId: tid, found: false };
      }
      const tracking = buildTrackingTimeline(order.createdAt);
      return {
        found: true,
        trackingId: order.trackingId,
        orderId: order.orderId,
        createdAt: order.createdAt,
        subtotal: order.subtotal,
        carrier: order.carrier || CARRIER_DEFAULT,
        currentStep: tracking.currentStep,
        currentLabel: tracking.currentLabel,
        estimatedDelivery: tracking.estimatedDelivery,
        lineCount: order.lines?.length ?? 0,
      };
    });
    res.json({ orders: summaries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not load order summaries" });
  }
});

app.post("/api/orders", async (req, res) => {
  const { items, email } = req.body || {};
  if (!items || typeof items !== "object" || Array.isArray(items)) {
    return res.status(400).json({ error: "Request body must include an items object" });
  }

  let products;
  try {
    products = await loadProducts();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not load catalog" });
  }

  const catalog = productMap(products);
  const lines = [];
  let subtotal = 0;

  for (const [productId, rawQty] of Object.entries(items)) {
    const qty = Number(rawQty);
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ error: `Invalid quantity for ${productId}` });
    }
    const product = catalog.get(productId);
    if (!product) {
      return res.status(400).json({ error: `Unknown product: ${productId}` });
    }
    const lineTotal = Math.round(product.price * qty * 100) / 100;
    subtotal += lineTotal;
    lines.push({
      id: product.id,
      name: product.name,
      emoji: product.emoji,
      qty,
      unit: product.unit,
      unitPrice: product.price,
      lineTotal,
    });
  }

  if (lines.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  subtotal = Math.round(subtotal * 100) / 100;

  const orders = await readOrders();
  const used = new Set(orders.map((o) => o.trackingId).filter(Boolean));
  let trackingId;
  do {
    trackingId = `SR-${generateTrackingCode()}`;
  } while (used.has(trackingId));

  const order = {
    orderId: crypto.randomUUID(),
    trackingId,
    carrier: CARRIER_DEFAULT,
    createdAt: new Date().toISOString(),
    email: typeof email === "string" && email.trim() ? email.trim().slice(0, 320) : null,
    subtotal,
    lines,
  };

  try {
    orders.push(order);
    await saveOrders(orders);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Could not save order" });
  }

  const payload = publicOrderPayload(order);
  res.status(201).json(payload);
});

app.use(
  express.static(PUBLIC, {
    fallthrough: true,
  })
);

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(PUBLIC, "index.html"));
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Server error" });
});

app.listen(PORT, () => {
  console.log(`Sunripe server at http://localhost:${PORT}`);
});
