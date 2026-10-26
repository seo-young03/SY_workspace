const CONFIG = {
  maxEdits: 5,
  maxChars: 10,
  baseWidth: 42,
  minHeight: 110,
  maxHeight: 260,
  topZone: 40,
  bottomPad: 14,
  baseFontSize: 14,
  glyphStepRatio: 1.12,
  widthWearFactor: 0.965,
  heightWearFactor: 0.95,
  floorMargin: 14,
  gravity: 1.1,
  colorFresh: "#c8a57a",
  colorWorn: "#e9e0d2",
  fontFamily: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif`,
  clickMaxMovePx: 6,
  clickMaxDurationMs: 400,
  tapMaxMovePx: 10,
  tapMaxDurationMs: 500,
  touchHitSlop: 12,
  ignoreMouseAfterTouchMs: 800,
  hookCount: 4,
  hookMarginRight: 90,
  pegRadius: 3,
  snapRadius: 70,
  snapEase: 0.22,
  unhookDragPx: 10,
  hangingAirFriction: 0.03,
  looseAirFriction: 0.015,
  editAccent: [214, 150, 70],
};

const CAT_WALL = 0x0001;
const CAT_LOOSE = 0x0002;
const CAT_HOOKED = 0x0004;

const { Engine, Bodies, Body, Composite, Constraint, Events, Mouse, MouseConstraint, Query } = Matter;

let engine;
let world;
let walls = [];
let mouseConstraint;
let canvasEl;

const slips = [];
const shavings = [];
let hooks = [];
let activeSlip = null;
let pressInfo = null;
let dragStart = null;
let draftBeforeEdit = "";
let statusTimer = null;
let lastTouchTime = -10000;
let lastInputBlur = -10000;

const noteInput = document.getElementById("note-input");
const statusEl = document.getElementById("edit-status");
noteInput.maxLength = CONFIG.maxChars;
const noteForm = document.getElementById("note-form");
const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

function hexToRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function rgba(rgb, alpha) {
  return `rgba(${Math.round(rgb[0])},${Math.round(rgb[1])},${Math.round(rgb[2])},${alpha})`;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function makeRng(seed) {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fontString(size) {
  return `500 ${size}px ${CONFIG.fontFamily}`;
}

function layoutGlyphs(text, size) {
  const step = size * CONFIG.glyphStepRatio;
  const glyphs = [];
  let cursor = 0;

  for (const ch of Array.from(text)) {
    if (ch === " ") {
      cursor += step * 0.5;
      continue;
    }
    glyphs.push({ ch, y: cursor + step / 2 });
    cursor += step;
  }

  return { glyphs, length: cursor, step };
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function editsLeftLabel(slip) {
  const left = CONFIG.maxEdits - slip.editCount;
  return `${left} ${left === 1 ? "edit" : "edits"} left`;
}

function showStatus(message, persistent) {
  clearTimeout(statusTimer);
  statusEl.textContent = message;
  statusEl.classList.add("visible");

  if (!persistent) {
    statusTimer = setTimeout(() => statusEl.classList.remove("visible"), 1800);
  }
}

function hideStatus() {
  clearTimeout(statusTimer);
  statusEl.classList.remove("visible");
}

class WoodenSlip {
  constructor(text, x, y) {
    this.text = text;
    this.editCount = 0;
    this.seed = Math.floor(Math.random() * 1e9);

    this.state = "free";
    this.hook = null;
    this.pivot = null;

    this.isEditing = false;
    this.editGlow = 0;
    this.preview = null;

    this.updateSize();

    this.body = Bodies.rectangle(x, y, this.w, this.h, {
      chamfer: { radius: 5 },
      restitution: 0.12,
      friction: 0.7,
      frictionAir: CONFIG.looseAirFriction,
      density: 0.0018,
      angle: (Math.random() - 0.5) * 0.5,
      collisionFilter: {
        category: CAT_LOOSE,
        mask: CAT_WALL | CAT_LOOSE | CAT_HOOKED,
      },
    });

    this.body.slipRef = this;
    Body.setVelocity(this.body, { x: (Math.random() - 0.5) * 2, y: 2 });
    Body.setAngularVelocity(this.body, (Math.random() - 0.5) * 0.08);
    Composite.add(world, this.body);

    this.buildGrain();
  }

  get wearRatio() {
    return this.editCount / CONFIG.maxEdits;
  }

  get isLocked() {
    return this.editCount >= CONFIG.maxEdits;
  }

  updateSize() {
    const wearW = Math.pow(CONFIG.widthWearFactor, this.editCount);
    const wearH = Math.pow(CONFIG.heightWearFactor, this.editCount);

    const freshLength = layoutGlyphs(this.text, CONFIG.baseFontSize).length;
    const freshHeight = clamp(CONFIG.topZone + freshLength + CONFIG.bottomPad, CONFIG.minHeight, CONFIG.maxHeight);

    this.w = CONFIG.baseWidth * wearW;
    this.h = freshHeight * wearH;

    this.holeR = clamp(this.w * 0.14, CONFIG.pegRadius + 1, 6);
    this.holeInset = this.holeR + 8;
    this.holeY = -this.h / 2 + this.holeInset;
    this.topZone = this.holeInset + this.holeR + 8;

    this.pivotLocal = {
      x: 0,
      y: this.holeY - (this.holeR - CONFIG.pegRadius),
    };

    const view = this.fitText(this.text);
    this.fontPx = view.fontPx;
    this.glyphLayout = view.glyphLayout;
    this.textTop = view.textTop;
  }

  fitText(text) {
    const available = this.h - this.topZone - 10;
    let size = Math.min(CONFIG.baseFontSize * (1 - 0.02 * this.editCount), (this.w - 8) * 0.85);

    let layout = layoutGlyphs(text, size);

    if (layout.length > available) {
      size = Math.max(size * (available / layout.length), 7);
      layout = layoutGlyphs(text, size);
    }

    return {
      fontPx: size,
      glyphLayout: layout,
      textTop: -this.h / 2 + this.topZone + Math.max(0, (available - layout.length) / 2),
    };
  }

  setPreview(text) {
    this.preview = this.fitText(text);
  }

  buildGrain() {
    const rng = makeRng(this.seed);
    this.grain = [];

    for (let i = 0; i < 7; i++) {
      this.grain.push({
        x: rng(),
        amp: 0.4 + rng() * 1.2,
        freq: 0.012 + rng() * 0.03,
        phase: rng() * Math.PI * 2,
        alpha: 0.05 + rng() * 0.08,
        weight: 0.6 + rng() * 0.9,
      });
    }

    this.knot = {
      x: (rng() - 0.5) * 0.4,
      y: (rng() - 0.5) * 0.5,
      r: 2 + rng() * 2,
    };

    this.cracks = [];

    for (let i = 0; i < 5; i++) {
      const side = rng() > 0.5 ? -1 : 1;
      let py = rng() * 0.45 - 0.1;
      const points = [];

      for (let k = 0; k < 4; k++) {
        points.push({ x: side * (0.5 - k * 0.14), y: py });
        py += (rng() - 0.5) * 0.04;
      }

      this.cracks.push(points);
    }
  }

  applyEdit(newText) {
    this.text = newText;
    this.editCount += 1;

    if (this.editCount >= CONFIG.maxEdits) {
      disintegrateSlip(this);
      return;
    }

    const oldW = this.w;
    const oldH = this.h;
    this.updateSize();

    Body.scale(this.body, this.w / oldW, this.h / oldH);
    Body.setVelocity(this.body, { x: 0, y: -1.5 });

    if (this.state === "hooked") {
      this.removePivot();
      Body.setAngle(this.body, 0);
      Body.setPosition(this.body, this.restCenter(this.hook));
      this.createPivot();
    }

    spawnShavings(this);
  }

  pivotWorld() {
    const cos = Math.cos(this.body.angle);
    const sin = Math.sin(this.body.angle);

    return {
      x: this.body.position.x + this.pivotLocal.x * cos - this.pivotLocal.y * sin,
      y: this.body.position.y + this.pivotLocal.x * sin + this.pivotLocal.y * cos,
    };
  }

  restCenter(hook) {
    return {
      x: hook.x - this.pivotLocal.x,
      y: hook.y - this.pivotLocal.y,
    };
  }

  createPivot() {
    this.pivot = Constraint.create({
      pointA: { x: this.hook.x, y: this.hook.y },
      bodyB: this.body,
      pointB: { x: this.pivotLocal.x, y: this.pivotLocal.y },
      length: 0,
      stiffness: 0.95,
      damping: 0.1,
    });

    Composite.add(world, this.pivot);
    this.body.frictionAir = CONFIG.hangingAirFriction;
  }

  removePivot() {
    if (this.pivot) Composite.remove(world, this.pivot);
    this.pivot = null;
    this.body.frictionAir = CONFIG.looseAirFriction;
  }

  setCollisionMode(hooked) {
    this.body.collisionFilter.category = hooked ? CAT_HOOKED : CAT_LOOSE;
    this.body.collisionFilter.mask = hooked ? CAT_WALL | CAT_LOOSE : CAT_WALL | CAT_LOOSE | CAT_HOOKED;
  }

  tracePath(ctx) {
    const r = Math.min(6, this.w * 0.18);
    roundedRectPath(ctx, -this.w / 2, -this.h / 2, this.w, this.h, r);
    ctx.moveTo(this.holeR, this.holeY);
    ctx.arc(0, this.holeY, this.holeR, 0, Math.PI * 2);
  }

  display(isDragged) {
    const ctx = drawingContext;
    const dpr = pixelDensity();
    const { x, y } = this.body.position;
    const w = this.w;
    const h = this.h;
    const t = this.wearRatio;
    const outerRadius = Math.min(6, w * 0.18);

    const base = mixRgb(hexToRgb(CONFIG.colorFresh), hexToRgb(CONFIG.colorWorn), t);
    const grainColor = mixRgb(base, [90, 60, 30], 0.55);

    this.editGlow += ((this.isEditing ? 1 : 0) - this.editGlow) * 0.18;
    const pulse = this.isEditing ? 0.85 + 0.15 * Math.sin(millis() / 260) : 1;
    const glow = this.editGlow * pulse;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.body.angle);

    if (glow > 0.01) {
      ctx.save();
      ctx.shadowColor = rgba(CONFIG.editAccent, (0.7 * glow).toFixed(3));
      ctx.shadowBlur = 26 * dpr;
      ctx.fillStyle = rgba(CONFIG.editAccent, 1);
      this.tracePath(ctx);
      ctx.fill("evenodd");
      ctx.restore();
    }

    const lift = isDragged ? 1.6 : 1;
    ctx.shadowColor = `rgba(70,50,30,${(0.16 - 0.05 * t).toFixed(3)})`;
    ctx.shadowBlur = 16 * lift * dpr;
    ctx.shadowOffsetY = 7 * lift * dpr;

    const gradient = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
    gradient.addColorStop(0, rgba(mixRgb(base, [255, 255, 255], 0.1), 1));
    gradient.addColorStop(0.55, rgba(base, 1));
    gradient.addColorStop(1, rgba(mixRgb(base, [60, 40, 20], 0.08), 1));

    ctx.fillStyle = gradient;
    this.tracePath(ctx);
    ctx.fill("evenodd");

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.save();
    this.tracePath(ctx);
    ctx.clip("evenodd");

    ctx.lineCap = "round";

    for (const g of this.grain) {
      const xx = (g.x - 0.5) * w * 0.85;
      ctx.beginPath();

      for (let py = -h / 2; py <= h / 2 + 6; py += 6) {
        const px = xx + Math.sin(py * g.freq + g.phase) * g.amp * (w / CONFIG.baseWidth);

        if (py === -h / 2) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }

      ctx.strokeStyle = rgba(grainColor, g.alpha * (1 - 0.5 * t));
      ctx.lineWidth = g.weight;
      ctx.stroke();
    }

    const kx = this.knot.x * w;
    const ky = h * 0.15 + this.knot.y * h * 0.5;

    ctx.strokeStyle = rgba(grainColor, 0.1 * (1 - 0.5 * t));
    ctx.lineWidth = 0.8;

    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.ellipse(kx, ky, this.knot.r * i * 0.8, this.knot.r * i * 1.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    const shade = ctx.createLinearGradient(w * 0.1, 0, w / 2, 0);
    shade.addColorStop(0, "rgba(80,55,30,0)");
    shade.addColorStop(1, "rgba(80,55,30,0.10)");
    ctx.fillStyle = shade;
    ctx.fillRect(w * 0.1, -h / 2, w * 0.4, h);

    const crackCount = Math.floor(this.editCount * 0.5);
    ctx.strokeStyle = "rgba(80,55,30,0.28)";
    ctx.lineWidth = 0.8;

    for (let i = 0; i < crackCount; i++) {
      ctx.beginPath();

      this.cracks[i].forEach((p, idx) => {
        const cx = p.x * w;
        const cy = p.y * h;

        if (idx === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      });

      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-w / 2 + 1, -h / 2 + 8);
    ctx.lineTo(-w / 2 + 1, h / 2 - 8);
    ctx.stroke();

    ctx.restore();

    if (glow > 0.01) {
      ctx.strokeStyle = rgba(CONFIG.editAccent, (0.85 * glow).toFixed(3));
      ctx.lineWidth = 1.5;
      roundedRectPath(ctx, -w / 2, -h / 2, w, h, outerRadius);
      ctx.stroke();
    }

    ctx.strokeStyle = rgba(grainColor, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, this.holeY, this.holeR + 0.4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(60,40,20,0.35)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, this.holeY, this.holeR - 0.6, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, this.holeY, this.holeR + 0.9, Math.PI * 0.1, Math.PI * 0.9);
    ctx.stroke();

    const view = this.isEditing && this.preview ? this.preview : this;
    ctx.font = fontString(view.fontPx);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const dark = this.isEditing
      ? rgba([58, 36, 16], 0.98)
      : rgba(mixRgb([74, 50, 30], [130, 108, 84], t), 0.9 - 0.25 * t);

    const light = rgba([255, 250, 240], 0.5 * (1 - 0.5 * t));

    for (const glyph of view.glyphLayout.glyphs) {
      const gy = view.textTop + glyph.y;
      ctx.fillStyle = light;
      ctx.fillText(glyph.ch, 0, gy + 1.2);
      ctx.fillStyle = dark;
      ctx.fillText(glyph.ch, 0, gy + 0.2);
    }

    if (this.isEditing && Math.floor(millis() / 500) % 2 === 0) {
      const caretY = Math.min(view.textTop + view.glyphLayout.length + 2, h / 2 - 4);

      ctx.strokeStyle = rgba(CONFIG.editAccent, 0.95);
      ctx.lineWidth = 1.5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-view.fontPx * 0.4, caretY);
      ctx.lineTo(view.fontPx * 0.4, caretY);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(80,55,30,0.35)";
    for (let i = 0; i < this.editCount; i++) {
      ctx.fillRect(w / 2 - 5, h / 2 - 16 - i * 5, 3, 1.4);
    }

    ctx.restore();
  }
}
function layoutHooks() {
  const previous = hooks;
  const x = Math.max(width - CONFIG.hookMarginRight, width * 0.6);
  const top = clamp(height * 0.1, 60, 110);
  const spacing = clamp((height - top - 150) / (CONFIG.hookCount - 1), 100, 260);

  hooks = [];

  for (let i = 0; i < CONFIG.hookCount; i++) {
    const hook = {
      x: x,
      y: top + i * spacing,
      occupant: previous[i] ? previous[i].occupant : null,
      glow: 0,
      pulse: 0,
    };

    if (hook.occupant) hook.occupant.hook = hook;
    hooks.push(hook);
  }

  for (const slip of slips) {
    if (slip.state === "hooked") {
      slip.removePivot();
      slip.state = "snapping";
    }
  }
}

function findSnapHook(slip) {
  const pivot = slip.pivotWorld();
  let best = null;
  let bestDistance = CONFIG.snapRadius;

  for (const hook of hooks) {
    if (hook.occupant && hook.occupant !== slip) continue;

    const d = Math.hypot(pivot.x - hook.x, pivot.y - hook.y);

    if (d < bestDistance) {
      bestDistance = d;
      best = hook;
    }
  }

  return best;
}

function beginSnap(slip, hook) {
  slip.hook = hook;
  hook.occupant = slip;
  slip.state = "snapping";
  slip.setCollisionMode(true);
}

function releaseFromHook(slip) {
  slip.removePivot();

  if (slip.hook && slip.hook.occupant === slip) {
    slip.hook.occupant = null;
  }

  slip.hook = null;
  slip.state = "free";
  slip.setCollisionMode(false);
}

function updateSnapping(slip) {
  if (slip.state !== "snapping") return;

  const body = slip.body;
  const rest = slip.restCenter(slip.hook);
  const ease = CONFIG.snapEase;

  const angle = ((((body.angle + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

  Body.setVelocity(body, { x: 0, y: 0 });
  Body.setAngularVelocity(body, 0);

  Body.setPosition(body, {
    x: body.position.x + (rest.x - body.position.x) * ease,
    y: body.position.y + (rest.y - body.position.y) * ease,
  });

  Body.setAngle(body, angle * (1 - ease));

  const close = Math.hypot(rest.x - body.position.x, rest.y - body.position.y) < 1.2 && Math.abs(angle) < 0.015;

  if (close) {
    Body.setPosition(body, rest);
    Body.setAngle(body, 0);
    slip.createPivot();
    slip.state = "hooked";
    slip.hook.pulse = 1;
    Body.setAngularVelocity(body, (Math.random() > 0.5 ? 1 : -1) * 0.012);
  }
}

function drawHooksBack() {
  const ctx = drawingContext;
  const dpr = pixelDensity();

  for (const hook of hooks) {
    if (hook.glow > 0.01) {
      ctx.strokeStyle = `rgba(200,165,122,${(0.5 * hook.glow).toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hook.x, hook.y, 12 + 3 * hook.glow, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (hook.pulse > 0.01) {
      ctx.strokeStyle = `rgba(200,165,122,${(0.4 * hook.pulse).toFixed(3)})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(hook.x, hook.y, 8 + (1 - hook.pulse) * 26, 0, Math.PI * 2);
      ctx.stroke();
      hook.pulse = Math.max(0, hook.pulse - 0.04);
    }

    ctx.save();
    ctx.shadowColor = "rgba(70,50,30,0.14)";
    ctx.shadowBlur = 5 * dpr;
    ctx.shadowOffsetY = 2 * dpr;
    ctx.strokeStyle = "rgba(122,112,100,0.85)";
    ctx.fillStyle = "rgba(170,160,148,0.9)";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.arc(hook.x, hook.y - 34, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(hook.x, hook.y - 34);
    ctx.lineTo(hook.x, hook.y);
    ctx.stroke();

    ctx.restore();
  }
}

function drawHookTips() {
  const ctx = drawingContext;

  for (const hook of hooks) {
    ctx.fillStyle = "rgba(138,128,116,1)";
    ctx.beginPath();
    ctx.arc(hook.x, hook.y, CONFIG.pegRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.arc(hook.x - 0.8, hook.y - 0.9, CONFIG.pegRadius * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function spawnShavings(slip) {
  const { x, y } = slip.body.position;

  for (let i = 0; i < 16; i++) {
    shavings.push({
      x: x + (Math.random() - 0.5) * slip.w,
      y: y + (Math.random() - 0.5) * slip.h,
      vx: (Math.random() - 0.5) * 1.6,
      vy: -Math.random() * 1.2,
      size: 1 + Math.random() * 1.6,
      life: 1,
    });
  }
}

function disintegrateSlip(slip) {
  const body = slip.body;
  const center = body.position;
  const angle = body.angle;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  if (slip.hook && slip.hook.occupant === slip) {
    slip.hook.occupant = null;
  }

  slip.removePivot();
  slip.hook = null;

  for (let i = 0; i < 150; i++) {
    const localX = (Math.random() - 0.5) * slip.w;
    const localY = (Math.random() - 0.5) * slip.h;

    const x = center.x + localX * cos - localY * sin;
    const y = center.y + localX * sin + localY * cos;

    const angleOut = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 3.8;

    shavings.push({
      x,
      y,
      vx: Math.cos(angleOut) * speed + body.velocity.x * 0.25,
      vy: Math.sin(angleOut) * speed - 0.8 + body.velocity.y * 0.25,
      size: 1.2 + Math.random() * 3.2,
      life: 1,
    });
  }

  if (activeSlip === slip) activeSlip = null;

  Composite.remove(world, body);

  const index = slips.indexOf(slip);
  if (index !== -1) slips.splice(index, 1);
}

function updateAndDrawShavings() {
  noStroke();

  for (let i = shavings.length - 1; i >= 0; i--) {
    const s = shavings[i];

    s.vy += 0.06;
    s.x += s.vx;
    s.y += s.vy;
    s.life -= 0.018;

    if (s.life <= 0) {
      shavings.splice(i, 1);
      continue;
    }

    fill(176, 140, 100, 150 * s.life);
    circle(s.x, s.y, s.size);
  }
}

function buildWalls() {
  if (walls.length) Composite.remove(world, walls);

  const thickness = 100;
  const floorTop = height - CONFIG.floorMargin;
  const wallOptions = {
    isStatic: true,
    collisionFilter: { category: CAT_WALL },
  };

  walls = [
    Bodies.rectangle(width / 2, floorTop + thickness / 2, width * 2, thickness, { ...wallOptions, friction: 0.8 }),

    Bodies.rectangle(-thickness / 2, -height, thickness, height * 4, wallOptions),

    Bodies.rectangle(width + thickness / 2, -height, thickness, height * 4, wallOptions),
  ];

  Composite.add(world, walls);
}

function keepSlipsInBounds() {
  for (const slip of slips) {
    if (slip.state !== "free") continue;

    const p = slip.body.position;

    if (p.x > width - 30 || p.x < 30 || p.y > height + 300) {
      Body.setPosition(slip.body, {
        x: clamp(p.x, 60, Math.max(60, width - 60)),
        y: p.y > height + 300 ? -60 : p.y,
      });

      Body.setVelocity(slip.body, { x: 0, y: 0 });
    }
  }
}

function spawnSlipFromInput() {
  const text = noteInput.value.trim();
  if (!text) return;

  const x = random(160, Math.max(220, width * 0.4));

  slips.push(new WoodenSlip(text, x, -CONFIG.maxHeight / 2 - 20));

  noteInput.value = "";
}
function openEditor(slip, fromTouch) {
  if (slip === activeSlip || slip.state === "snapping") return;

  if (slip.isLocked) {
    Body.setVelocity(slip.body, {
      x: (Math.random() - 0.5) * 3,
      y: -3,
    });

    Body.setAngularVelocity(slip.body, (Math.random() - 0.5) * 0.1);

    showStatus("This slip is fully worn - it can't be edited anymore");
    return;
  }

  if (activeSlip) finishEdit(true);

  activeSlip = slip;
  slip.isEditing = true;
  slip.preview = slip.fitText(slip.text);

  Body.setVelocity(slip.body, { x: 0, y: 0 });
  Body.setAngularVelocity(slip.body, 0);
  Body.setAngle(slip.body, 0);

  if (slip.state === "free") {
    const floorTop = height - CONFIG.floorMargin;

    Body.setPosition(slip.body, {
      x: clamp(slip.body.position.x, slip.w / 2 + 4, width - slip.w / 2 - 4),
      y: Math.min(slip.body.position.y, floorTop - slip.h / 2 - 2),
    });
  }

  Body.setStatic(slip.body, true);

  draftBeforeEdit = noteInput.value;
  noteInput.value = slip.text;
  noteInput.classList.add("editing");
  noteInput.enterKeyHint = "done";

  showStatus(
    isCoarsePointer
      ? `Editing · ${editsLeftLabel(slip)} · tap Done or tap outside to save`
      : `Editing · ${editsLeftLabel(slip)} · Enter to save · Esc to cancel`,
    true,
  );

  noteInput.focus({ preventScroll: true });

  if (fromTouch) {
    const end = noteInput.value.length;
    noteInput.setSelectionRange(end, end);
  } else {
    noteInput.select();
  }

  setTimeout(ensureEditedSlipVisible, 350);
}

function ensureEditedSlipVisible() {
  const slip = activeSlip;

  if (!slip || slip.state !== "free" || !window.visualViewport) return;

  const viewport = window.visualViewport;
  const visibleBottom = viewport.offsetTop + viewport.height - 12;
  const bottom = slip.body.position.y + slip.h / 2;

  if (bottom > visibleBottom) {
    Body.setPosition(slip.body, {
      x: slip.body.position.x,
      y: Math.max(slip.h / 2 + 8, visibleBottom - slip.h / 2),
    });
  }
}

function finishEdit(commit) {
  if (!activeSlip) return;

  const slip = activeSlip;
  activeSlip = null;

  const newText = noteInput.value.replace(/[\r\n]+/g, "").trim();

  noteInput.value = draftBeforeEdit;
  draftBeforeEdit = "";
  noteInput.classList.remove("editing");
  noteInput.enterKeyHint = "enter";

  slip.isEditing = false;
  slip.preview = null;

  Body.setStatic(slip.body, false);

  if (commit && newText && newText !== slip.text) {
    slip.applyEdit(newText);

    if (slips.includes(slip)) {
      showStatus(`Saved · ${editsLeftLabel(slip)}`);
    } else {
      showStatus("The wooden slip has turned to dust");
    }
  } else {
    hideStatus();
  }
}

noteInput.addEventListener("keydown", (event) => {
  if (event.isComposing || event.keyCode === 229) return;

  if (event.key === "Enter") {
    event.preventDefault();
    submitInput();
  } else if (event.key === "Escape" && activeSlip) {
    event.preventDefault();
    finishEdit(false);
  }
});

noteInput.addEventListener("input", () => {
  if (activeSlip) {
    activeSlip.setPreview(noteInput.value);
  }
});

function submitInput() {
  if (activeSlip) {
    finishEdit(true);
  } else {
    spawnSlipFromInput();
  }
}

noteForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitInput();
});

noteInput.addEventListener("blur", () => {
  lastInputBlur = performance.now();
  finishEdit(true);
});

noteInput.addEventListener("focus", () => {
  setTimeout(() => window.scrollTo(0, 0), 50);
});

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", ensureEditedSlipVisible);
}
function setup() {
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));

  const renderer = createCanvas(windowWidth, windowHeight);
  canvasEl = renderer.elt;

  engine = Engine.create();
  world = engine.world;
  engine.gravity.y = CONFIG.gravity;

  buildWalls();
  layoutHooks();

  const mouse = Mouse.create(canvasEl);
  mouse.pixelRatio = pixelDensity();

  mouseConstraint = MouseConstraint.create(engine, {
    mouse: mouse,
    constraint: {
      stiffness: 0.18,
      damping: 0.12,
      render: { visible: false },
    },
  });

  Composite.add(world, mouseConstraint);

  Events.on(mouseConstraint, "startdrag", (event) => {
    const slip = event.body.slipRef;
    if (!slip) return;

    dragStart = {
      x: event.mouse.position.x,
      y: event.mouse.position.y,
    };

    if (slip.state === "snapping") {
      releaseFromHook(slip);
    }
  });

  Events.on(mouseConstraint, "enddrag", (event) => {
    const slip = event.body.slipRef;

    if (!slip || slip.state !== "free" || slip.isEditing) return;

    const p = event.mouse.position;

    if (dragStart && dist(p.x, p.y, dragStart.x, dragStart.y) < CONFIG.tapMaxMovePx) {
      return;
    }

    const hook = findSnapHook(slip);
    if (hook) beginSnap(slip, hook);
  });
}

function draw() {
  background(255);

  Engine.update(engine, Math.min(deltaTime, 33));

  for (const slip of slips) {
    updateSnapping(slip);
  }

  const draggedBody = mouseConstraint.body;
  const draggedSlip = draggedBody ? draggedBody.slipRef : null;

  if (draggedSlip && draggedSlip.state === "hooked" && !draggedSlip.isEditing && dragStart) {
    const pointer = mouseConstraint.mouse.position;

    if (dist(pointer.x, pointer.y, dragStart.x, dragStart.y) > CONFIG.unhookDragPx) {
      releaseFromHook(draggedSlip);
    }
  }

  keepSlipsInBounds();

  const candidate = draggedSlip && draggedSlip.state === "free" ? findSnapHook(draggedSlip) : null;

  for (const hook of hooks) {
    hook.glow += ((hook === candidate ? 1 : 0) - hook.glow) * 0.2;
  }

  drawHooksBack();

  for (const slip of slips) {
    if (slip.body !== draggedBody) {
      slip.display(false);
    }
  }

  if (draggedSlip) {
    draggedSlip.display(true);
  }

  drawHookTips();
  updateAndDrawShavings();

  const hovered = Query.point(
    slips.map((s) => s.body),
    { x: mouseX, y: mouseY },
  );

  canvasEl.style.cursor = draggedBody ? "grabbing" : hovered.length ? "grab" : "default";
}

function windowResized() {
  const heightOnly = windowWidth === width;

  const keyboardLikely = document.activeElement === noteInput || performance.now() - lastInputBlur < 800;

  if (heightOnly && keyboardLikely) return;

  finishEdit(false);

  resizeCanvas(windowWidth, windowHeight);
  buildWalls();
  layoutHooks();
}

function findSlipAt(x, y, slop) {
  const bodies = slips.map((s) => s.body);
  let hits = Query.point(bodies, { x, y });

  for (let i = 0; i < 8 && !hits.length && slop > 0; i++) {
    const angle = (i / 8) * Math.PI * 2;

    hits = Query.point(bodies, {
      x: x + Math.cos(angle) * slop,
      y: y + Math.sin(angle) * slop,
    });
  }

  return hits.length ? hits[hits.length - 1].slipRef : null;
}

function beginPress(x, y, isTouch) {
  const slip = findSlipAt(x, y, isTouch ? CONFIG.touchHitSlop : 0);

  if (isTouch && document.activeElement === noteInput && !(slip && slip === activeSlip)) {
    noteInput.blur();
  }

  pressInfo = {
    x,
    y,
    time: millis(),
    slip,
    isTouch,
  };

  return slip;
}

function endPress(x, y) {
  if (!pressInfo) return;

  const info = pressInfo;
  pressInfo = null;

  const maxMove = info.isTouch ? CONFIG.tapMaxMovePx : CONFIG.clickMaxMovePx;

  const maxDuration = info.isTouch ? CONFIG.tapMaxDurationMs : CONFIG.clickMaxDurationMs;

  const moved = dist(info.x, info.y, x, y);
  const duration = millis() - info.time;

  if (info.slip && moved < maxMove && duration < maxDuration) {
    openEditor(info.slip, info.isTouch);
  }
}

function mousePressed(event) {
  if (event && event.target !== canvasEl) return;

  if (performance.now() - lastTouchTime < CONFIG.ignoreMouseAfterTouchMs) {
    return;
  }

  const hit = beginPress(mouseX, mouseY, false);

  if (hit && hit === activeSlip && event && event.cancelable) {
    event.preventDefault();
  }
}

function mouseReleased() {
  if (performance.now() - lastTouchTime < CONFIG.ignoreMouseAfterTouchMs) {
    return;
  }

  endPress(mouseX, mouseY);
}

function touchStarted(event) {
  if (!event || event.target !== canvasEl) return;

  lastTouchTime = performance.now();

  if (event.touches.length > 1) {
    pressInfo = null;
    return;
  }

  const touch = event.touches[0];

  beginPress(touch.clientX, touch.clientY, true);
}

function touchEnded(event) {
  if (!event || event.target !== canvasEl) return;

  lastTouchTime = performance.now();

  if (event.touches.length > 0) {
    pressInfo = null;
    return;
  }

  const touch = event.changedTouches[0];

  endPress(touch.clientX, touch.clientY);
}

window.addEventListener("touchcancel", () => {
  pressInfo = null;
});
