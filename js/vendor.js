(function () {
  var api = window.ScholaxiaAPI;
  var status = null;
  var uploadedImageUrls = [];
  var uploadedFileUrl = "";
  var uploadedFileName = "";
  var productsCache = [];
  var PLATFORM_FEE = 0.1;
  var META_RE = /\n*---\nSIA_META:(\{[\s\S]*?\})\s*$/;

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

  function buildDescription(text, meta) {
    var clean = String(text || "").replace(META_RE, "").trim();
    return clean + "\n\n---\nSIA_META:" + JSON.stringify(meta || {});
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
    var current = "applied";
    if (!approved) current = "applied";
    else if (!kyc) current = "kyc";
    else if (!canSell) current = "kyc";
    else current = "sell";

    var done = {
      applied: true,
      approved: !!approved,
      kyc: !!kyc,
      sell: !!canSell,
    };

    document.querySelectorAll("#venSteps li").forEach(function (li) {
      var key = li.getAttribute("data-step");
      li.classList.remove("is-on", "is-done");
      if (done[key]) li.classList.add("is-done");
      if (key === current) {
        li.classList.add("is-on");
        li.classList.remove("is-done");
      }
      if (key === "approved" && approved && current === "kyc") {
        li.classList.add("is-done");
        li.classList.remove("is-on");
      }
    });
  }

  function showPanel(id) {
    ["panelPending", "panelKyc", "panelStudio"].forEach(function (pid) {
      var el = $(pid);
      if (el) el.hidden = pid !== id;
    });
    document.body.classList.toggle("is-kyc", id === "panelKyc");
    document.body.classList.toggle("is-pending", id === "panelPending");
    document.body.classList.toggle("is-studio", id === "panelStudio");
    var panel = $(id);
    if (panel) {
      setTimeout(function () {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  }

  function applyStatus(data) {
    status = data || {};
    var approved = !!status.is_approved;
    var kyc = !!status.kyc_completed;
    var canSell = !!status.can_list_products;
    var name = status.business_name || status.full_name || "Vendor";
    $("venName").textContent = name;

    setSteps(approved, kyc, canSell);

    var statusLine = $("statusLine");
    if (statusLine) {
      statusLine.hidden = false;
      statusLine.textContent =
        "Live status · approved: " +
        (approved ? "yes" : "no") +
        " · KYC: " +
        (kyc ? "yes" : "no") +
        " · can sell: " +
        (canSell ? "yes" : "no");
    }

    if (!approved) {
      $("heroTitle").innerHTML = "Hang tight<br /><span>we're reviewing</span>";
      $("heroLead").textContent =
        "Your vendor application for " +
        name +
        " is with Scholaxia admin. You will unlock KYC here after approval.";
      var ctaOff = $("heroKycCta");
      if (ctaOff) ctaOff.hidden = true;
      showPanel("panelPending");
      return;
    }

    if (!kyc) {
      $("heroTitle").innerHTML = "You're approved<br /><span>finish KYC</span>";
      $("heroLead").textContent =
        "Admin approved your store. Complete NIN verification below to unlock selling.";
      var cta = $("heroKycCta");
      if (cta) cta.hidden = false;
      showPanel("panelKyc");
      $("kycName").value = status.full_name || "";
      $("kycLocation").value = status.location || "";
      $("kycAddress").value = status.address || "";
      return;
    }

    var ctaHide = $("heroKycCta");
    if (ctaHide) ctaHide.hidden = true;

    $("heroTitle").innerHTML = "Vendor Studio<br /><span>is live</span>";
    $("heroLead").textContent =
      "Manage listings, fulfill paid orders, and track your net balance after the 10% Scholaxia fee.";
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
    if (tab === "new") updateFeeHint();
  }

  function conditionLabel(c) {
    return c === "fairly_used" ? "Fairly used" : "New";
  }

  function categoryLabel(c) {
    return String(c || "item")
      .replace(/_/g, " ")
      .replace(/\b\w/g, function (ch) {
        return ch.toUpperCase();
      });
  }

  function resetProductForm() {
    $("productForm").reset();
    $("pEditId").value = "";
    $("formTitle").textContent = "New listing";
    $("btnProduct").textContent = "Publish to Market";
    $("btnCancelEdit").hidden = true;
    uploadedImageUrls = [];
    uploadedFileUrl = "";
    uploadedFileName = "";
    $("pPreview").hidden = true;
    $("pPreview").innerHTML = "";
    $("pFileName").hidden = true;
    $("pFileName").textContent = "";
    $("pFeeAgree").checked = false;
    updateFeeHint();
  }

  function fillProductForm(p) {
    var parsed = parseMeta(p.description);
    var meta = parsed.meta || {};
    $("pEditId").value = p.id || "";
    $("formTitle").textContent = "Edit listing";
    $("btnProduct").textContent = "Save changes";
    $("btnCancelEdit").hidden = false;
    $("pTitle").value = p.title || "";
    $("pCategory").value = p.category || "other";
    $("pCondition").value = meta.condition || "new";
    $("pType").value = meta.product_type || "physical";
    $("pPrice").value = p.price || "";
    $("pStock").value = p.stock_qty != null ? p.stock_qty : 1;
    $("pDesc").value = parsed.description || "";
    uploadedImageUrls = productImages(p);
    uploadedFileUrl = meta.digital_url || "";
    uploadedFileName = meta.digital_name || "";
    renderImagePreview(uploadedImageUrls);
    if (uploadedFileName || uploadedFileUrl) {
      $("pFileName").hidden = false;
      $("pFileName").textContent =
        "Attached: " + (uploadedFileName || uploadedFileUrl);
    }
    $("pFeeAgree").checked = true;
    updateFeeHint();
    setTab("new");
  }

  function renderImagePreview(urls) {
    var preview = $("pPreview");
    if (!urls || !urls.length) {
      preview.hidden = true;
      preview.innerHTML = "";
      return;
    }
    preview.hidden = false;
    preview.innerHTML = urls
      .map(function (u) {
        return '<img src="' + escapeHtml(u) + '" alt="" />';
      })
      .join("");
  }

  async function loadProducts() {
    var grid = $("productGrid");
    if (!grid) return;
    grid.innerHTML = '<div class="ven-empty">Loading your products…</div>';
    try {
      var data = await api.api("/api/v1/vendor/marketplace/products");
      var list = Array.isArray(data) ? data : (data && data.products) || [];
      productsCache = list;
      if (!list.length) {
        grid.innerHTML =
          '<div class="ven-empty">No products yet — open Add product to publish your first listing.</div>';
        return;
      }
      grid.innerHTML = list
        .map(function (p) {
          var parsed = parseMeta(p.description);
          var imgs = productImages(p);
          var img = imgs[0] || "";
          var live = p.is_available !== false && p.is_active !== false;
          var price = Number(p.price) || 0;
          var net = Math.round(price * (1 - PLATFORM_FEE));
          return (
            '<article class="ven-item' +
            (live ? "" : " is-unlisted") +
            '" data-id="' +
            escapeHtml(String(p.id || "")) +
            '">' +
            '<div class="ven-item-media">' +
            (img
              ? '<img src="' + escapeHtml(img) + '" alt="" loading="lazy" />'
              : "") +
            (imgs.length > 1
              ? '<span class="ven-img-count">' + imgs.length + " photos</span>"
              : "") +
            (!live ? '<span class="ven-badge">Unlisted</span>' : "") +
            "</div>" +
            '<div class="ven-item-body">' +
            "<h3>" +
            escapeHtml(p.title || "Product") +
            "</h3>" +
            '<p class="ven-item-meta">' +
            escapeHtml(categoryLabel(p.category)) +
            " · " +
            escapeHtml(conditionLabel(parsed.meta.condition)) +
            (parsed.meta.product_type === "digital" ? " · Digital" : "") +
            "</p>" +
            '<p class="ven-item-price">' +
            money(price) +
            ' <small class="ven-net">you get ' +
            money(net) +
            "</small></p>" +
            '<div class="ven-item-actions">' +
            '<button type="button" class="ven-mini" data-act="edit">Edit</button>' +
            '<button type="button" class="ven-mini" data-act="toggle">' +
            (live ? "Unlist" : "List") +
            "</button>" +
            '<button type="button" class="ven-mini ven-mini-danger" data-act="remove">Remove</button>' +
            "</div>" +
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

  function normalizeVendorOrders(data) {
    var list = Array.isArray(data)
      ? data
      : (data &&
          (data.orders ||
            data.items ||
            data.results ||
            data.order_items ||
            data.data)) ||
        [];
    var flat = [];
    list.forEach(function (o) {
      var nested = o.items || o.order_items || o.lines || o.products;
      if (Array.isArray(nested) && nested.length) {
        nested.forEach(function (it) {
          flat.push(Object.assign({}, o, it, { _order: o }));
        });
      } else {
        flat.push(o);
      }
    });
    return flat;
  }

  function orderGross(o) {
    return (
      Number(
        o.vendor_amount ||
          o.seller_amount ||
          o.line_total ||
          o.amount ||
          o.price ||
          o.total_amount ||
          o.subtotal ||
          0
      ) || 0
    );
  }

  function orderNet(o) {
    if (o.vendor_net != null || o.net_amount != null || o.seller_net != null) {
      return Number(o.vendor_net || o.net_amount || o.seller_net || 0);
    }
    var gross = orderGross(o);
    var fee =
      o.platform_fee != null
        ? Number(o.platform_fee)
        : Math.round(gross * PLATFORM_FEE);
    return Math.max(0, Math.round(gross - fee));
  }

  function isPaidOrder(o) {
    var s = String(
      o.payment_status || o.status || o.fulfillment_status || ""
    ).toLowerCase();
    if (!s) return true;
    if (s.indexOf("fail") >= 0 || s.indexOf("cancel") >= 0 || s === "pending") {
      return s === "pending" ? false : false;
    }
    return (
      s.indexOf("paid") >= 0 ||
      s.indexOf("success") >= 0 ||
      s.indexOf("complete") >= 0 ||
      s.indexOf("processing") >= 0 ||
      s.indexOf("shipped") >= 0 ||
      s.indexOf("delivered") >= 0 ||
      s === "confirmed"
    );
  }

  async function loadOrders() {
    var wrap = $("orderList");
    var earnings = $("orderEarnings");
    if (!wrap) return;
    wrap.innerHTML = '<div class="ven-empty">Loading orders…</div>';
    if (earnings) earnings.hidden = true;
    try {
      var data = await api.api("/api/v1/vendor/marketplace/orders");
      var list = normalizeVendorOrders(data);
      if (!list.length) {
        wrap.innerHTML =
          '<div class="ven-empty">No paid orders yet. After a buyer pays with Paystack, refresh this Orders tab — amounts show your balance after the 10% Scholaxia fee.</div>';
        return;
      }

      var totalGross = 0;
      var totalNet = 0;
      var totalFee = 0;
      list.forEach(function (o) {
        var g = orderGross(o);
        var n = orderNet(o);
        totalGross += g;
        totalNet += n;
        totalFee += Math.max(0, g - n);
      });

      if (earnings) {
        earnings.hidden = false;
        earnings.innerHTML =
          "<div><span>Gross sales</span><strong>" +
          money(totalGross) +
          "</strong></div>" +
          "<div><span>Platform 10%</span><strong>" +
          money(totalFee) +
          "</strong></div>" +
          "<div class=\"is-net\"><span>Your balance</span><strong>" +
          money(totalNet) +
          "</strong></div>";
      }

      wrap.innerHTML = list
        .map(function (o) {
          var title =
            (o.product && o.product.title) ||
            o.title ||
            o.product_title ||
            o.name ||
            "Order item";
          var buyer =
            o.buyer_name ||
            o.customer_name ||
            (o.buyer && (o.buyer.full_name || o.buyer.email)) ||
            o.contact_phone ||
            "";
          var gross = orderGross(o);
          var net = orderNet(o);
          var fee = Math.max(0, gross - net);
          var st = o.status || o.fulfillment_status || o.payment_status || "processing";
          return (
            '<div class="ven-order">' +
            "<strong>" +
            escapeHtml(title) +
            "</strong>" +
            "<span>Status: " +
            escapeHtml(st) +
            (isPaidOrder(o) ? "" : " · awaiting payment") +
            "</span>" +
            (buyer ? "<span>Buyer: " + escapeHtml(buyer) + "</span>" : "") +
            "<span>Buyer paid " +
            money(gross) +
            " · Fee " +
            money(fee) +
            " · <em class=\"ven-net-em\">Your balance " +
            money(net) +
            "</em></span>" +
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

  async function uploadImageFile(file) {
    var fd = new FormData();
    fd.append("file", file);
    var up = await api.apiUpload("/api/v1/vendor/marketplace/upload-image", fd);
    var url = (up && (up.image_url || up.secure_url || up.url || up.file_url)) || "";
    if (!url) throw new Error("Upload failed for " + (file.name || "file"));
    return url;
  }

  async function submitProduct(e) {
    e.preventDefault();
    var err = $("pError");
    err.hidden = true;
    var btn = $("btnProduct");
    var editId = ($("pEditId").value || "").trim();
    var files = ($("pImage").files && Array.prototype.slice.call($("pImage").files)) || [];
    var digital = $("pFile").files && $("pFile").files[0];
    var listingType = $("pType").value;

    if (!files.length && !uploadedImageUrls.length && listingType === "physical") {
      err.hidden = false;
      err.textContent = "Add at least one product photo.";
      return;
    }
    if (
      listingType === "digital" &&
      !digital &&
      !uploadedFileUrl &&
      !files.length &&
      !uploadedImageUrls.length
    ) {
      err.hidden = false;
      err.textContent = "Add a cover image and/or a digital file (PDF, ZIP, etc.).";
      return;
    }
    if (!$("pFeeAgree").checked) {
      err.hidden = false;
      err.textContent = "Please confirm you accept the 10% Scholaxia platform fee.";
      return;
    }

    btn.disabled = true;
    btn.textContent = editId ? "Saving…" : "Publishing…";
    try {
      var imageUrls = uploadedImageUrls.slice();
      for (var i = 0; i < files.length; i++) {
        imageUrls.push(await uploadImageFile(files[i]));
      }
      // unique
      var seen = {};
      imageUrls = imageUrls.filter(function (u) {
        if (!u || seen[u]) return false;
        seen[u] = true;
        return true;
      });

      var fileUrl = uploadedFileUrl;
      var fileName = uploadedFileName;
      if (digital) {
        try {
          fileUrl = await uploadImageFile(digital);
          fileName = digital.name || "file";
        } catch (upErr) {
          throw new Error(
            "Could not upload digital file. Try PDF/ZIP under 10MB, or contact support. (" +
              (upErr.message || "upload error") +
              ")"
          );
        }
      }

      if (!imageUrls.length && fileUrl) {
        // digital-only: still need an image_url for API — use logo as fallback cover
        imageUrls = ["media/logo-main.png"];
      }
      if (!imageUrls.length) throw new Error("Add at least one product photo.");

      var meta = {
        condition: $("pCondition").value,
        product_type: listingType,
        images: imageUrls,
        digital_url: fileUrl || "",
        digital_name: fileName || "",
        platform_fee_percent: 10,
      };

      var body = {
        title: $("pTitle").value.trim(),
        description: buildDescription($("pDesc").value.trim(), meta),
        category: $("pCategory").value,
        price: Number($("pPrice").value),
        stock_qty: Number($("pStock").value || 0),
        image_url: imageUrls[0],
        is_available: true,
        is_active: true,
      };

      if (editId) {
        await api.api("/api/v1/vendor/marketplace/products/" + encodeURIComponent(editId), {
          method: "PATCH",
          body: body,
        });
        toast("Product updated");
      } else {
        await api.api("/api/v1/vendor/marketplace/products", {
          method: "POST",
          body: body,
        });
        toast("Product published — remember: you receive 90% after Scholaxia’s 10% fee");
      }
      resetProductForm();
      setTab("products");
      await loadProducts();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message || "Could not save product";
    } finally {
      btn.disabled = false;
      btn.textContent = ($("pEditId").value ? "Save changes" : "Publish to Market");
    }
  }

  async function patchProduct(id, body, okMsg) {
    await api.api("/api/v1/vendor/marketplace/products/" + encodeURIComponent(id), {
      method: "PATCH",
      body: body,
    });
    toast(okMsg || "Updated");
    await loadProducts();
  }

  function updateFeeHint() {
    var price = Number($("pPrice").value) || 0;
    var fee = Math.round(price * PLATFORM_FEE);
    var net = Math.max(0, Math.round(price - fee));
    var el = $("pFeeHint");
    if (el) {
      el.textContent =
        "Buyer pays " +
        money(price) +
        " · Scholaxia 10% = " +
        money(fee) +
        " · You receive " +
        money(net);
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
    if ($("kycNin")) {
      $("kycNin").addEventListener("input", function () {
        $("kycNin").value = $("kycNin").value.replace(/\D/g, "").slice(0, 11);
      });
    }
    $("productForm").addEventListener("submit", submitProduct);
    $("btnCancelEdit").addEventListener("click", function () {
      resetProductForm();
      setTab("products");
    });
    $("pPrice").addEventListener("input", updateFeeHint);

    document.querySelectorAll(".ven-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTab(btn.dataset.tab);
      });
    });

    $("pImage").addEventListener("change", function () {
      var files = ($("pImage").files && Array.prototype.slice.call($("pImage").files)) || [];
      if (!files.length) {
        if (!uploadedImageUrls.length) {
          $("pPreview").hidden = true;
          $("pPreview").innerHTML = "";
        }
        return;
      }
      var urls = files.map(function (f) {
        return URL.createObjectURL(f);
      });
      renderImagePreview(uploadedImageUrls.concat(urls));
    });

    $("pFile").addEventListener("change", function () {
      var f = $("pFile").files && $("pFile").files[0];
      if (!f) return;
      $("pFileName").hidden = false;
      $("pFileName").textContent = "Selected: " + f.name;
    });

    $("productGrid").addEventListener("click", async function (e) {
      var btn = e.target.closest("[data-act]");
      if (!btn) return;
      var card = btn.closest("[data-id]");
      if (!card) return;
      var id = card.getAttribute("data-id");
      var product = productsCache.filter(function (p) {
        return String(p.id) === String(id);
      })[0];
      if (!product) return;
      var act = btn.getAttribute("data-act");
      try {
        if (act === "edit") {
          fillProductForm(product);
          return;
        }
        if (act === "toggle") {
          var live = product.is_available !== false && product.is_active !== false;
          await patchProduct(
            id,
            { is_available: !live },
            live ? "Product unlisted from store" : "Product listed again"
          );
          return;
        }
        if (act === "remove") {
          if (!window.confirm("Remove this product from your store? Buyers will no longer see it.")) {
            return;
          }
          await patchProduct(
            id,
            { is_available: false, is_active: false },
            "Product removed"
          );
        }
      } catch (ex) {
        toast(ex.message || "Action failed");
      }
    });

    updateFeeHint();
    loadStatus();
  });
})();
