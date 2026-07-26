(() => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.querySelectorAll("video").forEach((video) => {
    const play = () => {
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };
    if (video.readyState >= 2) play();
    else video.addEventListener("loadeddata", play, { once: true });
  });

  const topbar = document.getElementById("topbar");
  const onScroll = () => {
    if (!topbar) return;
    topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const menuBtn = document.getElementById("menuBtn");
  const mobileNav = document.getElementById("mobileNav");
  if (menuBtn && mobileNav) {
    menuBtn.addEventListener("click", () => {
      const open = mobileNav.classList.toggle("is-open");
      mobileNav.hidden = !open;
    });
    mobileNav.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => {
        mobileNav.classList.remove("is-open");
        mobileNav.hidden = true;
      });
    });
  }

  const autoSlide = (trackId, visibleDesktop, visibleTablet, visibleMobile, delayMs) => {
    const track = document.getElementById(trackId);
    if (!track) return;
    const cards = [...track.children];
    if (cards.length < 2 || reduce) return;

    let index = 0;
    const gap = 16;

    const visibleCount = () => {
      const w = window.innerWidth;
      if (w <= 640) return visibleMobile;
      if (w <= 980) return visibleTablet;
      return visibleDesktop;
    };

    const step = () => {
      const vis = visibleCount();
      const max = Math.max(0, cards.length - vis);
      index = index >= max ? 0 : index + 1;
      const card = cards[0];
      const width = card.getBoundingClientRect().width;
      track.style.transform = `translateX(-${index * (width + gap)}px)`;
    };

    setInterval(step, delayMs);
    window.addEventListener(
      "resize",
      () => {
        index = 0;
        track.style.transform = "translateX(0)";
      },
      { passive: true }
    );
  };

  // Hero banner
  const heroTrack = document.getElementById("heroTrack");
  const heroSlides = heroTrack ? [...heroTrack.querySelectorAll(".hero-slide")] : [];
  if (heroTrack && heroSlides.length > 1 && !reduce) {
    let index = 0;
    setInterval(() => {
      index = (index + 1) % heroSlides.length;
      heroTrack.style.transform = `translateX(-${index * 100}%)`;
      heroSlides.forEach((slide, i) => slide.classList.toggle("is-active", i === index));
    }, 5000);
  }

  // Teacher cards + stories auto-slide
  autoSlide("instructorTrack", 3, 2, 1, 3500);
  autoSlide("quoteTrack", 3, 2, 1, 4200);

  // Scroll reveal
  const selectors = [
    "#about .section-head",
    "#product .section-head",
    "#product .feature-grid article",
    "#demo .showcase-copy",
    "#demo .showcase-frame",
    "#instructors .instructors-copy",
    "#instructors .instructor-slider",
    "#stories .section-head",
    "#stories .quote-slider",
    "#partners",
    "#get-app",
  ];

  const scrollItems = [];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.classList.add("scroll-reveal");
      scrollItems.push(el);
    });
  });

  document.querySelectorAll(".feature-grid").forEach((grid) => {
    [...grid.children].forEach((child, i) => {
      child.dataset.d = String(i * 140);
    });
  });

  const reveal = (el) => {
    if (el.classList.contains("is-in")) return;
    const delay = Number(el.dataset.d || 0);
    window.setTimeout(() => el.classList.add("is-in"), delay);
  };

  if (reduce) {
    scrollItems.forEach((el) => el.classList.add("is-in"));
    document.querySelectorAll(".reveal-drop").forEach((el) => el.classList.add("is-in"));
    document.querySelectorAll(".partners-track").forEach((el) => {
      el.style.animation = "none";
    });
  } else if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal(entry.target);
          io.unobserve(entry.target);
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -12% 0px" }
    );
    scrollItems.forEach((el) => io.observe(el));
  } else {
    scrollItems.forEach((el) => el.classList.add("is-in"));
  }

  if (!reduce) {
    document.querySelectorAll(".hero-banner .reveal-drop").forEach((el, i) => {
      window.setTimeout(() => el.classList.add("is-in"), 400 + i * 220);
    });
  }
})();
