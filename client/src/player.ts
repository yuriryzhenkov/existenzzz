import { DEATH_Y, SIZE, TERMINAL_V, boxesIn, spawnPoint, type Box, type WorldState } from '../../shared/world';

export const HALF_W = 0.3;
export const STAND_H = 1.8;
export const CROUCH_H = 1.2;
export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.05;
const GRAVITY = 22;
const bkey = (b: Box) => `${b.x0},${b.y0},${b.z0},${b.x1},${b.y1},${b.z1}`;
const JUMP_V = 7.6;
const STEP = 0.55;

export interface InputState {
  fwd: number; // -1..1
  right: number; // -1..1
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
}

const WALK = 5.2, SPRINT = 10.5, SNEAK = 2.4, CLIMB = 3.6;
const outsideFootprint = (x: number, z: number) => x < 0 || z < 0 || x > SIZE || z > SIZE;

export class Player {
  x = 0; y = 0; z = 0;
  vx = 0; vy = 0; vz = 0;
  yaw = 0; pitch = 0;
  onGround = false;
  crouching = false;
  eye = EYE_STAND;
  eyeSmoothY = 0;
  moving = false;
  bounced = 0; // timestamp of last bounce, for sfx
  landed = 0;
  sprinting = false;
  climbing = false; // pressed against a climbable surface (facade tendons from outside, mushroom stems)
  climbMoved = 0; // metres climbed, for the sinew creak
  dead = false;
  private prevJump = false;
  ws: WorldState;

  constructor(ws: WorldState, seed: number) {
    this.ws = ws;
    this.respawn(seed);
  }

  respawn(seed = Math.floor(Math.random() * 1000)) {
    const s = spawnPoint(seed);
    this.x = s.x; this.y = s.y; this.z = s.z;
    this.vx = this.vy = this.vz = 0;
    this.dead = false;
    this.yaw = Math.random() * Math.PI * 2;
    this.eyeSmoothY = this.y + EYE_STAND;
  }

  get height() { return this.crouching ? CROUCH_H : STAND_H; }

  private overlaps(x: number, y: number, z: number, h: number, ignore?: Set<string>): Box[] {
    const bs = boxesIn(x - HALF_W, y, z - HALF_W, x + HALF_W, y + h, z + HALF_W, this.ws);
    const eps = 1e-4;
    return bs.filter((b) => !(ignore && ignore.has(bkey(b))) && b.x1 > x - HALF_W + eps && b.x0 < x + HALF_W - eps && b.y1 > y + eps && b.y0 < y + h - eps && b.z1 > z - HALF_W + eps && b.z0 < z + HALF_W - eps);
  }

  /** a climbable box right in front of us (in the direction we push), or null */
  private climbable(wx: number, wz: number): Box | null {
    const l = Math.hypot(wx, wz);
    if (l < 0.1) return null;
    const px = this.x + (wx / l) * 0.12, pz = this.z + (wz / l) * 0.12;
    const out = outsideFootprint(this.x, this.z);
    const bs = boxesIn(px - HALF_W, this.y + 0.1, pz - HALF_W, px + HALF_W, this.y + this.height - 0.2, pz + HALF_W, this.ws);
    for (const b of bs) {
      if (b.climb === 'stem') return b;
      if (b.climb === 'facade' && out) return b;
    }
    return null;
  }

  update(dt: number, inp: InputState) {
    if (this.dead) return;
    // crouch (check head room when standing up)
    const tuck = STAND_H - CROUCH_H;
    if (inp.crouch && !this.crouching) {
      this.crouching = true;
      // in the air you tuck your legs up: the head stays where it was, the feet rise
      if (!this.onGround && this.overlaps(this.x, this.y + tuck, this.z, CROUCH_H).length === 0) { this.y += tuck; this.eye -= tuck; }
    } else if (!inp.crouch && this.crouching) {
      if (this.overlaps(this.x, this.y, this.z, STAND_H).length === 0) this.crouching = false;
      else if (!this.onGround && this.overlaps(this.x, this.y - tuck, this.z, STAND_H).length === 0) { this.y -= tuck; this.eye += tuck; this.crouching = false; }
    }

    this.sprinting = inp.sprint && !this.crouching && inp.fwd > 0.3;
    const speed = this.crouching ? SNEAK : this.sprinting ? SPRINT : WALK;
    let wf = inp.fwd, wr = inp.right;
    const len = Math.hypot(wf, wr);
    if (len > 1) { wf /= len; wr /= len; }
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward = (-sin, -cos) in xz (three.js camera looks down -z at yaw 0)
    const wx = (-sin * wf + cos * wr) * speed;
    const wz = (-cos * wf - sin * wr) * speed;
    // climbing: hold forward against tendons/stems to go up; let go and you slowly slide
    const grip = inp.fwd > 0.3 ? this.climbable(wx, wz) : null;
    const wasClimbing = this.climbing;
    this.climbing = !!grip;
    const accel = this.onGround || this.climbing ? 14 : 3;
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (wx - this.vx) * k;
    this.vz += (wz - this.vz) * k;
    this.moving = Math.hypot(this.vx, this.vz) > 0.6;

    if (this.climbing) {
      if (inp.jump && !this.prevJump && !this.onGround) { // push off the wall (fresh press only)
        const l = Math.hypot(wx, wz) || 1;
        this.vx = -(wx / l) * 5; this.vz = -(wz / l) * 5; this.vy = 6;
        this.climbing = false;
      } else {
        this.vy = CLIMB * (this.crouching ? 0.5 : 1);
        this.climbMoved += this.vy * dt;
        this.onGround = false;
      }
    } else if (wasClimbing && this.vy > 0 && inp.fwd > 0.3) {
      // reached the top edge: a small hop over the lip
      this.vy = 4.2;
    }
    if (inp.jump && this.onGround && !this.climbing) {
      this.vy = JUMP_V;
      this.onGround = false;
    }
    if (!this.climbing) this.vy -= GRAVITY * dt;
    this.prevJump = inp.jump;
    if (this.vy < -TERMINAL_V) this.vy = -TERMINAL_V;

    // boxes we are already stuck in (e.g. a door closed on us) are ignored
    const stuck = new Set(this.overlaps(this.x, this.y, this.z, this.height).map(bkey));

    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(this.vx), Math.abs(this.vy), Math.abs(this.vz)) * dt / 0.25));
    const h = dt / steps;
    const wasGround = this.onGround;
    this.onGround = false;
    for (let i = 0; i < steps; i++) {
      this.moveAxis('x', this.vx * h, wasGround, stuck);
      this.moveAxis('z', this.vz * h, wasGround, stuck);
      this.moveAxis('y', this.vy * h, wasGround, stuck);
    }

    // stick to the ground when walking down steps
    if (wasGround && !this.onGround && this.vy <= 0 && !inp.jump) {
      const below = this.overlaps(this.x, this.y - STEP, this.z, STEP, stuck);
      if (below.length) {
        let top = -Infinity;
        for (const b of below) top = Math.max(top, b.y1);
        if (top <= this.y + 1e-3 && !below.some((b) => b.bounce)) { this.y = top; this.vy = 0; this.onGround = true; }
      }
    }

    // no invisible walls: past the island edge there is only the void
    if (this.y < DEATH_Y) { this.dead = true; return; }

    // smooth eye (steps / crouch)
    const targetEye = this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 12);
    const ey = this.y + this.eye;
    if (Math.abs(ey - this.eyeSmoothY) > 1.2) this.eyeSmoothY = ey;
    else this.eyeSmoothY += (ey - this.eyeSmoothY) * Math.min(1, dt * 18);
  }

  private moveAxis(axis: 'x' | 'y' | 'z', d: number, wasGround: boolean, stuck: Set<string>) {
    if (d === 0) return;
    const h = this.height;
    if (axis === 'x') this.x += d; else if (axis === 'y') this.y += d; else this.z += d;
    const hits = this.overlaps(this.x, this.y, this.z, h, stuck);
    if (!hits.length) return;
    if (axis === 'y') {
      if (d < 0) {
        let top = -Infinity, bounce = 0;
        for (const b of hits) if (b.y1 > top) { top = b.y1; bounce = b.bounce || 0; }
        this.y = top;
        if (bounce && this.vy < -1 && !this.crouching) {
          this.vy = bounce;
          this.bounced = performance.now();
        } else {
          if (this.vy < -9) this.landed = performance.now();
          this.vy = 0;
          this.onGround = true;
        }
      } else {
        let bottom = Infinity;
        for (const b of hits) bottom = Math.min(bottom, b.y0);
        this.y = bottom - h;
        this.vy = 0;
      }
      return;
    }
    // horizontal: try step-up (on the ground, or catching a ledge in the air while not rising fast)
    if (wasGround || this.vy < 2.5) {
      let top = -Infinity;
      for (const b of hits) top = Math.max(top, b.y1);
      const rise = top - this.y;
      if (rise > 0 && rise <= STEP) {
        if (this.overlaps(this.x, top + 0.001, this.z, h, stuck).length === 0) { this.y = top + 0.001; return; }
        // a low opening above the ledge (a window): duck into it
        if (!this.crouching && this.overlaps(this.x, top + 0.001, this.z, CROUCH_H, stuck).length === 0) { this.y = top + 0.001; this.crouching = true; return; }
      }
    }
    // only the head is blocked (lintel, window top): duck automatically, stand up again when there is room
    if (!this.crouching && this.overlaps(this.x, this.y, this.z, CROUCH_H, stuck).length === 0) { this.crouching = true; return; }
    const p = axis === 'x' ? this.x : this.z;
    let fix = p;
    for (const b of hits) {
      if (axis === 'x') fix = d > 0 ? Math.min(fix, b.x0 - HALF_W - 1e-4) : Math.max(fix, b.x1 + HALF_W + 1e-4);
      else fix = d > 0 ? Math.min(fix, b.z0 - HALF_W - 1e-4) : Math.max(fix, b.z1 + HALF_W + 1e-4);
    }
    if (axis === 'x') { this.x = fix; this.vx = 0; } else { this.z = fix; this.vz = 0; }
  }
}
