//모듈 별칭
const Engine = Matter.Engine; //물리 세계를 만들고 시간을 진행시킴
const Bodies = Matter.Bodies; //사각형, 원 같은 물체를 만든느 공장
const Composite = Matter.Composite; //물체들을 담는 컨테이너 (world가 이것)
const Body = Matter.Body; //이미 만든 물체의 속도, 위치, 각도 등을 조작
const Mouse = Matter.Mouse; //마우스로 물체를 집을 수 있게 해줌
const MouseConstraint = Matter.MouseConstraint; //마우스로 물체를 집을 수 있게 해줌
const Vertices = Matter.Vertices; //Vertices.contains()함수를 위해 써줘야함

//변수 선언
let engine; //엔진 객체
let bubbles = []; //객체 버블들의 배열 (마우스로 만든 버블들을 담는 배열)
let wind = 0; //현재 바람 세기 (매 프레임 변함)
let t = 0; //시간 값 (바람 계산용)
let windForce = 0; //마우스를 놓을 때 주는 힘
let firstX = 0; //마우스를 누른 순간의 x좌표

function setup() {
  createCanvas(windowWidth, windowHeight);

  //Matter setting (중력 설정)
  engine = Engine.create(); //물리 세계 생성
  engine.gravity.y = -0.1; //위로 떠오르게 만듦
  engine.gravity.scale = 0.001; //scale=중력 세기 배율 (기본값 0.001)

  //벽 만들기
  let margin = 20;
  //Composite.add(engine.world, [...]): 배열에 든 물체들을 물리 세계에 한 번에 추가
  Composite.add(engine.world, [
    Bodies.rectangle(width / 2, height - margin, width, margin, { isStatic: true }), //아래 벽
    Bodies.rectangle(width / 2, margin, width, margin, { isStatic: true }), //위 벽
    //Bodies.rectangle(margin, height / 2, margin, height, { isStatic: true }), //왼쪽 벽
    //Bodies.rectangle(width - margin, height / 2, margin, height, { isStatic: true }), //오른쪽 벽
  ]);

  Matter.Events.on(engine, "collisionStart", function (event) {
    for (let pair of event.pairs) {
      let a = pair.bodyA.bubble; // 벽이면 undefined
      let b = pair.bodyB.bubble;

      // 둘 다 버블일 때만 (벽과 부딪힌 건 제외)
      if (a && b) {
        a.toDelete = true;
        b.toDelete = true;
      }
    }
  });

  ////////////////////////////////////Bubble
}

function draw() {
  Engine.update(engine);
  background(0);
  ///////////////////////////Wind
  // sin: 시간의 변화에 따라 -1~1사이의 값을 반환해줌 (좌우 방향 변화)
  // noise : 0~1 사이의 랜덤한 값을 줌 (바람 세기 변화)
  wind = sin(t) * noise(t);
  t += 0.01; //시간이 흘러가도록 0.01을 더해줌
  engine.gravity.x = wind; //위 값을 gravity.x에 넣어서 좌우로 중력을 주는 방식으로 바람 구현

  ////////////////////////////////////Bubble

  //1. 첫번째 반복문 : 읽기만 함 (그리기, 표시))
  //각 버블을 화면에 그리고, 화면 밖으로 나갔는지 등을 검사함
  for (let b of bubbles) {
    //for...r는 배열의 요소를 하나씩 b에 꺼내어 반복합니다
    b.display(); //버블을 화면에 그림
    b.checkDeath(); //죽을 조건에 해당하는지 검사, 해당하면 this.death=true로 표시
  }

  //2. 두번째 반복문 : 수정만 함 (삭제)
  //죽은 배열 버블 삭제
  for (let i = bubbles.length - 1; i >= 0; i--) {
    if (bubbles[i].toDelete) {
      bubbles[i].remove();
      bubbles.splice(i, 1);
    }
  }
}

function mousePressed() {
  firstX = mouseX;

  //1) 클릭한 곳에 버블이 있으면 터뜨리기
  let popped = false;
  for (let b of bubbles) {
    if (b.contains(mouseX, mouseY)) {
      b.toDelete = true;
      popped = true;
    }
  }

  //2. 아무것도 안 터뜨렸을 때만 새로 만들기
  if (!popped) {
    bubbles.push(new Bubble(mouseX, mouseY, random(15, 50)));
  }
}

//마우스를 누른 곳에서 뗀 곳까지 가로로 얼마나 움직였는지 재서,그 거리를 바람의 힘으로 변환해라.
function mouseReleased() {
  //바람의 강도 구하기
  //dx = x방향으로 이동한 거리(변화량)
  let dx = mouseX - firstX; //mouseX = 마우스를 뗀 지금의 x좌표, firstX = mousePressed에서 마우스를 눌렀을 때 저장해 둔 x좌표
  //map : 어떤 범위의 숫자를 다른 범위의 숫자로 비율에 맞춰 변환하는 p5.js 함수
  //dx는 픽셀 단위라서 -1000~+1000 정도로 크기 때문에 물리엔진에 줄 -0.08~+0.08 값으로 같은 위치에 대응시켜 바꿔줘야함
  windForce = map(dx, -width, width, -0.08, 0.08);

  //모든 버블의 물리 물체를 하나씩 꺼내서, 그 중심에 가로 방향으로 힘을 한 번 가해라
  for (let b of bubbles) {
    Body.applyForce(b.body, b.body.position, { x: windForce, y: 0 });
  }
}
