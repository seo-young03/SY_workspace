const { Engine, Bodies, Body, Composite, Constraint } = Matter;

//변수 선언
let engine; //엔진 객체
let pole, bar1, bar2, blades, pin, hub;
let t0;

function setup() {
  createCanvas(windowWidth, windowHeight);
  rectMode(CENTER);

  //Matter setting
  engine = Engine.create();
  engine.gravity.y = 0; //중력 끄기

  //기둥 꼭대기 - 회전축
  const cx = width / 2;
  const topY = height / 2 - 100;

  //회전축 원
  hub = Bodies.circle(cx, topY, 10, {
    isStatic: true,
  });

  //기둥(고정)
  pole = Bodies.fromVertices(
    cx,
    topY + 350,
    [
      [
        { x: -90, y: 300 },
        { x: 90, y: 300 },
        { x: 10, y: -300 },
        { x: -10, y: -300 },
      ],
    ],
    {
      isStatic: true,
    },
  );

  //막대 2개
  bar1 = Bodies.rectangle(cx, topY, 10, 600);
  bar2 = Bodies.rectangle(cx, topY, 30, 600);
  Body.setAngle(bar1, HALF_PI); //막대2는 90도 돌림

  blades = Body.create({
    parts: [bar1, bar2],
    frictionAir: 0,
    collisionFilter: { group: -1 }, //기둥과 충돌하지 않음
  });
  Body.setPosition(blades, { x: cx, y: topY });

  //기둥 꼭대기에 핀으로 고정
  pin = Constraint.create({
    pointA: { x: cx, y: topY },
    bodyB: blades,
    pointB: { x: 0, y: 0 },
    length: 0,
    stiffness: 1,
  });

  Composite.add(engine.world, [pole, blades, pin]);

  t0 = millis();
}

function draw() {
  background(0);
  Engine.update(engine);

  let elapsed = millis() - t0;

  if (elapsed < 1000) {
    // 정지
    Body.setAngularVelocity(blades, 0);
  } else if (elapsed < 2000) {
    // 가속
    let p = (elapsed - 1000) / 1000;
    Body.setAngularVelocity(blades, lerp(0, 0.05, p));
  } else if (elapsed < 5000) {
    // 일정한 속도로 회전
    Body.setAngularVelocity(blades, 0.05);
  } else if (elapsed < 6000) {
    // 감속
    let p = (elapsed - 5000) / 1000;
    Body.setAngularVelocity(blades, lerp(0.05, 0, p));
  } else {
    // 완전히 정지
    Body.setAngularVelocity(blades, 0);
  }

  noStroke();

  //기둥
  fill(200);
  drawBody(pole);

  //막대
  fill(255);
  for (let i = 1; i < blades.parts.length; i++) {
    drawBody(blades.parts[i]);
  }

  fill(50);
  drawBody(hub);
}

function drawBody(body) {
  beginShape();
  for (const v of body.vertices) vertex(v.x, v.y);
  endShape(CLOSE);
}
