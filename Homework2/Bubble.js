//버블 클래스
class Bubble {
  // 버블 객체를 생성하는 생성자 함수
  constructor(x, y, r) {
    this.x = x;
    this.y = y;
    this.r = r;

    this.c = color(random(200), random(200, 255), 255);
    this.death = false; //값이 죽었는지 안 죽었는지 확인 (버블이 화면 밖으로 나가면 없어지게 함)

    // Matter Body
    this.body = Bodies.circle(this.x, this.y, this.r, {
      restitution: 0.8,
      frictionAir: 0.05,
    });

    // Matter world에 버블 추가
    Composite.add(engine.world, this.body);
    this.pos = this.body.position;
    this.body.bubble = this;
    this.born = millis();
  }

  // 버블을 화면에 표시
  display() {
    //let pos = this.body.position;

    noFill();
    stroke(this.c);
    circle(this.pos.x, this.pos.y, this.r * 2);
  }
  checkDeath() {
    //버블 객체의 x,y 위치가 - 캔버스 영역을 벗어나는지 체크
    if (this.pos.x < -this.r || this.pos.x > width + this.r || this.pos.y < -this.r) {
      //캔버스를 벗어나면 '죽은'상태가 됨
      this.death = true;
      Composite.remove(engine.world, this.body);
    }
  }

  // 이 좌표(x,y)갑 블록 안에 있는지 체크
  contains(x, y) {
    //"이 좌표가 블록 안에 있는가?"
    // Matter의 바디 안에 특정 좌표(x,y)가 포함되어있는지 확인
    return Vertices.contains(this.body.vertices, { x: x, y: y }); //블록의 네 모서리 위치, {찍은 점의 위치}
  }
  //return : 응/아니로 대답 / Vertices.contains(...) : 그 점이 네 모서리 안쪽이야?

  // 화면에서만 지우면 안 되고, 물리 세계에서도 몸체를 삭제해야 한다.
  remove() {
    Composite.remove(engine.world, this.body);
  }
}
