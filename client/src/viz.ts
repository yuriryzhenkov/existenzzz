import * as THREE from 'three';
import { CENTER } from '../../shared/world';

// A pixelated "mycelium mandala" floating high above the atrium. It only updates when it is
// actually rendered (onBeforeRender), so it costs nothing unless you look up.

const BINS = 64;

export class Visualizer {
  mesh: THREE.Mesh;
  private data = new Uint8Array(BINS * 4);
  private tex: THREE.DataTexture;
  private fft = new Uint8Array(128) as Uint8Array<ArrayBuffer>;
  private smooth = new Float32Array(BINS);
  private uniforms: Record<string, THREE.IUniform>;

  constructor(scene: THREE.Scene, getSpectrum: (buf: Uint8Array<ArrayBuffer>) => Uint8Array | null, getLevel: () => number) {
    this.tex = new THREE.DataTexture(this.data, BINS, 1, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.uniforms = {
      uFFT: { value: this.tex },
      uTime: { value: 0 },
      uLevel: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform sampler2D uFFT;
        uniform float uTime;
        uniform float uLevel;
        varying vec2 vUv;
        vec3 hsv(float h, float s, float v) {
          vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return v * mix(vec3(1.0), k, s);
        }
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        void main() {
          // pixelate
          vec2 uv = (floor(vUv * 112.0) + 0.5) / 112.0;
          vec2 p = uv * 2.0 - 1.0;
          float r = length(p);
          if (r > 1.0) discard;
          float a = atan(p.y, p.x);
          float petals = 7.0;
          float sym = abs(fract(a / 6.28318 * petals + uTime * 0.01) - 0.5) * 2.0;
          float f = texture2D(uFFT, vec2(r * 0.85 + 0.02, 0.5)).r;
          float g = texture2D(uFFT, vec2(sym * 0.6 + 0.05, 0.5)).r;
          // rings driven by spectrum
          float ring = smoothstep(0.08, 0.0, abs(fract(r * 6.0 - uTime * 0.05) - 0.5) - f * 0.35);
          // mycelium threads
          float threads = smoothstep(0.92 - g * 0.3, 1.0, sin(a * petals * 2.0 + r * 18.0 * (1.0 + f) - uTime * 0.3) * 0.5 + 0.5);
          float spores = step(0.985 - f * 0.05, hash(floor(uv * 112.0) + floor(uTime * 2.0)));
          float edge = smoothstep(1.0, 0.75, r);
          float hue = fract(0.75 + r * 0.35 + uTime * 0.01 + f * 0.2);
          vec3 col = hsv(hue, 0.65, 1.0) * (ring * (0.25 + f) + threads * (0.15 + g * 0.8)) + vec3(1.0, 0.95, 0.85) * spores * 0.6;
          col *= edge * (0.35 + uLevel * 0.9);
          float core = smoothstep(0.25, 0.0, r) * (0.2 + f * 0.6);
          col += hsv(fract(uTime * 0.02), 0.4, 1.0) * core * 0.4;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.CircleGeometry(15, 48), mat);
    this.mesh.rotation.x = Math.PI / 2; // facing down
    this.mesh.position.set(CENTER, 26, CENTER);
    this.mesh.renderOrder = 5;
    this.mesh.onBeforeRender = () => {
      const s = getSpectrum(this.fft);
      for (let i = 0; i < BINS; i++) {
        const v = s ? s[Math.floor(i * 1.4)] / 255 : 0.15 + 0.1 * Math.sin(performance.now() / 2000 + i * 0.3);
        this.smooth[i] += (v - this.smooth[i]) * 0.25;
        this.data[i * 4] = this.smooth[i] * 255;
      }
      this.tex.needsUpdate = true;
      this.uniforms.uTime.value = performance.now() / 1000;
      this.uniforms.uLevel.value = s ? 0.4 + getLevel() : 0.25;
    };
    scene.add(this.mesh);
  }
}
