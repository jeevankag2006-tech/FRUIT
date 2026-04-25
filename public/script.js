const STORAGE_KEY = "sunripe-cart";
const ORDER_HISTORY_KEY = "sunripe-order-history";
const MAX_HISTORY = 25;

/** @type {Array<{id:string,name:string,emoji:string,price:number,unit:string,note:string}>} */
let PRODUCTS = [];

const productGrid = document.getElementById("productGrid");
const productGridMsg = document.getElementById("productGridMsg");
const cartPanel = document.getElementById("cartPanel");
const cartBackdrop = document.getElementById("cartBackdrop");
const cartToggle = document.getElementById("cartToggle");
const cartClose = document.getElementById("cartClose");
const cartCount = document.getElementById("cartCount");
const cartItems = document.getElementById("cartItems");
const cartEmpty = document.getElementById("cartEmpty");
const cartFooter = document.getElementById("cartFooter");
const cartSubtotal = document.getElementById("cartSubtotal");
const checkoutBtn = document.getElementById("checkoutBtn");

const trackForm = document.getElementById("trackForm");
const trackingInput = document.getElementById("trackingInput");
const trackResult = document.getElementById("trackResult");
const ordersHistoryList = document.getElementById("ordersHistoryList");
const ordersHistoryEmpty = document.getElementById("ordersHistoryEmpty");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

function loadCart() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveCart(cart) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

let cart = loadCart();

function loadOrderHistory() {
  try {
    const raw = localStorage.getItem(ORDER_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveOrderHistory(entries) {
  localStorage.setItem(ORDER_HISTORY_KEY, JSON.stringify(entries));
}

function pushOrderHistory(entry) {
  const list = loadOrderHistory().filter((e) => e.trackingId !== entry.trackingId);
  list.unshift(entry);
  saveOrderHistory(list.slice(0, MAX_HISTORY));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function formatOrderDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function getProduct(id) {
  return PRODUCTS.find((p) => p.id === id);
}

function renderProducts() {
  const cards = PRODUCTS.map(
    (p) => `
    <article class="product-card" data-id="${p.id}">
      <div class="product-emoji" aria-hidden="true">${p.emoji}</div>
      <h3>${p.name}</h3>
      <p class="product-meta">${p.note}</p>
      <p class="product-price">${formatMoney(p.price)} <span style="font-weight:500;color:var(--muted);font-size:0.85rem">/ ${p.unit}</span></p>
      <button type="button" class="btn-add" data-add="${p.id}">Add to basket</button>
    </article>
  `
  ).join("");

  productGrid.innerHTML = cards;

  productGrid.querySelectorAll("[data-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-add");
      addToCart(id);
    });
  });
}

function showProductError(message) {
  productGrid.innerHTML = "";
  const p = document.createElement("p");
  p.className = "product-grid-msg is-error";
  p.id = "productGridMsg";
  p.textContent = message;
  productGrid.appendChild(p);
}

async function loadProductsFromApi() {
  if (productGridMsg) {
    productGridMsg.textContent = "Loading the market…";
    productGridMsg.classList.remove("is-error");
  }

  try {
    const res = await fetch("/api/products");
    if (!res.ok) throw new Error("Server returned an error");
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error("No products available");
    }
    PRODUCTS = data;
    renderProducts();
    updateCartUI();
  } catch {
    showProductError(
      "Could not load products. Start the server with npm start and open http://localhost:3000"
    );
  }
}

function trackingTimelineHtml(tracking) {
  if (!tracking || !Array.isArray(tracking.steps)) return "";
  const items = tracking.steps
    .map((step) => {
      const cls =
        step.status === "complete" ? "is-complete" : step.status === "current" ? "is-current" : "";
      let statusText = "Pending";
      if (step.status === "complete") statusText = "Done";
      if (step.status === "current") statusText = "In progress";
      return `
      <li class="${cls}">
        <div class="tl-label">${escapeHtml(step.label)}</div>
        <div class="tl-status">${statusText}</div>
      </li>`;
    })
    .join("");
  return `<ol class="tracking-timeline">${items}</ol>`;
}

function linesTableHtml(lines) {
  if (!lines || !lines.length) return "";
  const rows = lines
    .map(
      (l) => `
    <div class="track-line-row">
      <span>${l.emoji || ""} ${escapeHtml(l.name)} × ${l.qty}</span>
      <span>${formatMoney(l.lineTotal)}</span>
    </div>`
    )
    .join("");
  return `
    <div class="track-lines">
      <h4>Items</h4>
      ${rows}
    </div>`;
}

function showTrackingDetails(data) {
  if (!trackResult) return;
  trackResult.hidden = false;
  trackResult.classList.remove("is-error");
  const eta = data.tracking?.estimatedDelivery
    ? formatOrderDate(data.tracking.estimatedDelivery)
    : "—";
  trackResult.innerHTML = `
    <div class="track-result-header">
      <h3>${escapeHtml(data.tracking?.currentLabel || "Status")}</h3>
      <button type="button" class="btn-small" data-copy="${escapeHtml(data.trackingId)}">Copy tracking #</button>
    </div>
    <div class="track-meta">
      <span>Tracking <code>${escapeHtml(data.trackingId)}</code></span>
      <span>Order <code>${escapeHtml(data.orderId)}</code></span>
      <span>Carrier ${escapeHtml(data.carrier || "—")}</span>
      <span>Placed ${formatOrderDate(data.createdAt)}</span>
      <span>Subtotal <strong>${formatMoney(data.subtotal)}</strong></span>
      <span>Est. delivery ${eta}</span>
    </div>
    ${trackingTimelineHtml(data.tracking)}
    ${linesTableHtml(data.lines)}
  `;

  const copyBtn = trackResult.querySelector("[data-copy]");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      const t = copyBtn.getAttribute("data-copy") || "";
      try {
        await navigator.clipboard.writeText(t);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy tracking #";
        }, 1600);
      } catch {
        copyBtn.textContent = "Copy failed";
      }
    });
  }
}

function showTrackError(message) {
  if (!trackResult) return;
  trackResult.hidden = false;
  trackResult.classList.add("is-error");
  trackResult.innerHTML = `<p class="track-result-msg">${escapeHtml(message)}</p>`;
}

function hideTrackResult() {
  if (!trackResult) return;
  trackResult.hidden = true;
  trackResult.classList.remove("is-error");
  trackResult.innerHTML = "";
}

async function renderOrderHistory() {
  if (!ordersHistoryList || !ordersHistoryEmpty || !clearHistoryBtn) return;

  const items = loadOrderHistory();
  if (items.length === 0) {
    ordersHistoryEmpty.hidden = false;
    ordersHistoryList.innerHTML = "";
    clearHistoryBtn.hidden = true;
    return;
  }

  ordersHistoryEmpty.hidden = true;
  clearHistoryBtn.hidden = false;

  const trackingIds = items.map((i) => i.trackingId);
  /** @type {Record<string, any>} */
  const summaryByTid = {};
  try {
    const res = await fetch("/api/orders/summaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trackingIds }),
    });
    if (res.ok) {
      const data = await res.json();
      for (const o of data.orders || []) {
        if (o.found && o.trackingId) summaryByTid[o.trackingId] = o;
      }
    }
  } catch {
    /* offline: show local-only rows */
  }

  ordersHistoryList.innerHTML = items
    .map((entry) => {
      const s = summaryByTid[entry.trackingId];
      const statusLine = s?.found === false ? "Order not found on server" : s?.currentLabel || "Tap track for status";
      const sub = typeof s?.subtotal === "number" ? s.subtotal : entry.subtotal;
      return `
      <li class="orders-history-item">
        <div class="orders-history-main">
          <strong><code>${escapeHtml(entry.trackingId)}</code></strong>
          <span>${formatOrderDate(entry.placedAt)} · ${formatMoney(sub)}</span>
        </div>
        <div class="orders-history-status">${escapeHtml(statusLine)}</div>
        <div class="orders-history-actions">
          <button type="button" class="btn-small" data-track-id="${escapeHtml(entry.trackingId)}">Track</button>
          <button type="button" class="btn-small" data-copy-id="${escapeHtml(entry.trackingId)}">Copy #</button>
        </div>
      </li>`;
    })
    .join("");

  ordersHistoryList.querySelectorAll("[data-track-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-track-id");
      if (!id) return;
      if (trackingInput) trackingInput.value = id;
      await runTrackLookup(id);
      trackResult?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  ordersHistoryList.querySelectorAll("[data-copy-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-copy-id") || "";
      try {
        await navigator.clipboard.writeText(id);
        btn.textContent = "Copied";
        setTimeout(() => {
          btn.textContent = "Copy #";
        }, 1400);
      } catch {
        btn.textContent = "Failed";
      }
    });
  });
}

async function runTrackLookup(raw) {
  const q = String(raw || "").trim();
  if (!q) {
    showTrackError("Enter a tracking number or order ID.");
    return;
  }
  try {
    const res = await fetch(`/api/orders/track/${encodeURIComponent(q)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showTrackError(data.error || "No order found.");
      return;
    }
    showTrackingDetails(data);
  } catch {
    showTrackError("Could not reach the server.");
  }
}

function cartItemCount() {
  return Object.values(cart).reduce((sum, qty) => sum + qty, 0);
}

function cartSubtotalValue() {
  let total = 0;
  for (const [id, qty] of Object.entries(cart)) {
    const p = getProduct(id);
    if (p) total += p.price * qty;
  }
  return total;
}

function addToCart(id) {
  const p = getProduct(id);
  if (!p) return;
  cart[id] = (cart[id] || 0) + 1;
  saveCart(cart);
  updateCartUI();
  openCart();
}

function setQty(id, qty) {
  if (qty <= 0) {
    delete cart[id];
  } else {
    cart[id] = qty;
  }
  saveCart(cart);
  updateCartUI();
}

function updateCartUI() {
  const count = cartItemCount();
  if (count > 0) {
    cartCount.hidden = false;
    cartCount.textContent = String(count);
  } else {
    cartCount.hidden = true;
  }

  const ids = Object.keys(cart);
  if (ids.length === 0) {
    cartEmpty.hidden = false;
    cartFooter.hidden = true;
    cartItems.innerHTML = "";
  } else {
    cartEmpty.hidden = true;
    cartFooter.hidden = false;
    cartItems.innerHTML = ids
      .map((id) => {
        const p = getProduct(id);
        if (!p) return "";
        const qty = cart[id];
        const line = p.price * qty;
        return `
        <div class="cart-row" data-cart-row="${id}">
          <span class="cart-row-emoji" aria-hidden="true">${p.emoji}</span>
          <div class="cart-row-info">
            <strong>${p.name}</strong>
            <span>${formatMoney(p.price)} × ${qty}</span>
          </div>
          <div class="cart-row-actions">
            <span class="cart-row-price">${formatMoney(line)}</span>
            <div class="qty-control">
              <button type="button" data-dec="${id}" aria-label="Decrease ${p.name}">−</button>
              <span>${qty}</span>
              <button type="button" data-inc="${id}" aria-label="Increase ${p.name}">+</button>
            </div>
          </div>
        </div>`;
      })
      .join("");

    cartItems.querySelectorAll("[data-inc]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-inc");
        setQty(id, (cart[id] || 0) + 1);
      });
    });
    cartItems.querySelectorAll("[data-dec]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-dec");
        setQty(id, (cart[id] || 0) - 1);
      });
    });
  }

  cartSubtotal.textContent = formatMoney(cartSubtotalValue());
}

function openCart() {
  cartPanel.hidden = false;
  cartBackdrop.hidden = false;
  requestAnimationFrame(() => {
    cartPanel.classList.add("is-open");
    cartBackdrop.classList.add("is-open");
  });
  document.body.classList.add("cart-open");
  cartToggle.setAttribute("aria-expanded", "true");
}

function closeCart() {
  cartPanel.classList.remove("is-open");
  cartBackdrop.classList.remove("is-open");
  cartToggle.setAttribute("aria-expanded", "false");
  document.body.classList.remove("cart-open");
  const onEnd = () => {
    cartPanel.hidden = true;
    cartBackdrop.hidden = true;
    cartPanel.removeEventListener("transitionend", onEnd);
  };
  cartPanel.addEventListener("transitionend", onEnd);
}

cartToggle.addEventListener("click", () => {
  if (cartPanel.classList.contains("is-open")) closeCart();
  else openCart();
});

cartClose.addEventListener("click", closeCart);
cartBackdrop.addEventListener("click", closeCart);

checkoutBtn.addEventListener("click", async () => {
  if (cartItemCount() === 0) return;
  checkoutBtn.disabled = true;
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: cart }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Order could not be placed");
    }

    pushOrderHistory({
      trackingId: data.trackingId,
      orderId: data.orderId,
      placedAt: data.createdAt,
      subtotal: data.subtotal,
    });

    cart = {};
    saveCart(cart);
    updateCartUI();
    closeCart();

    await renderOrderHistory();
    showTrackingDetails(data);
    trackResult?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    alert(e instanceof Error ? e.message : "Something went wrong");
  } finally {
    checkoutBtn.disabled = false;
  }
});

trackForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const raw = trackingInput?.value || "";
  await runTrackLookup(raw);
  trackResult?.scrollIntoView({ behavior: "smooth", block: "start" });
});

clearHistoryBtn?.addEventListener("click", () => {
  saveOrderHistory([]);
  renderOrderHistory();
  hideTrackResult();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && cartPanel.classList.contains("is-open")) closeCart();
});

loadProductsFromApi();
renderOrderHistory();
