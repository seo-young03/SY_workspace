const Engine = Matter.Engine;
const World = Matter.World;
const Bodies = Matter.Bodies;
const Body = Matter.Body;

let engine;
let world;
let bambooSlips = [];
let particles = [];
let currentTool = "brush";
let activeStroke = null;
let scrapedThisGesture = new Set();

function setup() {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("canvas-container");

  pixelDensity(1);

  engine = Engine.create();
  world = engine.world;

  world.gravity.x = 0;
  world.gravity.y = 0.8;

  createBambooSlips();

  document.getElementById("brush-tool").addEventListener("click", () => {
    currentTool = "brush";
    resetInteraction();
    updateToolButtons();
  });

  document.getElementById("knife-tool").addEventListener("click", () => {
    currentTool = "knife";
    resetInteraction();
    updateToolButtons();
  });
}

class BambooSlip {
  constructor(x, y, w, h, id) {
    this.id = id;

    this.x = x;
    this.y = y;

    this.originalW = w;
    this.w = w;
    this.h = h;

    this.inkStrokes = [];
    this.wearCount = 0;
    this.isDestroyed = false;

    this.currentAlpha = 255;
    this.stripCount = 7;

    this.stripColors = [];

    for (let i = 0; i < this.stripCount; i++) {
      this.stripColors.push(random(-7, 7));
    }
  }

  contains(px, py) {
    if (this.isDestroyed) return false;

    return px >= this.x - this.w / 2 && px <= this.x + this.w / 2 && py >= this.y && py <= this.y + this.h;
  }

  display() {
    if (this.isDestroyed) return;

    push();

    const left = this.x - this.w / 2;
    const stripW = this.w / this.stripCount;

    noStroke();

    drawingContext.shadowBlur = 12;
    drawingContext.shadowColor = "rgba(60, 48, 30, 0.10)";

    fill(80, 65, 40, 18);

    rect(left, this.y + 3, this.w, this.h, 3);

    drawingContext.shadowBlur = 0;

    drawingContext.save();

    drawingContext.beginPath();

    drawingContext.rect(left, this.y, this.w, this.h);

    drawingContext.clip();

    for (let i = 0; i < this.stripCount; i++) {
      const sx = left + i * stripW;
      const variation = this.stripColors[i];

      const bambooColor = color(216 + variation, 199 + variation, 158 + variation, this.currentAlpha);

      noStroke();
      fill(bambooColor);

      rect(sx, this.y, stripW + 0.5, this.h);

      stroke(125, 108, 75, this.currentAlpha * 0.12);

      strokeWeight(0.6);

      for (let j = 0; j < 5; j++) {
        const gx = sx + randomSeeded(i * 100 + j) * stripW;

        line(gx, this.y + 5, gx + randomSeeded(j * 20 + i) * 2, this.y + this.h - 5);
      }

      stroke(130, 110, 75, this.currentAlpha * 0.13);

      strokeWeight(0.8);

      line(sx, this.y, sx, this.y + this.h);
    }

    this.drawBindings(left, this.w);
    this.displayInk();

    drawingContext.restore();

    pop();
  }

  drawBindings(left, widthValue) {
    const positions = [this.y + this.h * 0.24, this.y + this.h * 0.76];

    for (const by of positions) {
      stroke(90, 70, 45, 15);
      strokeWeight(4);

      line(left, by + 1, left + widthValue, by + 1);

      stroke(153, 130, 91, this.currentAlpha * 0.85);

      strokeWeight(2.2);

      line(left, by, left + widthValue, by);

      stroke(235, 221, 187, this.currentAlpha * 0.7);

      strokeWeight(0.7);

      line(left, by - 1, left + widthValue, by - 1);
    }
  }

  displayInk() {
    for (const strokeData of this.inkStrokes) {
      const points = strokeData.points;

      if (points.length === 0) continue;

      noFill();

      stroke(15, 14, 12, 245);
      strokeWeight(5);
      strokeCap(ROUND);
      strokeJoin(ROUND);

      if (points.length === 1) {
        fill(15, 14, 12, 245);
        noStroke();

        circle(points[0].x, points[0].y, 5);

        continue;
      }

      beginShape();

      for (const p of points) {
        vertex(p.x, p.y);
      }

      endShape();
    }
  }

  addInkPoint(px, py) {
    if (!this.contains(px, py)) return;

    if (!activeStroke || activeStroke.slipId !== this.id) {
      activeStroke = {
        slipId: this.id,
        points: [],
      };

      this.inkStrokes.push(activeStroke);
    }

    activeStroke.points.push({
      x: px,
      y: py,
    });
  }

  scrape() {
    if (this.isDestroyed) return;

    this.wearCount++;

    this.inkStrokes = [];

    if (this.wearCount === 1) {
      this.currentAlpha = 220;

      this.w = this.originalW * 0.93;
    } else if (this.wearCount === 2) {
      this.currentAlpha = 175;

      this.w = this.originalW * 0.86;
    } else if (this.wearCount >= 3) {
      this.disintegrate();
    }
  }

  disintegrate() {
    if (this.isDestroyed) return;

    this.isDestroyed = true;

    const particleCount = 110;

    for (let i = 0; i < particleCount; i++) {
      const px = random(this.x - this.w / 2, this.x + this.w / 2);

      const py = random(this.y, this.y + this.h);

      const particleSize = random(1.5, 4);

      const body = Bodies.circle(px, py, particleSize, {
        restitution: 0.45,
        friction: 0.05,
        frictionAir: 0.025,
        density: 0.001,
      });

      Body.setVelocity(body, {
        x: random(-5, 5),
        y: random(-7, 3),
      });

      World.add(world, body);

      particles.push({
        body: body,

        size: random(2, 6),

        alpha: random(150, 230),

        shade: random(-10, 10),
      });
    }
  }
}

function createBambooSlips() {
  bambooSlips = [];

  const slipHeight = height * 0.94;

  const slipWidth = min(width * 0.24, 220);

  const topMargin = (height - slipHeight) / 2;

  const positions = [width * 0.25, width * 0.5, width * 0.75];

  for (let i = 0; i < 3; i++) {
    bambooSlips.push(new BambooSlip(positions[i], topMargin, slipWidth, slipHeight, i));
  }
}

function updateToolButtons() {
  document.getElementById("brush-tool").classList.toggle("active", currentTool === "brush");

  document.getElementById("knife-tool").classList.toggle("active", currentTool === "knife");
}

function resetInteraction() {
  activeStroke = null;
  scrapedThisGesture.clear();
}

function mousePressed() {
  resetInteraction();

  if (currentTool === "brush") {
    handleBrush(mouseX, mouseY);
  } else if (currentTool === "knife") {
    handleKnife(mouseX, mouseY);
  }

  return false;
}

function mouseDragged() {
  if (currentTool === "brush") {
    handleBrush(mouseX, mouseY);
  } else if (currentTool === "knife") {
    handleKnife(mouseX, mouseY);
  }

  return false;
}

function mouseReleased() {
  resetInteraction();

  return false;
}

function handleBrush(px, py) {
  for (const slip of bambooSlips) {
    if (slip.contains(px, py)) {
      slip.addInkPoint(px, py);

      return;
    }
  }

  activeStroke = null;
}

function handleKnife(px, py) {
  for (const slip of bambooSlips) {
    if (slip.contains(px, py) && !scrapedThisGesture.has(slip.id)) {
      scrapedThisGesture.add(slip.id);

      slip.scrape();
    }
  }
}

function updateParticles() {
  Engine.update(engine, deltaTime);

  for (let i = particles.length - 1; i >= 0; i--) {
    const particle = particles[i];

    const pos = particle.body.position;

    particle.alpha -= 1.1;

    noStroke();

    fill(185 + particle.shade, 164 + particle.shade, 120 + particle.shade, max(0, particle.alpha));

    circle(pos.x, pos.y, particle.size);

    if (particle.alpha <= 0 || pos.y > height + 100 || pos.x < -100 || pos.x > width + 100) {
      World.remove(world, particle.body);

      particles.splice(i, 1);
    }
  }
}

function draw() {
  background(255);

  for (const slip of bambooSlips) {
    slip.display();
  }

  updateParticles();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  const slipHeight = height * 0.94;
  const slipWidth = min(width * 0.24, 220);

  const topMargin = (height - slipHeight) / 2;

  const positions = [width * 0.25, width * 0.5, width * 0.75];

  bambooSlips.forEach((slip, index) => {
    slip.x = positions[index];
    slip.y = topMargin;

    slip.h = slipHeight;

    slip.originalW = slipWidth;

    slip.w = slip.originalW * (1 - slip.wearCount * 0.07);
  });
}

function randomSeeded(seed) {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;

  return value - Math.floor(value);
}
