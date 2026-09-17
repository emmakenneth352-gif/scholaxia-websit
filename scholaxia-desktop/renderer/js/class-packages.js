/** Live class subscription packages — Paystack (prices from server catalog). */

var CLASS_PACKAGE_SECTIONS = {
  student: [
    {
      title: "Single & Exam Prep",
      plans: [
        {
          id: "single_class",
          name: "Special Single Class",
          price: 5000,
          billing: "₦5,000 · 1 session",
          features: ["1 live session", "One-on-one tutor", "Class notes", "Questions and answers"],
        },
        {
          id: "jamb_prep",
          name: "JAMB Prep",
          price: 10000,
          billing: "₦10,000 monthly · 4 sessions weekly",
          features: ["4 subjects", "4 sessions weekly", "JAMB past questions & CBT drills", "Progress tracking"],
        },
        {
          id: "jamb_waec_neco_prep",
          name: "JAMB + WAEC/NECO Prep",
          price: 15000,
          billing: "₦15,000 monthly · 5 sessions weekly",
          features: ["6 subjects", "5 sessions weekly", "JAMB, WAEC & NECO practice", "Mock exams"],
        },
      ],
    },
    {
      title: "Private & School Lessons",
      plans: [
        {
          id: "private_lesson",
          name: "Private Lesson (One-on-One)",
          price: 25000,
          billing: "₦25,000 monthly · 4 sessions weekly",
          features: ["4 subjects", "4 sessions weekly", "Dedicated one-on-one tutor", "Unlimited Sia AI Tutor"],
        },
        {
          id: "primary_school",
          name: "Primary School",
          price: 25000,
          billing: "₦25,000 monthly · 3 sessions weekly",
          features: ["3 subjects", "3 sessions weekly", "Mathematics, English & Phonics", "Parent feedback"],
        },
        {
          id: "nursery_school",
          name: "Nursery School",
          price: 25000,
          billing: "₦25,000 monthly · 2 sessions weekly",
          features: ["2 subjects", "2 sessions weekly", "Reading & Phonics", "Parent feedback"],
        },
      ],
    },
  ],
  kind: [
    {
      title: "Kids Live Classes",
      plans: [
        {
          id: "single_class",
          name: "Special Single Class",
          price: 5000,
          billing: "₦5,000 · 1 session",
          features: ["1 live session", "One-on-one tutor", "Class notes"],
        },
        {
          id: "nursery_school",
          name: "Nursery School",
          price: 25000,
          billing: "₦25,000 monthly · 2 sessions weekly",
          features: ["2 subjects", "2 sessions weekly", "Reading & Phonics", "Counting & fun games", "Parent feedback"],
        },
        {
          id: "primary_school",
          name: "Primary School",
          price: 25000,
          billing: "₦25,000 monthly · 3 sessions weekly",
          features: ["3 subjects", "3 sessions weekly", "Mathematics, English & Phonics", "Homework help", "Parent feedback"],
        },
      ],
    },
  ],
};

function cpEsc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function renderClassPackages(rootId, opts) {
  var el = document.getElementById(rootId);
  if (!el) return;
  opts = opts || {};
  var kidsOnly = !!opts.kidsOnly;
  var holidayOnly = !!opts.holidayOnly;
  var sections = kidsOnly ? CLASS_PACKAGE_SECTIONS.kind : CLASS_PACKAGE_SECTIONS.student;
  if (holidayOnly) {
    sections = sections.filter(function (s) {
      return /single|exam|private|school/i.test(s.title);
    });
  }

  var html =
    '<div class="sx-page-hero"><h2>' +
    (kidsOnly ? "Kids live classes" : holidayOnly ? "Live class plans" : "Class packages") +
    "</h2><p>Pay with Paystack — same packages as the mobile app.</p></div>";

  sections.forEach(function (sec) {
    html += '<h3 class="cp-section-title">' + cpEsc(sec.title) + "</h3><div class=\"card-grid\">";
    sec.plans.forEach(function (p) {
      html +=
        '<div class="sx-card cp-card">' +
        "<h3>" + cpEsc(p.name) + "</h3>" +
        '<p class="cp-billing"><strong>' + cpEsc(p.billing) + "</strong></p>" +
        '<ul class="cp-features">' +
        p.features
          .map(function (f) {
            return "<li>" + cpEsc(f) + "</li>";
          })
          .join("") +
        "</ul>" +
        '<button type="button" class="btn-action" onclick="buyClassPackage(\'' +
        cpEsc(p.id) +
        "')\">Pay ₦" +
        Number(p.price).toLocaleString("en-NG") +
        "</button></div>";
    });
    html += "</div>";
  });
  el.innerHTML = html;
}

async function buyClassPackage(packageId) {
  if (!packageId || typeof paystackPurchase !== "function") {
    alert("Payment module not loaded.");
    return;
  }
  try {
    var ok = await paystackPurchase({
      productType: "class_package",
      productId: packageId,
    });
    if (ok) {
      if (typeof refreshLivePlanAccessAfterPayment === "function") {
        await refreshLivePlanAccessAfterPayment();
      } else {
        try { sessionStorage.removeItem("sia_live_plans_cache"); } catch (e) { /* ignore */ }
        if (typeof loadLivePlans === "function") await loadLivePlans(null, false);
      }
      alert("Payment successful! Your class package is active — Live Class will recognize your subscription.");
    } else {
      alert("Payment was not completed.");
    }
  } catch (e) {
    alert(e.message || "Payment failed.");
  }
}

function loadClassPackagesPage() {
  renderClassPackages("class-packages-root", { holidayOnly: false, kidsOnly: false });
}

function loadHolidayPackagesPage() {
  renderClassPackages("holiday-packages-mount", { holidayOnly: true, kidsOnly: false });
}

function loadKindClassPackagesPage() {
  renderClassPackages("kind-packages-root", { kidsOnly: true });
}

window.renderClassPackages = renderClassPackages;
window.buyClassPackage = buyClassPackage;
window.loadClassPackagesPage = loadClassPackagesPage;
window.loadHolidayPackagesPage = loadHolidayPackagesPage;
window.loadKindClassPackagesPage = loadKindClassPackagesPage;
