/* Shrike Marine — homepage
   The hero clip is drawn frame by frame on a canvas:
   1. Intro (time-based): the bird flies in full-bleed, the camera pulls back as it lands,
      and the copy comes up once it is on the wire.
   2. Scroll (scrubbed): it turns to face the viewer, swoops at the camera (the frame grows
      back to full-bleed) and passes overhead, then the hero fades to black.
   3. About and solutions content fades in as it enters. */
(() => {
  const hero = document.querySelector('.hero');
  if (!hero) return;

  const canvas = hero.querySelector('.hero__canvas');
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Clip ---------- */

  // 141 frames (f000–f140), 24 fps, 1280×720, KlingAI watermark painted out.
  const FRAME_COUNT = 141;
  const FPS = 24;
  const SRC_W = 1280;
  const SRC_H = 720;

  // Key frames in the clip.
  const F = {
    camOut: 26,   // intro: camera starts pulling back from full-bleed
    landed: 44,   // feet on the wire
    perch: 50,    // settled facing right; the intro stops here
    turn: 70,     // starts turning to face the viewer
    lift: 102,    // leaves the wire
    full: 124,    // open wings fill the frame
    end: 140,     // last frame with the bird in it
  };

  // In the source frame the wire sits at 53% height and the perched bird is centred at 67% width.
  const WIRE_Y = 0.53;
  const BIRD_X = 0.67;

  // Scroll distance for each stage, in screen heights. Smaller = faster.
  //   hold   bird stays perched while the copy clears
  //   turn   turns to face the viewer
  //   swoop  launches at the camera and passes overhead
  //   black  fade to black before the About section
  const SCROLL = { hold: 0.25, turn: 0.3, swoop: 0.8, black: 0.2 };

  const A = SCROLL.hold;
  const B = A + SCROLL.turn;
  const C = B + SCROLL.swoop;
  const END = C + SCROLL.black;
  hero.style.setProperty('--runway', END);

  /* ---------- Frame loading ---------- */

  const frames = new Array(FRAME_COUNT);

  function loadFrame(i) {
    return new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => { frames[i] = img; needsDraw = true; resolve(); };
      img.onerror = resolve;
      img.src = `assets/frames/f${String(i).padStart(3, '0')}.webp`;
    });
  }

  // Loads frames a..b in order, a few at a time.
  function loadRange(a, b) {
    const queue = [];
    for (let i = a; i <= b; i++) queue.push(i);
    const worker = async () => { while (queue.length) await loadFrame(queue.shift()); };
    return Promise.all(Array.from({ length: 6 }, worker));
  }

  // Nearest frame at or before i that has loaded (falls forward if none).
  function frameAt(i) {
    for (let j = i; j >= 0; j--) if (frames[j]) return frames[j];
    for (let j = i + 1; j < FRAME_COUNT; j++) if (frames[j]) return frames[j];
    return null;
  }

  /* ---------- Layout ---------- */

  let W = 0, H = 0, dpr = 1, wide = false;
  const wideQuery = window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 1/1)');

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth;
    H = canvas.clientHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    wide = wideQuery.matches;
    needsDraw = true;
  }

  // Where the frame sits while the bird is perched: small, on the right (wide screens)
  // or across the top (phones). The clip's background is pure black, so no edge shows.
  function perchRect() {
    if (wide) {
      const h = 0.5 * H;                        // bird ≈ half the screen height
      const w = h * SRC_W / SRC_H;
      return { x: W - w, y: 0.55 * H - WIRE_Y * h, w, h };
    }
    const w = Math.min(1.3 * W, 0.84 * H);
    const h = w * SRC_H / SRC_W;
    // centre the bird, but never let the wire stop short of the right edge
    const x = Math.max(0.5 * W - BIRD_X * w, W - w);
    return { x, y: Math.max(48, 0.06 * H), w, h };
  }

  // Full-bleed, centred on focus point (fx, fy) of the source frame.
  function coverRect(fx, fy) {
    const s = Math.max(W / SRC_W, H / SRC_H);
    const w = SRC_W * s, h = SRC_H * s;
    const x = Math.min(0, Math.max(W - w, W / 2 - fx * w));
    const y = Math.min(0, Math.max(H - h, H / 2 - fy * h));
    return { x, y, w, h };
  }

  function mixRect(a, b, t) {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      w: a.w + (b.w - a.w) * t,
      h: a.h + (b.h - a.h) * t,
    };
  }

  /* ---------- Camera state ---------- */

  // mix: 0 = perched layout, 1 = full-bleed. fx: horizontal focus when full-bleed.
  const introCam = { frame: 0, mix: 1, fx: 0.6 };
  let introDone = false;
  let scrolled = 0;   // screen heights scrolled through the hero

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const easeInOut = gsap.parseEase('power2.inOut');

  function scrollCam(s) {
    if (reduceMotion) return { frame: 60, mix: 0, fx: 0.5 };
    if (s <= A) return { frame: F.perch + (F.turn - F.perch) * (s / A), mix: 0, fx: 0.5 };
    if (s <= B) return { frame: F.turn + (F.lift - F.turn) * ((s - A) / SCROLL.turn), mix: 0, fx: 0.5 };
    const frame = F.lift + (F.end - F.lift) * clamp01((s - B) / SCROLL.swoop);
    // grow back to full-bleed as the bird comes at the camera
    const mix = easeInOut(clamp01((frame - F.lift - 4) / (F.full - F.lift - 4)));
    return { frame, mix, fx: 0.5 };
  }

  /* ---------- Drawing ---------- */

  let needsDraw = true;
  let lastKey = '';

  function draw() {
    const cam = introDone ? scrollCam(scrolled) : introCam;
    const i = Math.max(0, Math.min(FRAME_COUNT - 1, Math.round(cam.frame)));
    const img = frameAt(i);
    const r = mixRect(perchRect(), coverRect(cam.fx, 0.5), cam.mix);

    const key = `${img && img.src}|${r.x.toFixed(1)}|${r.y.toFixed(1)}|${r.w.toFixed(1)}|${W}|${H}`;
    if (!needsDraw && key === lastKey) return;
    lastKey = key;
    needsDraw = false;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    if (img) {
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
    }
  }

  /* ---------- Intro ---------- */

  let online = false;
  let revealed = false;

  function goOnline() {
    if (online) return;
    online = true;
    hero.classList.add('is-online');
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    goOnline();
    const items = hero.querySelectorAll('[data-reveal]');
    if (reduceMotion) {
      gsap.to(items, { autoAlpha: 1, duration: 0.4, ease: 'none' });
      return;
    }
    gsap.fromTo(items,
      { autoAlpha: 0, y: 14 },
      { autoAlpha: 1, y: 0, duration: 0.9, ease: 'power2.out', stagger: 0.09 });
  }

  const intro = gsap.timeline({ paused: true, onComplete: () => { introDone = true; } });
  intro
    .to(introCam, { frame: F.perch, duration: F.perch / FPS, ease: 'none' }, 0)
    .to(introCam, { mix: 0, duration: (F.perch - F.camOut) / FPS + 0.35, ease: 'power2.inOut' }, F.camOut / FPS)
    .call(goOnline, null, F.landed / FPS)
    .call(reveal, null, (F.landed + 2) / FPS);

  function finishIntro() {
    if (introDone) return;
    intro.progress(1);   // fires the remaining callbacks
    introDone = true;
    needsDraw = true;
  }

  /* ---------- Smooth scroll ---------- */

  gsap.registerPlugin(ScrollTrigger);

  let lenis = null;
  if (!reduceMotion && window.Lenis) {
    lenis = new Lenis({ lerp: 0.1 });   // touch keeps native scrolling by default
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
  }

  /* ---------- Scroll timeline (DOM layers; the canvas reads `scrolled`) ---------- */

  const tl = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      trigger: hero,
      start: 'top top',
      end: 'bottom bottom',
      scrub: lenis ? true : 0.5,
      onUpdate: (self) => {
        scrolled = self.progress * END;
        if (self.progress > 0.002) finishIntro();
        needsDraw = true;
      },
    },
  });

  tl.fromTo('.hud__fill', { scaleX: 0 }, { scaleX: 1, duration: C }, 0)
    .to('.hero__copy', { autoAlpha: 0, y: reduceMotion ? 0 : -48, duration: A + 0.05, ease: 'power1.in' }, 0)
    .to('.hero__brand', { autoAlpha: 0, duration: A }, 0.05)
    .to('.hero__scrim', { autoAlpha: 0, duration: 0.15 }, B)
    .to('.hero__hud', { autoAlpha: 0, duration: 0.15 }, B)
    .to('.hero__fade', { autoAlpha: 1, duration: SCROLL.black * 0.85, ease: 'power2.in' }, C)
    .set({}, {}, END);

  /* ---------- About / solutions: reveal on enter ---------- */

  gsap.utils.toArray('[data-inview]').forEach((el) => {
    gsap.fromTo(el,
      { autoAlpha: 0, y: reduceMotion ? 0 : 18 },
      {
        autoAlpha: 1,
        y: 0,
        duration: reduceMotion ? 0.4 : 0.8,
        ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 88%', once: true },
      });
  });

  /* ---------- Start ---------- */

  resize();
  window.addEventListener('resize', resize);
  gsap.ticker.add(draw);

  // Fonts change copy height; recompute positions once they are in.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => ScrollTrigger.refresh());
  }

  if (reduceMotion) {
    introDone = true;
    loadFrame(60).then(() => { needsDraw = true; reveal(); });
    return;
  }

  // Intro frames first; start as soon as they are in (or after 4 s, with what has loaded).
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    if (scrolled > 0.002) finishIntro();   // page restored part-way down
    else intro.play();
  };
  loadFrame(0)
    .then(() => loadRange(1, F.perch))
    .then(start)
    .then(() => loadRange(F.perch + 1, FRAME_COUNT - 1));
  setTimeout(start, 4000);
})();
