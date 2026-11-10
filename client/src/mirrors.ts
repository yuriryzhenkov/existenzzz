import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { FLOOR_H, MIRRORS, PANEL_BY_ID } from '../../shared/world';
import { boneTex } from './textures';

// Dance-class mirrors (see docs/MATERIALS.md). A live reflection is expensive (it renders the scene a
// second time), so only mirrors close to you on your floor are "live"; the rest show a static silvered pane.

const LIVE_DIST = 14;

interface MirrorView { reflector: Reflector; center: THREE.Vector3; level: number; normal: THREE.Vector3 }

export class Mirrors {
  views: MirrorView[] = [];

  constructor(scene: THREE.Scene, mobile: boolean, onReflect: (on: boolean) => void) {
    const frameMat = new THREE.MeshLambertMaterial({ map: boneTex() });
    const backMat = new THREE.MeshLambertMaterial({ color: 0x8e959c }); // silvered glass seen from afar
    const tw = mobile ? 320 : 640;
    for (const m of MIRRORS) {
      const p = PANEL_BY_ID.get(m.panel)!;
      const w = m.u1 - m.u0, h = m.v1 - m.v0;
      const uc = (m.u0 + m.u1) / 2, vc = (m.v0 + m.v1) / 2;
      const center = new THREE.Vector3(p.ox + p.ux * uc, p.oy + vc, p.oz + p.uz * uc);
      const normal = new THREE.Vector3(p.nx, 0, p.nz);
      const rotY = Math.atan2(p.nx, p.nz);

      const group = new THREE.Group();
      group.position.copy(center);
      group.rotation.y = rotY;
      // oak frame: 6cm profile, protruding 4cm from the wall
      const f = 0.06, d = 0.04;
      const bar = (bw: number, bh: number, x: number, y: number) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, d), frameMat);
        mesh.position.set(x, y, d / 2);
        group.add(mesh);
      };
      bar(w + f * 2, f, 0, h / 2 + f / 2); bar(w + f * 2, f, 0, -h / 2 - f / 2);
      bar(f, h, -w / 2 - f / 2, 0); bar(f, h, w / 2 + f / 2, 0);
      const back = new THREE.Mesh(new THREE.PlaneGeometry(w, h), backMat);
      back.position.z = 0.01;
      group.add(back);

      const reflector = new Reflector(new THREE.PlaneGeometry(w, h), {
        textureWidth: tw,
        textureHeight: Math.round(tw * (h / w)),
        color: 0xc8ccd0, // real mirrors are slightly grey-green, never perfectly white
        clipBias: 0.003,
        multisample: mobile ? 0 : 4,
      });
      reflector.position.z = 0.02;
      const orig = reflector.onBeforeRender;
      reflector.onBeforeRender = function (...args: Parameters<typeof orig>) {
        onReflect(true);
        orig.apply(this, args);
        onReflect(false);
      };
      group.add(reflector);
      scene.add(group);
      this.views.push({ reflector, center, level: m.level, normal });
    }
  }

  update(cam: THREE.Vector3) {
    for (const v of this.views) {
      const dx = cam.x - v.center.x, dz = cam.z - v.center.z;
      const inFront = dx * v.normal.x + dz * v.normal.z > 0.1;
      const sameFloor = Math.abs(cam.y - (v.level * FLOOR_H + 1.6)) < 3;
      v.reflector.visible = inFront && sameFloor && Math.hypot(dx, cam.y - v.center.y, dz) < LIVE_DIST;
    }
  }
}
