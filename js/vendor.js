(function () {
  var api = window.ScholaxiaAPI;
  var status = null;
  var uploadedImageUrl = "";

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    var el = $("venToast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.hidden = true;
    }, 2800);
  }

  function money(n) {
    var v = Math.round(Number(n) || 0);
    return "₦" + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function requireVendorSession() {
    var role = (localStorage.getItem("sia_role") || "").toLowerCase();
    var token = api.getToken();
    if (!token || role !== "vendor") {
      window.location.href =
        "auth.html?mode=login&role=vendor&market=1&next=" +
        encodeURIComponent("vendor.html");
      return false;
    }
    return true;
  }

  function setSteps(approved, kyc, canSell) {
    var map = {
      applied: true,
      approved: !!approved,
      kyc: !!kyc,
      sell: !!canSell,
    };
    document.querySelectorAll("#venSteps li").forEach(function (li) {
      var key = li.getAttribute("data-step");
      li.classList.toggle("is-done", !!map[key] && key !== "sell");
      li.classList.toggle("is-on", key === "applied" && !approved);
      if (key === "approved") li.classList.toggle("is-on", approved && !kyc);
      if (key === "kyc") li.classList.toggle("is-on", approved && kyc && !canSell);
      if (key === "sell") {
        li.classList.toggle("is-on", !!canSell);
        li.classList.toggle("is-done", !!canSell);
      }
      if (approved && key === "applied") {
        li.classList.add("is-done");
        li.classList.remove("is-on");
      }
      if (kyc && key === "approved") {
        li.classList.add("is-done");
        if (key !== "kyc") li.classList.remove("is-on");
      }
    });
  }

  function showPanel(id) {
    ["panelPending", "panelKyc", "panelStudio"].forEach(function (pid) {
      var el = $(pid);
      if (el) el.hidden = pid !== id;
    });
  }

  function applyStatus(data) {
    status = data || {};
    var approved = !!status.is_approved;
    var kyc = !!status.kyc_completed;
    var canSell = !!status.can_list_products;
    var name = status.business_name || status.full_name || "Vendor";
    $("venName").textContent = name;

    setSteps(approved, kyc, canSell);

    if (!approved) {
      $("heroTitle").innerHTML = "Hang tight<br /><span>we're reviewing</span>";
      $("heroLead").textContent =
        "Your vendor application for " +
        name +
        " is with Scholaxia admin. You will unlock KYC here after approval.";
      showPanel("panelPending");
      return;
    }

    if (!kyc) {
      $("heroTitle").innerHTML = "You're approved<br /><span>finish KYC</span>";
      $("heroLead").textContent =
        "Admin approved your store. Complete NIN verification to publish products on the market floor.";
      showPanel("panelKyc");
      $("kycName").value = status.full_name || "";
      $("kycLocation").value = status.location || "";
      $("kycAddress").value = status.address || "";
      return;
    }

    $("heroTitle").innerHTML = "Vendor Studio<br /><span>is live</span>";
    $("heroLead").textContent =
      "List books, phones and gadgets. Paid orders show up under Orders for you to ship.";
    showPanel("panelStudio");
    loadProducts();
  }

  async function loadStatus() {
    try {
      var data = await api.api("/api/v1/vendor/marketplace/status");
      applyStatus(data);
    } catch (err) {
      toast(err.message || "Could not load vendor status");
      if (err.status === 401 || err.status === 403) {
        api.clearSession();
        window.location.href =
          "auth.html?mode=login&role=vendor&market=1&next=" +
          encodeURIComponent("vendor.html");
      }
    }
  }

  async function submitKyc(e) {
    e.preventDefault();
    var err = $("kycError");
    err.hidden = true;
    var btn = $("btnKyc");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await api.api("/api/v1/vendor/marketplace/kyc", {
        method: "POST",
        body: {
          full_name: $("kycName").value.trim(),
          location: $("kycLocation").value.trim(),
          address: $("kycAddress").value.trim(),
          nin: $("kycNin").value.trim(),
        },
      });
      toast("KYC saved — you can list products now");
      await loadStatus();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message || "KYC failed";
    } finally {
      btn.disabled = false;
      btn.textContent = "Save KYC & continue";
    }
  }

  function setTab(tab) {
    document.querySelectorAll(".ven-tab").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.tab === tab);
    });
    ["products", "orders", "new"].forEach(function (id) {
      var panel = $("tab-" + id);
      if (panel) panel.hidden = id !== tab;
    });
    if (tab === "orders") loadOrders();
    if (tab === "products") loadProducts();
  }

  async function loadProducts() {
    var grid = $("productGrid");
    if (!grid) return;
    grid.innerHTML = '<div class="ven-empty">Loading your products…</div>';
    try {
      var data = await api.api("/api/v1/vendor/marketplace/products");
      var list = Array.isArray(data) ? data : (data && data.products) || [];
      if (!list.length) {
        grid.innerHTML =
          '<div class="ven-empty">No products yet — open Add product to publish your first listing.</div>';
        return;
      }
      grid.innerHTML = list
        .map(function (p) {
          var img = p.image_url || p.secure_url || "";
          return (
            '<article class="ven-item">' +
            '<div class="ven-item-media">' +
            (img
              ? '<img src="' + escapeHtml(img) + '" alt="" loading="lazy" />'
              : "") +
            "</div>" +
            '<div class="ven-item-body">' +
            "<h3>" +
            escapeHtml(p.title || "Product") +
            "</h3>" +
            '<p class="ven-item-meta">' +
            escapeHtml(p.category || "") +
            (p.is_available === false ? " · unavailable" : " · live") +
            "</p>" +
            '<p class="ven-item-price">' +
            money(p.price) +
            "</p>" +
            "</div></article>"
          );
        })
        .join("");
    } catch (err) {
      grid.innerHTML =
        '<div class="ven-empty">' +
        escapeHtml(err.message || "Could not load products") +
        "</div>";
    }
  }

  async function loadOrders() {
    var wrap = $("orderList");
    if (!wrap) return;
    wrap.innerHTML = '<div class="ven-empty">Loading orders…</div>';
    try {
      var data = await api.api("/api/v1/vendor/marketplace/orders");
      var list = Array.isArray(data) ? data : (data && data.orders) || [];
      if (!list.length) {
        wrap.innerHTML =
          '<div class="ven-empty">No paid orders yet. They appear here after buyers checkout.</div>';
        return;
      }
      wrap.innerHTML = list
        .map(function (o) {
          var title =
            (o.product && o.product.title) ||
            o.title ||
            o.product_title ||
            "Order item";
          return (
            '<div class="ven-order">' +
            "<strong>" +
            escapeHtml(title) +
            "</strong>" +
            "<span>Status: " +
            escapeHtml(o.status || o.fulfillment_status || "processing") +
            "</span>" +
            "<span>" +
            money(o.line_total || o.amount || o.price || 0) +
            "</span>" +
            "</div>"
          );
        })
        .join("");
    } catch (err) {
      wrap.innerHTML =
        '<div class="ven-empty">' +
        escapeHtml(err.message || "Could not load orders") +
        "</div>";
    }
  }

  async function submitProduct(e) {
    e.preventDefault();
    var err = $("pError");
    err.hidden = true;
    var btn = $("btnProduct");
    var file = $("pImage").files && $("pImage").files[0];
    if (!file && !uploadedImageUrl) {
      err.hidden = false;
      err.textContent = "Add a product photo.";
      return;
    }
    btn.disabled = true;
    btn.textContent = "Publishing…";
    try {
      var imageUrl = uploadedImageUrl;
      if (file) {
        var fd = new FormData();
        fd.append("file", file);
        var up = await api.apiUpload("/api/v1/vendor/marketplace/upload-image", fd);
        imageUrl = (up && (up.image_url || up.secure_url)) || "";
        if (!imageUrl) throw new Error("Image upload failed");
        uploadedImageUrl = imageUrl;
      }
      await api.api("/api/v1/vendor/marketplace/products", {
        method: "POST",
        body: {
          title: $("pTitle").value.trim(),
          description: $("pDesc").value.trim(),
          category: $("pCategory").value,
          price: Number($("pPrice").value),
          stock_qty: Number($("pStock").value || 0),
          image_url: imageUrl,
          is_available: true,
        },
      });
      toast("Product published on the market floor");
      $("productForm").reset();
      uploadedImageUrl = "";
      $("pPreview").hidden = true;
      $("pPreview").innerHTML = "";
      setTab("products");
      await loadProducts();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message || "Could not publish product";
    } finally {
      btn.disabled = false;
      btn.textContent = "Publish to Market";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!requireVendorSession()) return;

    $("venName").textContent = localStorage.getItem("sia_name") || "Vendor";
    $("btnLogout").addEventListener("click", function () {
      api.clearSession();
      window.location.href = "marketplace.html";
    });
    $("btnRefreshStatus").addEventListener("click", loadStatus);
    $("kycForm").addEventListener("submit", submitKyc);
    $("productForm").addEventListener("submit", submitProduct);

    document.querySelectorAll(".ven-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTab(btn.dataset.tab);
      });
    });

    $("pImage").addEventListener("change", function () {
      uploadedImageUrl = "";
      var file = $("pImage").files && $("pImage").files[0];
      var preview = $("pPreview");
      if (!file) {
        preview.hidden = true;
        preview.innerHTML = "";
        return;
      }
      var url = URL.createObjectURL(file);
      preview.hidden = false;
      preview.innerHTML = '<img src="' + url + '" alt="" />';
    });

    loadStatus();
  });
})();
