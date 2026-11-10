import * as THREE from 'three';

// The organism dreams the real sky above Minsk (UTC+3, no DST): a moonlit night with the real moon phase,
// and a dawn around the real sunrise. Both are dim — the place is lit mostly by living tissue.
// Every client computes the same thing from the clock, so the sky is in sync for everyone.

const LAT = 53.9 * Math.PI / 180, LON = 27.56;
const TZ = 3;
const MOON_DIR = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - 0.62, 3.9); // ~35° high
const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - 0.05, Math.PI / 2); // low in the east

/** hours of local Minsk sunrise for a given date */
export function minskSunrise(d: Date) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const N = Math.floor((d.getTime() - start) / 864e5);
  const decl = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + N) / 365);
  const cosH = (Math.sin(-0.833 * Math.PI / 180) - Math.sin(LAT) * Math.sin(decl)) / (Math.cos(LAT) * Math.cos(decl));
  const H = Math.acos(Math.max(-1, Math.min(1, cosH))) * 180 / Math.PI / 15;
  const B = 2 * Math.PI * (N - 81) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B); // equation of time, minutes
  const noon = 12 + (TZ * 15 - LON) / 15 - eot / 60;
  return noon - H;
}

/** 0 = moon night, 1 = dawn ; plus the moon phase 0..1 (0 new, 0.5 full) */
export function skyState(now = new Date()) {
  const h = ((now.getUTCHours() + TZ) % 24) + now.getUTCMinutes() / 60;
  const rise = minskSunrise(now);
  const a = rise - 1.5, b = rise + 3, fade = 0.5;
  const dawn = Math.min(Math.max(0, Math.min(1, (h - a) / fade)), Math.max(0, Math.min(1, (b - h) / fade)));
  const phase = (((now.getTime() - Date.UTC(2000, 0, 6, 18, 14)) / 864e5) % 29.530588) / 29.530588;
  return { dawn, phase, minskHour: h, sunrise: rise };
}

export class Sky {
  mesh: THREE.Mesh;
  uniforms = {
    uDawn: { value: 0 },
    uPhase: { value: 0.5 },
    uMoon: { value: MOON_DIR.clone() },
    uSun: { value: SUN_DIR.clone() },
    uTime: { value: 0 },
  };
  hemi: THREE.HemisphereLight;
  key: THREE.DirectionalLight;
  fog: THREE.Fog;
  state = skyState();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uDawn, uPhase, uTime; uniform vec3 uMoon, uSun;
        varying vec3 vDir;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float e = d.y;
          // night: deep indigo, violet horizon
          vec3 night = mix(vec3(0.10, 0.07, 0.20), vec3(0.015, 0.012, 0.05), smoothstep(0.0, 0.7, e));
          // dawn: rose-amber horizon under a violet sky
          vec3 dawnC = mix(vec3(0.85, 0.42, 0.36), vec3(0.20, 0.13, 0.30), smoothstep(-0.02, 0.45, e));
          float sunGlow = pow(max(0.0, dot(d, normalize(uSun))), 6.0);
          dawnC += vec3(1.0, 0.55, 0.25) * sunGlow * 0.8;
          vec3 col = mix(night, dawnC, uDawn);
          // the void below the island
          col = mix(col, vec3(0.02, 0.0, 0.04), smoothstep(0.02, -0.35, e));
          // stars (night only), pixel-sized
          vec2 sp = floor(vec2(atan(d.z, d.x), asin(d.y)) * 260.0);
          float star = step(0.9965, h(sp)) * smoothstep(0.05, 0.3, e) * (0.6 + 0.4 * sin(uTime * 2.0 + h(sp) * 40.0));
          col += star * (1.0 - uDawn * 0.85) * vec3(0.9, 0.9, 1.0);
          // the moon with its real phase
          vec3 m = normalize(uMoon);
          float md = acos(clamp(dot(d, m), -1.0, 1.0));
          float R = 0.045;
          if (md < R * 4.0) col += vec3(0.5, 0.55, 0.8) * pow(1.0 - md / (R * 4.0), 3.0) * 0.25 * (1.0 - uDawn * 0.6);
          if (md < R) {
            vec3 up = vec3(0.0, 1.0, 0.0);
            vec3 tx = normalize(cross(up, m)); vec3 ty = cross(m, tx);
            vec2 p = vec2(dot(d - m, tx), dot(d - m, ty)) / R; // -1..1 on the disc
            p = floor(p * 10.0) / 10.0; // pixel moon
            // terminator: waxing lights the right side, waning the left
            float cut = cos(uPhase * 6.2831853) * sqrt(max(0.0, 1.0 - p.y * p.y));
            float lit = uPhase < 0.5 ? step(cut, p.x) : step(p.x, -cut);
            lit *= step(dot(p, p), 1.0);
            float crater = 0.85 + 0.15 * h(floor(p * 5.0));
            col = mix(col, vec3(0.92, 0.92, 0.84) * crater, lit * (1.0 - uDawn * 0.4));
            col = mix(col, col + vec3(0.03, 0.03, 0.05), 1.0 - lit);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    }));
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
    this.hemi = new THREE.HemisphereLight(0x8a90c0, 0x3a2a40, 0.9);
    this.key = new THREE.DirectionalLight(0xaab8ff, 0.6);
    scene.add(this.hemi, this.key);
    this.fog = new THREE.Fog(0x1a1430, 18, 95);
    scene.fog = this.fog;
    this.apply();
    setInterval(() => { this.state = skyState(); this.apply(); }, 30000);
  }

  apply() {
    const { dawn, phase } = this.state;
    this.uniforms.uDawn.value = dawn;
    this.uniforms.uPhase.value = phase;
    const moonLight = 0.2 + 0.4 * (1 - Math.abs(phase - 0.5) * 2); // a full moon lights more than a new one
    const night = { sky: new THREE.Color(0x6a70a8), ground: new THREE.Color(0x2a2036), hemi: 0.42, key: new THREE.Color(0xa8b8ff), keyI: moonLight, fog: new THREE.Color(0x140f26), far: 85 };
    const day = { sky: new THREE.Color(0xc8a0c0), ground: new THREE.Color(0x4a3040), hemi: 0.75, key: new THREE.Color(0xffb27a), keyI: 0.75, fog: new THREE.Color(0x4a2c48), far: 110 };
    this.hemi.color.copy(night.sky).lerp(day.sky, dawn);
    this.hemi.groundColor.copy(night.ground).lerp(day.ground, dawn);
    this.hemi.intensity = night.hemi + (day.hemi - night.hemi) * dawn;
    this.key.color.copy(night.key).lerp(day.key, dawn);
    this.key.intensity = night.keyI + (day.keyI - night.keyI) * dawn;
    const dir = MOON_DIR.clone().lerp(SUN_DIR, dawn).normalize();
    this.key.position.copy(dir).multiplyScalar(100);
    this.fog.color.copy(night.fog).lerp(day.fog, dawn);
    this.fog.far = night.far + (day.far - night.far) * dawn;
  }

  update(cam: THREE.Vector3, t: number) {
    this.mesh.position.copy(cam);
    this.uniforms.uTime.value = t;
  }

  label() {
    const { dawn, phase, sunrise } = this.state;
    const names = ['новолуние', 'растущая луна', 'первая четверть', 'растущая луна', 'полнолуние', 'убывающая луна', 'последняя четверть', 'убывающая луна'];
    const moon = names[Math.round(phase * 8) % 8];
    const hh = Math.floor(sunrise), mm = Math.round((sunrise - hh) * 60);
    return dawn > 0.5 ? `рассвет над Минском · восход ${hh}:${String(mm).padStart(2, '0')}` : `ночь над Минском · ${moon}`;
  }
}
