import * as THREE from 'three';

// "Living tissue": a patch for Lambert materials. Every surface knows where the nearest people are
// (shared uniforms, updated once per frame) and answers: veins light up and pulse with the heartbeat,
// a halo of light follows people, ripples spread from them, nacre shimmers with the view angle.
// All procedural in world space and quantized to the 16px/m grid so it stays pixel art.

export const MAX_PEOPLE = 8;

export const LIFE = {
  uPeople: { value: Array.from({ length: MAX_PEOPLE }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uTime: { value: 0 },
  uBeat: { value: 0 }, // 0..1 heartbeat envelope
  uWound: { value: 0 },
};

export interface LifeOpts {
  veins?: number; // amount of glowing veins
  veinColor?: THREE.ColorRepresentation;
  veinScale?: number; // vein pattern size (bigger = wider apart)
  halo?: number; // glow around people
  haloColor?: THREE.ColorRepresentation;
  reach?: number; // metres of reaction
  ripple?: number; // rings spreading from people (floors)
  iridescence?: number; // nacre / scales shimmer
  base?: number; // constant self-glow (dark scene readability)
}

export function living(mat: THREE.MeshLambertMaterial, o: LifeOpts) {
  const u = {
    uVeins: { value: o.veins ?? 0 },
    uVeinColor: { value: new THREE.Color(o.veinColor ?? 0xff6fae) },
    uVeinScale: { value: o.veinScale ?? 1 },
    uHalo: { value: o.halo ?? 0 },
    uHaloColor: { value: new THREE.Color(o.haloColor ?? 0x9fe8ff) },
    uReach: { value: o.reach ?? 4 },
    uRipple: { value: o.ripple ?? 0 },
    uIri: { value: o.iridescence ?? 0 },
    uBase: { value: o.base ?? 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, LIFE, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLifePos;\nvarying vec3 vLifeNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLifePos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvLifeNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vLifePos;
varying vec3 vLifeNrm;
uniform vec4 uPeople[${MAX_PEOPLE}];
uniform float uTime, uBeat, uVeins, uVeinScale, uHalo, uReach, uRipple, uIri, uBase;
uniform vec3 uVeinColor, uHaloColor;
float lhash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(lhash(i), lhash(i + vec2(1.0, 0.0)), f.x), mix(lhash(i + vec2(0.0, 1.0)), lhash(i + vec2(1.0, 1.0)), f.x), f.y);
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 an = abs(vLifeNrm);
  vec2 q = an.y > 0.5 ? vLifePos.xz : (an.x > 0.5 ? vLifePos.zy : vLifePos.xy);
  q = (floor(q * 16.0) + 0.5) / 16.0; // pixel grid
  vec3 wp = vec3(floor(vLifePos * 16.0) + 0.5) / 16.0;
  float near = 0.0, ring = 0.0;
  for (int i = 0; i < ${MAX_PEOPLE}; i++) {
    vec4 p = uPeople[i];
    if (p.w <= 0.0) continue;
    float d = distance(wp, p.xyz);
    near = max(near, p.w * smoothstep(uReach, 0.0, d));
    ring += p.w * smoothstep(0.12, 0.0, abs(fract(d * 0.7 - uTime * 0.6) - 0.5) - 0.38) * smoothstep(uReach * 1.3, 0.3, d);
  }
  float n = lnoise(q * 1.7 / uVeinScale) * 0.65 + lnoise(q * 4.1 / uVeinScale) * 0.35;
  float vein = smoothstep(0.035, 0.0, abs(n - 0.5));
  float pulse = 0.55 + 0.45 * uBeat;
  vec3 life = uVeinColor * vein * uVeins * (0.07 + 0.05 * uBeat + near * 1.5 * pulse);
  life += uHaloColor * uHalo * (near * near * 0.28 + ring * 0.2 * uRipple);
  if (uIri > 0.0) {
    float f = dot(normalize(cameraPosition - vLifePos), vLifeNrm);
    vec3 iri = 0.5 + 0.5 * cos(6.2831 * (f * 0.9 + lnoise(q * 0.6) * 0.5 + vec3(0.0, 0.33, 0.67)));
    life += iri * diffuseColor.rgb * uIri * (0.25 + near * 1.2);
  }
  totalEmissiveRadiance += life + diffuseColor.rgb * uBase;
}`);
  };
  mat.customProgramCacheKey = () => 'living' + Object.values(o).join(',');
  return mat;
}

/** heartbeat: two soft thumps per beat (lub-dub) */
export function heartbeat(t: number, bpm: number) {
  const ph = (t * bpm) / 60 % 1;
  return Math.exp(-ph * 14) + 0.6 * Math.exp(-Math.max(0, ph - 0.22) * 16) * (ph > 0.22 ? 1 : 0);
}
