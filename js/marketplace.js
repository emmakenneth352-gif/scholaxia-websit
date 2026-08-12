(function () {
  var api = window.ScholaxiaAPI;
  var products = [];
  var activeCat = "all";
  var searchQuery = "";
  var guestCart = [];
  var CART_KEY = "sia_market_guest_cart";
  var META_RE = /\n*---\nSIA_META:(\{[\s\S]*?\})\s*$/;

  function $(id) {
    return document.getElementById(id);
  }

  function parseMeta(description) {
    var raw = String(description || "");
    var m = raw.match(META_RE);
    var meta = {};
    if (m) {
      try {
        meta = JSON.parse(m[1]) || {};
      } catch (e) {
        meta = {};
      }
    }
    return {
      meta: meta,
      description: raw.replace(META_RE, "").trim(),
    };
  }

  function productImages(p) {
    var parsed = parseMeta(p.description);
    var imgs = [];
    if (parsed.meta && Array.isArray(parsed.meta.images)) {
      imgs = parsed.meta.images.filter(Boolean);
    }
    if (p.image_url) imgs.unshift(p.image_url);
    var seen = {};
    return imgs.filter(function (u) {
      if (!u || seen[u]) return false;
      seen[u] = true;
      return true;
    });
  }

  function money(n) {
    var v = Math.round(Number(n) || 0);
    return "₦" + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function toast(msg) {
    var el = $("mktToast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.hidden = true;
    }, 2600);
  }

  function isBuyerLoggedIn() {
    var role = (localStorage.getItem("sia_role") || "").toLowerCase();
    return !!(api.getToken() && (role === "student" || role === "kind"));
  }

  function loadGuestCart() {
    try {
      guestCart = JSON.parse(localStorage.getItem(CART_KEY) || "[]") || [];
    } catch (e) {
      guestCart = [];
    }
  }

  function saveGuestCart() {
    localStorage.setItem(CART_KEY, JSON.stringify(guestCart));
  }

  function cartCount() {
    if (isBuyerLoggedIn()) return cartCount._server || 0;
    return guestCart.reduce(function (sum, it) {
      return sum + (it.quantity || 1);
    }, 0);
  }

  function setCartBadge() {
    var el = $("cartCount");
    if (el) el.textContent = String(cartCount());
  }

  function openRoleModal() {
    $("roleModal").hidden = false;
  }

  function closeRoleModal() {
    $("roleModal").hidden = true;
  }

  function openCheckoutModal() {
    $("checkoutModal").hidden = false;
  }

  function closeCheckoutModal() {
    $("checkoutModal").hidden = true;
  }

  function goAuth(pick) {
    if (pick === "vendor") {
      window.location.href =
        "auth.html?mode=signup&role=vendor&market=1&next=" +
        encodeURIComponent("vendor.html");
      return;
    }
    window.location.href =
      "auth.html?mode=signup&role=student&market=1&next=" +
      encodeURIComponent("marketplace.html?checkout=1");
  }

  function onJoinClick() {
    if (isBuyerLoggedIn()) {
      toast("You're already signed in as a buyer.");
      openCart();
      return;
    }
    openRoleModal();
  }

  async function syncServerCartCount() {
    if (!isBuyerLoggedIn()) {
      cartCount._server = 0;
      setCartBadge();
      return;
    }
    try {
      var cart = await api.api("/api/v1/marketplace/cart");
      var items = (cart && cart.items) || [];
      cartCount._server = items.reduce(function (s, it) {
        return s + (it.quantity || 1);
      }, 0);
    } catch (e) {
      cartCount._server = 0;
    }
    setCartBadge();
  }

  async function flushGuestCartToServer() {
    if (!isBuyerLoggedIn() || !guestCart.length) return;
    for (var i = 0; i < guestCart.length; i++) {
      var it = guestCart[i];
      try {
        await api.api("/api/v1/marketplace/cart/add", {
          method: "POST",
          body: { product_id: it.product_id, quantity: it.quantity || 1 },
        });
      } catch (e) { /* skip bad lines */ }
    }
    guestCart = [];
    saveGuestCart();
  }

  function filteredProducts() {
    var list = products.filter(function (p) {
      // Soft-deleted / unlisted products must not appear on the market floor
      if (p.is_available === false || p.is_active === false) return false;
      if (p.stock_qty != null && Number(p.stock_qty) <= 0) return false;
      return true;
    });
    if (activeCat !== "all") {
      list = list.filter(function (p) {
        return (p.category || "").toLowerCase() === activeCat;
      });
    }
    var q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(function (p) {
      var hay = [p.title, p.name, p.description, p.category].join(" ").toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function renderTabs() {
    var wrap = $("mktTabs");
    if (!wrap) return;
    var cats = ["all"].concat(
      Array.from(
        new Set(
          products
            .map(function (p) {
              return (p.category || "").toLowerCase();
            })
            .filter(Boolean)
        )
      )
    );
    wrap.innerHTML = cats
      .map(function (c) {
        var label = c === "all" ? "All" : c.charAt(0).toUpperCase() + c.slice(1);
        return (
          '<button type="button" class="mkt-tab' +
          (c === activeCat ? " is-active" : "") +
          '" data-cat="' +
          c +
          '">' +
          label +
          "</button>"
        );
      })
      .join("");
  }

  function renderGrid() {
    var grid = $("mktGrid");
    if (!grid) return;
    var list = filteredProducts();
    if (!list.length) {
      grid.innerHTML = '<div class="mkt-empty">No products match this filter yet.</div>';
      return;
    }
    grid.innerHTML = list
      .map(function (p, i) {
        var parsed = parseMeta(p.description);
        var imgs = productImages(p);
        var img = imgs[0] || p.secure_url || "";
        var desc = (parsed.description || "").trim();
        var price = Number(p.price || 0);
        var condition =
          parsed.meta.condition === "fairly_used" ? "Fairly used" : "New";
        var isDigital = parsed.meta.product_type === "digital";
        var cat = String(p.category || "item").replace(/_/g, " ");
        var thumbs =
          imgs.length > 1
            ? '<div class="mkt-thumbs">' +
              imgs
                .slice(0, 5)
                .map(function (u, idx) {
                  return (
                    '<button type="button" class="mkt-thumb' +
                    (idx === 0 ? " is-on" : "") +
                    '" data-src="' +
                    escapeHtml(u) +
                    '" style="background-image:url(\'' +
                    escapeHtml(u).replace(/'/g, "%27") +
                    "')\" aria-label=\"Photo " +
                    (idx + 1) +
                    '"></button>'
                  );
                })
                .join("") +
              "</div>"
            : "";
        return (
          '<article class="mkt-item" style="animation-delay:' +
          Math.min(i, 8) * 0.04 +
          's">' +
          '<div class="mkt-item-media">' +
          (img
            ? '<img class="mkt-main-img" src="' +
              img.replace(/"/g, "") +
              '" alt="" loading="lazy" />'
            : "") +
          '<span class="mkt-cond">' +
          escapeHtml(condition) +
          "</span>" +
          (isDigital ? '<span class="mkt-digital">Digital</span>' : "") +
          "</div>" +
          thumbs +
          '<div class="mkt-item-body">' +
          '<p class="mkt-item-cat">' +
          escapeHtml(cat) +
          "</p>" +
          '<h3 class="mkt-item-title">' +
          escapeHtml(p.title || "Product") +
          "</h3>" +
          (desc
            ? '<p class="mkt-item-desc">' + escapeHtml(desc) + "</p>"
            : "") +
          '<div class="mkt-item-foot">' +
          '<span class="mkt-price">' +
          (price > 0 ? money(price) : "Ask price") +
          "</span>" +
          '<button type="button" class="mkt-add" data-add="' +
          escapeHtml(String(p.id || "")) +
          '">Add to cart</button>' +
          "</div></div></article>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function addToCart(productId) {
    var product = products.filter(function (p) {
      return String(p.id) === String(productId);
    })[0];
    if (!product) return;
    if (!(Number(product.price) > 0)) {
      toast("This item has no checkout price yet.");
      return;
    }

    if (!isBuyerLoggedIn()) {
      var existing = guestCart.filter(function (it) {
        return String(it.product_id) === String(productId);
      })[0];
      if (existing) existing.quantity = (existing.quantity || 1) + 1;
      else {
        guestCart.push({
          product_id: productId,
          title: product.title,
          price: product.price,
          quantity: 1,
        });
      }
      saveGuestCart();
      setCartBadge();
      toast("Added — sign in at checkout");
      return;
    }

    try {
      await api.api("/api/v1/marketplace/cart/add", {
        method: "POST",
        body: { product_id: productId, quantity: 1 },
      });
      await syncServerCartCount();
      toast("Added to cart. Vendor sees it after you checkout & pay.");
    } catch (err) {
      toast(err.message || "Could not add to cart");
    }
  }

  async function renderCartBody() {
    var body = $("cartBody");
    var totalEl = $("cartTotal");
    if (!body) return;

    if (isBuyerLoggedIn()) {
      try {
        var cart = await api.api("/api/v1/marketplace/cart");
        var items = (cart && cart.items) || [];
        cartCount._server = items.reduce(function (s, it) {
          return s + (it.quantity || 1);
        }, 0);
        setCartBadge();
        if (!items.length) {
          body.innerHTML = '<p class="mkt-empty">Your cart is empty.</p>';
          if (totalEl) totalEl.textContent = money(0);
          return;
        }
        body.innerHTML = items
          .map(function (it) {
            var title =
              (it.product && it.product.title) || it.title || "Product";
            return (
              '<div class="mkt-cart-row">' +
              "<strong>" +
              escapeHtml(title) +
              "</strong>" +
              "<span>Qty " +
              (it.quantity || 1) +
              " · " +
              money(it.line_total || 0) +
              "</span>" +
              '<button type="button" data-remove="' +
              escapeHtml(String(it.id || "")) +
              '">Remove</button>' +
              "</div>"
            );
          })
          .join("");
        if (totalEl) totalEl.textContent = money(cart.total_amount || 0);
      } catch (err) {
        body.innerHTML =
          '<p class="mkt-empty">' +
          escapeHtml(err.message || "Could not load cart") +
          "</p>";
      }
      return;
    }

    if (!guestCart.length) {
      body.innerHTML = '<p class="mkt-empty">Your cart is empty.</p>';
      if (totalEl) totalEl.textContent = money(0);
      return;
    }
    var total = 0;
    body.innerHTML = guestCart
      .map(function (it, idx) {
        var line = (Number(it.price) || 0) * (it.quantity || 1);
        total += line;
        return (
          '<div class="mkt-cart-row">' +
          "<strong>" +
          escapeHtml(it.title || "Product") +
          "</strong>" +
          "<span>Qty " +
          (it.quantity || 1) +
          " · " +
          money(line) +
          "</span>" +
          '<button type="button" data-remove-guest="' +
          idx +
          '">Remove</button>' +
          "</div>"
        );
      })
      .join("");
    if (totalEl) totalEl.textContent = money(total);
  }

  async function openCart() {
    $("cartDrawer").hidden = false;
    await renderCartBody();
  }

  function closeCart() {
    $("cartDrawer").hidden = true;
  }

  async function beginCheckout() {
    if (!isBuyerLoggedIn()) {
      openRoleModal();
      return;
    }
    if (guestCart.length) await flushGuestCartToServer();
    await renderCartBody();
    if (isBuyerLoggedIn() && !(cartCount._server > 0) && !guestCart.length) {
      toast("Your cart is empty.");
      return;
    }
    openCheckoutModal();
  }

  async function submitCheckout(e) {
    e.preventDefault();
    var address = $("checkoutAddress").value.trim();
    var phone = $("checkoutPhone").value.trim();
    if (address.length < 5) {
      toast("Enter a fuller delivery address.");
      return;
    }
    if (phone.length < 7) {
      toast("Enter a valid phone number.");
      return;
    }

    var btn = e.target.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Creating order…";
    }

    try {
      var res = await api.api("/api/v1/marketplace/checkout", {
        method: "POST",
        body: {
          delivery_address: address,
          contact_phone: phone,
        },
      });
      var orderId = res && res.order_id;
      if (!orderId) throw new Error("Checkout did not return an order id.");

      closeCheckoutModal();
      closeCart();

      if (typeof window.paystackPurchase === "function") {
        await window.paystackPurchase({
          productType: "marketplace_order",
          productId: orderId,
          returnPage: "marketplace",
        });
        return;
      }
      toast("Order created. Complete payment from My orders.");
    } catch (err) {
      toast(err.message || "Checkout failed");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Pay with Paystack";
      }
    }
  }

  var CONFIRM_KEY = "sia_mkt_delivery_confirm";

  function readConfirms() {
    try {
      return JSON.parse(localStorage.getItem(CONFIRM_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function writeConfirms(map) {
    localStorage.setItem(CONFIRM_KEY, JSON.stringify(map || {}));
  }

  function flattenBuyerOrders(orders) {
    var flat = [];
    (orders || []).forEach(function (o) {
      var items = o.items || o.order_items || o.lines || [];
      if (Array.isArray(items) && items.length) {
        items.forEach(function (it) {
          flat.push(Object.assign({}, o, it, { _order: o }));
        });
      } else {
        flat.push(o);
      }
    });
    return flat;
  }

  function itemKey(o) {
    return String(
      o.order_item_id || o.item_id || o.id || o.order_id || ""
    );
  }

  async function loadOrders() {
    if (!isBuyerLoggedIn()) {
      window.location.href =
        "auth.html?mode=login&role=student&next=" +
        encodeURIComponent("marketplace.html");
      return;
    }
    var body = $("ordersBody");
    var drawer = $("ordersDrawer");
    if (drawer) drawer.hidden = false;
    if (body) body.innerHTML = '<p class="mkt-empty">Loading orders…</p>';
    try {
      var data = await api.api("/api/v1/marketplace/orders/mine");
      var orders = Array.isArray(data)
        ? data
        : (data && (data.orders || data.items || data.results)) || [];
      var flat = flattenBuyerOrders(orders);
      if (!flat.length) {
        if (body) body.innerHTML = '<p class="mkt-empty">No orders yet — checkout from your cart.</p>';
        else toast("No orders yet — checkout from your cart.");
        return;
      }
      var confirms = readConfirms();
      if (body) {
        body.innerHTML = flat
          .map(function (o) {
            var key = itemKey(o);
            var title =
              (o.product && o.product.title) ||
              o.title ||
              o.product_title ||
              o.name ||
              "Order item";
            var st = o.status || o.payment_status || "order";
            var confirmed =
              !!(key && confirms[key]) ||
              o.buyer_confirmed === true ||
              o.escrow_status === "available";
            var paid =
              String(st).toLowerCase().indexOf("paid") >= 0 ||
              String(st).toLowerCase().indexOf("success") >= 0 ||
              String(st).toLowerCase().indexOf("held_escrow") >= 0 ||
              String(st).toLowerCase().indexOf("processing") >= 0 ||
              String(st).toLowerCase().indexOf("shipped") >= 0 ||
              String(st).toLowerCase().indexOf("delivered") >= 0 ||
              String(o.payment_status || "").toLowerCase().indexOf("paid") >= 0 ||
              o.escrow_status === "held" ||
              o.escrow_status === "available";
            return (
              '<div class="mkt-cart-row" data-order-key="' +
              escapeHtml(key) +
              '">' +
              "<div><strong>" +
              escapeHtml(title) +
              "</strong><span>" +
              escapeHtml(st) +
              " · " +
              money(o.total_amount || o.amount || o.price || o.line_total || 0) +
              "</span>" +
              (confirmed
                ? "<span>You confirmed this delivery — vendor can request payout.</span>"
                : paid
                  ? "<span>Money is held in escrow until you confirm the product is okay.</span>"
                  : "") +
              "</div>" +
              (paid && !confirmed && key
                ? '<button type="button" class="mkt-secondary" data-confirm-order="' +
                  escapeHtml(key) +
                  '">Confirm received OK</button>'
                : confirmed
                  ? "<em>Confirmed</em>"
                  : "") +
              "</div>"
            );
          })
          .join("");
      } else {
        toast("Opened orders — use My orders button.");
      }
    } catch (err) {
      if (body) {
        body.innerHTML =
          '<p class="mkt-empty">' +
          escapeHtml(err.message || "Could not load orders") +
          "</p>";
      } else toast(err.message || "Could not load orders");
    }
  }

  async function confirmOrderOk(key) {
    if (!key) return;
    await api.api(
      "/api/v1/marketplace/orders/items/" + encodeURIComponent(key) + "/confirm-delivery",
      {
        method: "POST",
        body: { note: "Buyer confirmed product received and OK" },
      }
    );
    var map = readConfirms();
    map[key] = {
      confirmed_at: new Date().toISOString(),
      buyer_email: localStorage.getItem("sia_email") || "",
      buyer_name: localStorage.getItem("sia_name") || "",
      admin_notified: true,
    };
    writeConfirms(map);
    toast("Thanks — delivery confirmed. Vendor can request payout.");
    await loadOrders();
  }

  async function loadProducts() {
    var grid = $("mktGrid");
    try {
      var data = await api.api("/api/v1/marketplace/products", { noAuth: true });
      products = Array.isArray(data)
        ? data
        : (data && (data.products || data.items || data.results)) || [];
      products = products.filter(function (p) {
        if (p.is_available === false || p.is_active === false) return false;
        if (p.stock_qty != null && Number(p.stock_qty) <= 0) return false;
        return true;
      });
      renderTabs();
      renderGrid();
    } catch (err) {
      if (grid) {
        grid.innerHTML =
          '<div class="mkt-empty">' +
          escapeHtml(err.message || "Could not load products") +
          "</div>";
      }
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    loadGuestCart();
    setCartBadge();

    if (typeof window.resumePendingPaystack === "function") {
      try {
        var payRes = await window.resumePendingPaystack();
        if (payRes && payRes.paid) {
          toast("Payment confirmed — thank you!");
        }
      } catch (e) { /* ignore */ }
    }

    var params = new URLSearchParams(window.location.search);
    if (params.get("vendor") === "pending") {
      window.location.replace("vendor.html");
      return;
    }

    var roleNow = (localStorage.getItem("sia_role") || "").toLowerCase();
    if (api.getToken() && roleNow === "vendor" && params.get("stay") !== "1") {
      window.location.replace("vendor.html");
      return;
    }

    if (isBuyerLoggedIn()) {
      $("btnOrders").hidden = false;
      await flushGuestCartToServer();
      await syncServerCartCount();
      if (params.get("checkout") === "1") openCart();
    }

    await loadProducts();

    $("mktTabs").addEventListener("click", function (e) {
      var btn = e.target.closest("[data-cat]");
      if (!btn) return;
      activeCat = btn.dataset.cat;
      renderTabs();
      renderGrid();
    });

    var search = $("mktSearch");
    if (search) {
      search.addEventListener("input", function () {
        searchQuery = search.value || "";
        renderGrid();
      });
    }

    $("mktGrid").addEventListener("click", function (e) {
      var thumb = e.target.closest(".mkt-thumb");
      if (thumb) {
        var card = thumb.closest(".mkt-item");
        var main = card && card.querySelector(".mkt-main-img");
        if (main && thumb.dataset.src) {
          main.src = thumb.dataset.src;
          card.querySelectorAll(".mkt-thumb").forEach(function (t) {
            t.classList.toggle("is-on", t === thumb);
          });
        }
        return;
      }
      var btn = e.target.closest("[data-add]");
      if (!btn) return;
      addToCart(btn.dataset.add);
    });

    $("btnCart").addEventListener("click", openCart);
    $("closeCart").addEventListener("click", closeCart);
    $("cartDrawer").addEventListener("click", function (e) {
      if (e.target === $("cartDrawer")) closeCart();
    });
    $("btnCheckout").addEventListener("click", beginCheckout);
    $("btnSell").addEventListener("click", function () {
      goAuth("vendor");
    });
    if ($("btnJoin")) {
      $("btnJoin").addEventListener("click", onJoinClick);
    }
    $("closeRole").addEventListener("click", closeRoleModal);
    $("roleModal").addEventListener("click", function (e) {
      if (e.target === $("roleModal")) closeRoleModal();
      var pick = e.target.closest("[data-pick]");
      if (pick) goAuth(pick.dataset.pick);
    });
    $("closeCheckout").addEventListener("click", closeCheckoutModal);
    $("checkoutModal").addEventListener("click", function (e) {
      if (e.target === $("checkoutModal")) closeCheckoutModal();
    });
    $("checkoutForm").addEventListener("submit", submitCheckout);

    $("cartBody").addEventListener("click", async function (e) {
      var rm = e.target.closest("[data-remove]");
      if (rm) {
        try {
          await api.api("/api/v1/marketplace/cart/" + rm.dataset.remove, {
            method: "DELETE",
          });
          await renderCartBody();
          await syncServerCartCount();
        } catch (err) {
          toast(err.message || "Could not remove item");
        }
        return;
      }
      var rg = e.target.closest("[data-remove-guest]");
      if (rg) {
        guestCart.splice(Number(rg.dataset.removeGuest), 1);
        saveGuestCart();
        setCartBadge();
        renderCartBody();
      }
    });

    $("btnOrders").addEventListener("click", loadOrders);
    if ($("closeOrders")) {
      $("closeOrders").addEventListener("click", function () {
        $("ordersDrawer").hidden = true;
      });
    }
    if ($("ordersDrawer")) {
      $("ordersDrawer").addEventListener("click", function (e) {
        if (e.target === $("ordersDrawer")) $("ordersDrawer").hidden = true;
      });
    }
    if ($("ordersBody")) {
      $("ordersBody").addEventListener("click", async function (e) {
        var btn = e.target.closest("[data-confirm-order]");
        if (!btn) return;
        btn.disabled = true;
        try {
          await confirmOrderOk(btn.getAttribute("data-confirm-order"));
        } catch (ex) {
          toast(ex.message || "Could not confirm");
          btn.disabled = false;
        }
      });
    }
  });
})();
