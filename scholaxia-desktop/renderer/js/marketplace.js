/** Scholaxia Marketplace — cart flow (matches the website): add to cart,
 *  guest cart for logged-out users, drawer, Paystack checkout. */

var mpProducts = [];
var mpCategory = "all";
var mpSearchQ = "";
var mpGuestCart = [];
var MP_CART_KEY = "sia_market_guest_cart";

var MP_TABS = [
  { id: "all", label: "All" },
  { id: "books", label: "Books" },
  { id: "soft_copy", label: "Soft copy / PDF" },
  { id: "software", label: "Software" },
  { id: "educational_materials", label: "Educational materials" },
  { id: "phones", label: "Phones" },
  { id: "gadgets", label: "Gadgets" },
  { id: "flash_drive", label: "Flash drive" },
  { id: "charger", label: "Charger" },
  { id: "projector", label: "Projector" },
  { id: "desktop_computer", label: "Desktop computer" },
  { id: "bags", label: "Bags" },
  { id: "laptops", label: "Laptops" },
  { id: "other", label: "Other" },
];

function mpEsc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function mpAttr(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mpPrice(p) {
  if (p.is_free || Number(p.price || 0) <= 0) return "Free";
  return "₦" + Number(p.price || 0).toLocaleString("en-NG");
}

function mpMoney(n) {
  n = Number(n || 0);
  return "₦" + n.toLocaleString("en-NG");
}

function mpPublicDesc(p) {
  var d = String(p.description || "");
  var cut = d.indexOf("SIA_META:");
  if (cut >= 0) d = d.slice(0, cut);
  cut = d.indexOf("---");
  if (cut >= 0 && d.indexOf("{") > cut) d = d.slice(0, cut);
  return d.replace(/\{"condition".*$/, "").trim();
}

function mpImageUrl(url) {
  if (!url) return "";
  var u = String(url).trim();
  if (!u) return "";
  if (u.indexOf("//") === 0) u = "https:" + u;
  if (/^http:\/\//i.test(u)) u = "https://" + u.slice(7);
  if (/^https?:\/\//i.test(u)) return u;
  var base = typeof API_BASE !== "undefined" ? API_BASE : "";
  return base + (u.startsWith("/") ? u : "/" + u);
}

/* ── Cart state ─────────────────────────────────────────────────────────── */

function mpLoadGuestCart() {
  try {
    mpGuestCart = JSON.parse(localStorage.getItem(MP_CART_KEY) || "[]") || [];
  } catch (e) {
    mpGuestCart = [];
  }
}

function mpSaveGuestCart() {
  try {
    localStorage.setItem(MP_CART_KEY, JSON.stringify(mpGuestCart));
  } catch (e) { /* ignore */ }
}

function mpCartCount() {
  if (isStudentLoggedIn()) return mpCartCount._server || 0;
  return mpGuestCart.reduce(function (sum, it) {
    return sum + (Number(it.quantity) || 1);
  }, 0);
}

function mpSetCartBadge() {
  var els = document.querySelectorAll(".mp-cart-badge");
  var n = mpCartCount();
  els.forEach(function (el) {
    if (n > 0) {
      el.textContent = n > 99 ? "99+" : String(n);
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
}

async function mpSyncServerCartCount() {
  if (!isStudentLoggedIn()) {
    mpCartCount._server = 0;
    mpSetCartBadge();
    return;
  }
  try {
    var cart = await api("/api/v1/marketplace/cart");
    var items = (cart && cart.items) || [];
    mpCartCount._server = items.reduce(function (s, it) {
      return s + (Number(it.quantity) || 1);
    }, 0);
  } catch (e) {
    mpCartCount._server = 0;
  }
  mpSetCartBadge();
}

async function mpFlushGuestCartToServer() {
  if (!isStudentLoggedIn() || !mpGuestCart.length) return;
  for (var i = 0; i < mpGuestCart.length; i++) {
    var it = mpGuestCart[i];
    try {
      await api("/api/v1/marketplace/cart/add", {
        method: "POST",
        body: JSON.stringify({ product_id: it.product_id, quantity: it.quantity || 1 }),
      });
    } catch (e) { /* keep going */ }
  }
  mpGuestCart = [];
  mpSaveGuestCart();
}

/* ── Toast ──────────────────────────────────────────────────────────────── */

var _mpToastTimer = null;
function mpToast(msg) {
  var el = document.getElementById("mp-toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "mp-toast";
    el.className = "mp-toast";
    document.body.appendChild(el);
  }
  el.textContent = String(msg || "");
  el.classList.add("show");
  clearTimeout(_mpToastTimer);
  _mpToastTimer = setTimeout(function () {
    el.classList.remove("show");
  }, 2600);
}

/* ── Page load / tabs / grid ────────────────────────────────────────────── */

async function loadMarketplacePage() {
  var grid = document.getElementById("marketplace-grid");
  if (!grid) return;
  grid.innerHTML = '<div class="loading">Loading marketplace…</div>';
  renderMarketplaceTabs();
  mpLoadGuestCart();
  mpSetCartBadge();
  mpSyncServerCartCount();

  var searchEl = document.getElementById("marketplace-search");
  if (searchEl && !searchEl._bound) {
    searchEl._bound = true;
    searchEl.addEventListener("input", function () {
      mpSearchQ = (searchEl.value || "").trim().toLowerCase();
      renderMarketplaceGrid();
    });
  }
  try {
    var url = "/api/v1/marketplace/products";
    if (mpCategory && mpCategory !== "all") url += "?category=" + encodeURIComponent(mpCategory);
    var rows = await api(url);
    mpProducts = Array.isArray(rows) ? rows : (rows && rows.products) || [];
    renderMarketplaceGrid();
  } catch (e) {
    grid.innerHTML = '<div class="empty-state-premium"><h3>Could not load shop</h3><p>' + mpEsc(e.message) + "</p></div>";
  }
}

function renderMarketplaceTabs() {
  var el = document.getElementById("marketplace-tabs");
  if (!el) return;
  el.innerHTML = MP_TABS.map(function (t) {
    return '<button type="button" class="mp-tab' + (mpCategory === t.id ? " active" : "") + '" onclick="setMarketplaceCategory(\'' + t.id + '\')">' + mpEsc(t.label) + "</button>";
  }).join("");
}

function setMarketplaceCategory(cat) {
  mpCategory = cat;
  loadMarketplacePage();
}

function renderMarketplaceGrid() {
  var grid = document.getElementById("marketplace-grid");
  if (!grid) return;
  var rows = mpProducts.filter(function (p) {
    if (!mpSearchQ) return true;
    var hay = ((p.title || "") + " " + mpPublicDesc(p) + " " + (p.category || "")).toLowerCase();
    return hay.indexOf(mpSearchQ) >= 0;
  });
  if (!rows.length) {
    grid.innerHTML = '<div class="empty-state-premium"><div class="empty-icon">&#128722;</div><h3>No products yet</h3><p>Admin will add gadgets, laptops, phones and books here. Free items show as Free.</p></div>';
    return;
  }
  grid.innerHTML = rows.map(function (p, i) {
    var img = mpImageUrl(p.image_url || p.secure_url || p.image || "");
    var hasPrice = Number(p.price || 0) > 0 && !p.is_free;
    return (
      '<div class="mp-product-card sx-card" style="animation-delay:' + Math.min(i, 14) * 0.06 + 's">' +
      (img
        ? '<div class="mp-product-img"><img src="' +
          mpAttr(img) +
          '" alt="' +
          mpAttr(p.title || "Product") +
          '" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add(\'mp-product-img-placeholder\');this.remove();" /></div>'
        : '<div class="mp-product-img mp-product-img-placeholder">&#128722;</div>') +
      '<div class="mp-product-body">' +
      '<span class="mp-product-cat">' + mpEsc(p.category || "item") + "</span>" +
      "<h3>" + mpEsc(p.title) + "</h3>" +
      '<p class="mp-product-desc">' + mpEsc(mpPublicDesc(p).slice(0, 100)) + "</p>" +
      '<div class="mp-product-footer">' +
      '<strong class="mp-price">' + mpPrice(p) + "</strong>" +
      (hasPrice
        ? '<button type="button" class="btn-action btn-sm" onclick="mpAddToCart(\'' + mpEsc(String(p.id)) + '\')">Add to cart</button>'
        : '<button type="button" class="btn-action btn-sm" onclick="mpAddToCart(\'' + mpEsc(String(p.id)) + '\')">Add to cart</button>') +
      "</div></div></div>"
    );
  }).join("");
}

/* ── Add to cart ────────────────────────────────────────────────────────── */

async function mpAddToCart(productId) {
  var product = mpProducts.find(function (p) {
    return String(p.id) === String(productId);
  });
  if (!product) return;
  if (!(Number(product.price) > 0) || product.is_free) {
    mpToast("This item has no checkout price yet.");
    return;
  }

  if (!isStudentLoggedIn()) {
    var existing = mpGuestCart.find(function (it) {
      return String(it.product_id) === String(productId);
    });
    if (existing) {
      existing.quantity = (Number(existing.quantity) || 1) + 1;
      if (!existing.image_url) existing.image_url = mpImageUrl(product.image_url || product.secure_url || product.image || "");
    } else {
      mpGuestCart.push({
        product_id: productId,
        title: product.title || "Product",
        price: Number(product.price || 0),
        quantity: 1,
        image_url: mpImageUrl(product.image_url || product.secure_url || product.image || ""),
      });
    }
    mpSaveGuestCart();
    mpSetCartBadge();
    mpToast("Added to cart — sign in at checkout");
    mpBounceCartBtn();
    return;
  }

  try {
    await api("/api/v1/marketplace/cart/add", {
      method: "POST",
      body: JSON.stringify({ product_id: productId, quantity: 1 }),
    });
    await mpSyncServerCartCount();
    mpToast("Added to cart");
    mpBounceCartBtn();
  } catch (err) {
    mpToast((err && err.message) || "Could not add to cart");
  }
}

function mpBounceCartBtn() {
  var btn = document.getElementById("mp-cart-fab");
  if (!btn) return;
  btn.classList.remove("bump");
  void btn.offsetWidth;
  btn.classList.add("bump");
}

/* ── Cart drawer ────────────────────────────────────────────────────────── */

function mpCartRowHtml(title, qty, linePrice, removeHtml, imageUrl) {
  var thumb = imageUrl
    ? '<img class="mp-cart-thumb" src="' + mpAttr(String(imageUrl).replace(/"/g, "")) + '" alt="" />'
    : '<div class="mp-cart-thumb mp-cart-thumb-empty" aria-hidden="true">&#128722;</div>';
  return (
    '<div class="mp-cart-row">' +
    thumb +
    '<div class="mp-cart-meta"><strong>' + mpEsc(title) + "</strong><span>Qty " + qty + " · " + mpMoney(linePrice) + "</span></div>" +
    removeHtml +
    "</div>"
  );
}

async function mpRenderCartBody() {
  var body = document.getElementById("mp-cart-body");
  var totalEl = document.getElementById("mp-cart-total");
  if (!body) return;

  if (isStudentLoggedIn()) {
    try {
      var cart = await api("/api/v1/marketplace/cart");
      var items = (cart && cart.items) || [];
      mpCartCount._server = items.reduce(function (s, it) {
        return s + (Number(it.quantity) || 1);
      }, 0);
      mpSetCartBadge();
      if (!items.length) {
        body.innerHTML = '<p class="mp-cart-empty">Your cart is empty.</p>';
        if (totalEl) totalEl.textContent = mpMoney(0);
        return;
      }
      body.innerHTML = items
        .map(function (it) {
          var title = (it.product && it.product.title) || it.title || "Product";
          var img = mpImageUrl((it.product && (it.product.image_url || it.product.secure_url)) || it.image_url || "");
          return mpCartRowHtml(
            title,
            it.quantity || 1,
            it.line_total || 0,
            '<button type="button" class="mp-cart-remove" data-mp-remove="' + mpAttr(String(it.id || "")) + '">Remove</button>',
            img
          );
        })
        .join("");
      if (totalEl) totalEl.textContent = mpMoney(cart.total_amount || 0);
    } catch (err) {
      body.innerHTML = '<p class="mp-cart-empty">' + mpEsc((err && err.message) || "Could not load cart") + "</p>";
    }
    return;
  }

  if (!mpGuestCart.length) {
    body.innerHTML = '<p class="mp-cart-empty">Your cart is empty.</p>';
    if (totalEl) totalEl.textContent = mpMoney(0);
    return;
  }
  var total = 0;
  body.innerHTML = mpGuestCart
    .map(function (it, idx) {
      var line = (Number(it.price) || 0) * (Number(it.quantity) || 1);
      total += line;
      return mpCartRowHtml(
        it.title || "Product",
        it.quantity || 1,
        line,
        '<button type="button" class="mp-cart-remove" data-mp-remove-guest="' + idx + '">Remove</button>',
        it.image_url || ""
      );
    })
    .join("");
  if (totalEl) totalEl.textContent = mpMoney(total);
}

function openMarketplaceCart() {
  var drawer = document.getElementById("mp-cart-drawer");
  if (!drawer) return;
  drawer.classList.remove("hidden");
  mpRenderCartBody();
}

function closeMarketplaceCart() {
  var drawer = document.getElementById("mp-cart-drawer");
  if (drawer) drawer.classList.add("hidden");
}

/* ── Checkout ───────────────────────────────────────────────────────────── */

async function mpBeginCheckout() {
  if (!isStudentLoggedIn()) {
    goToLogin("marketplace");
    return;
  }
  if (mpGuestCart.length) await mpFlushGuestCartToServer();
  await mpRenderCartBody();
  if (!(mpCartCount() > 0)) {
    mpToast("Your cart is empty.");
    return;
  }
  closeMarketplaceCart();
  var modal = document.getElementById("mp-checkout-modal");
  if (modal) {
    document.getElementById("mp-checkout-error").textContent = "";
    modal.classList.remove("hidden");
  }
}

function closeMarketplaceCheckout() {
  var modal = document.getElementById("mp-checkout-modal");
  if (modal) modal.classList.add("hidden");
}

async function mpSubmitCheckout(e) {
  e.preventDefault();
  var errEl = document.getElementById("mp-checkout-error");
  var btn = document.getElementById("mp-checkout-submit");
  var address = document.getElementById("mp-checkout-address").value.trim();
  var phone = document.getElementById("mp-checkout-phone").value.trim();
  if (address.length < 5) {
    errEl.textContent = "Enter a fuller delivery address.";
    return;
  }
  if (phone.length < 7) {
    errEl.textContent = "Enter a valid phone number.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Creating order…";
  errEl.textContent = "";
  try {
    var res = await api("/api/v1/marketplace/checkout", {
      method: "POST",
      body: JSON.stringify({ delivery_address: address, contact_phone: phone }),
    });
    var orderId = res && res.order_id;
    if (!orderId) throw new Error("Checkout did not return an order id.");

    closeMarketplaceCheckout();
    closeMarketplaceCart();
    await mpSyncServerCartCount();

    if (typeof paystackPurchase === "function") {
      await paystackPurchase({
        productType: "marketplace_order",
        productId: String(orderId),
      });
    } else {
      mpToast("Order created. Complete payment from My orders.");
    }
  } catch (err) {
    errEl.textContent = (err && err.message) || "Checkout failed";
  } finally {
    btn.disabled = false;
    btn.textContent = "Pay with Paystack";
  }
}

/* ── Event wiring ───────────────────────────────────────────────────────── */

document.addEventListener("click", function (e) {
  var removeBtn = e.target.closest("[data-mp-remove]");
  if (removeBtn) {
    var id = removeBtn.getAttribute("data-mp-remove");
    api("/api/v1/marketplace/cart/" + encodeURIComponent(id), { method: "DELETE" })
      .then(function () {
        return mpRenderCartBody();
      })
      .then(function () {
        return mpSyncServerCartCount();
      })
      .catch(function (err) {
        mpToast((err && err.message) || "Could not remove item");
      });
    return;
  }
  var guestRemove = e.target.closest("[data-mp-remove-guest]");
  if (guestRemove) {
    var idx = Number(guestRemove.getAttribute("data-mp-remove-guest"));
    if (!isNaN(idx)) {
      mpGuestCart.splice(idx, 1);
      mpSaveGuestCart();
      mpRenderCartBody();
      mpSetCartBadge();
    }
    return;
  }
  if (e.target.closest("[data-mp-close-cart]")) closeMarketplaceCart();
});

if (typeof window !== "undefined") {
  window.loadMarketplacePage = loadMarketplacePage;
  window.setMarketplaceCategory = setMarketplaceCategory;
  window.mpAddToCart = mpAddToCart;
  window.openMarketplaceCart = openMarketplaceCart;
  window.closeMarketplaceCart = closeMarketplaceCart;
  window.mpBeginCheckout = mpBeginCheckout;
  window.closeMarketplaceCheckout = closeMarketplaceCheckout;
  window.mpSubmitCheckout = mpSubmitCheckout;
}
