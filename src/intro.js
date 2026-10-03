import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { startQuotes } from './quotes.js';

const COUNT = 9000;
const HOLD = 5.5; // seconds a shape rests
const MORPH = 3.2; // seconds a transition takes
const SHAPES = 3;
const BOOK = 1; // index of the open-book shape
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- Target shapes (one position per particle) ----------

/** A globe: knowledge as a world. */
function sphere(i, out) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (i / (COUNT - 1)) * 2;
  const r = Math.sqrt(1 - y * y);
  const t = golden * i;
  const R = 2.1 + rand(-0.04, 0.04);
  return out.set(Math.cos(t) * r * R, y * R, Math.sin(t) * r * R);
}

/** An open book: two curved pages whose points line up like rows of text, plus a page mid-turn. */
function openBook(i, out) {
  const W = 2.0;
  const H = 2.7;
  const k = Math.random();
  if (k < 0.12) {
    // The turning page.
    const u = Math.random();
    const v = rand(-0.5, 0.5);
    const a = 1.25 - u * 0.35;
    return out.set(Math.cos(a) * u * W * 0.98, v * H, Math.sin(a) * u * W * 0.9 + 0.3);
  }
  const side = Math.random() < 0.5 ? -1 : 1;
  const u = Math.random();
  // Rows of "text" with gaps, or scattered paper grain at the edges.
  const rows = 17;
  const v = k < 0.85 ? (Math.floor(Math.random() * rows) + 0.5) / rows - 0.5 + rand(-0.003, 0.003) : rand(-0.5, 0.5);
  const lift = 0.32 * Math.sin(Math.min(u * 2.2, 1) * Math.PI * 0.5) - 0.06 * u;
  const margin = 0.08 + 0.84 * u;
  return out.set(side * margin * W, v * H * 0.92, lift);
}

/** A spiral galaxy: ideas orbiting a bright core. */
function galaxy(i, out) {
  const arms = 3;
  const r = Math.pow(Math.random(), 0.7) * 3.1;
  const arm = (i % arms) * ((Math.PI * 2) / arms);
  const a = arm + r * 1.35 + rand(-0.35, 0.35) / (0.6 + r);
  const thickness = 0.12 * (1 - r / 3.4);
  return out.set(Math.cos(a) * r, rand(-thickness, thickness), Math.sin(a) * r);
}

// ---------- Shaders ----------

const vertexShader = /* glsl */ `
  attribute vec3 aSphere;
  attribute vec3 aBook;
  attribute vec3 aGalaxy;
  attribute float aSeed;

  uniform float uTime;
  uniform float uFrom;
  uniform float uTo;
  uniform float uT;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec2 uPointer;
  uniform float uDim;

  varying float vAlpha;
  varying float vAccent;

  vec3 shape(float i) {
    if (i < 0.5) return aSphere;
    if (i < 1.5) return aBook;
    return aGalaxy;
  }

  void main() {
    // Each particle starts its journey slightly later than the last, so shapes dissolve in waves.
    float t = clamp(uT * 1.7 - aSeed * 0.7, 0.0, 1.0);
    float e = t * t * (3.0 - 2.0 * t);
    vec3 a = shape(uFrom);
    vec3 b = shape(uTo);
    vec3 pos = mix(a, b, e);

    // Arc outwards mid-flight.
    vec3 dir = normalize(pos + vec3(0.0001));
    pos += dir * sin(e * 3.14159) * (0.5 + aSeed * 0.9);

    // Gentle breathing.
    float s = aSeed * 61.0;
    pos += 0.02 * vec3(sin(uTime * 0.7 + s), cos(uTime * 0.6 + s * 1.3), sin(uTime * 0.5 + s * 0.7));

    // The pointer gently pushes particles aside.
    vec2 d = pos.xy - uPointer;
    float push = exp(-dot(d, d) * 2.2) * 0.45;
    pos.xy += normalize(d + vec2(0.0001)) * push;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.55 + fract(s * 3.1)) / -mv.z;

    vAccent = step(0.94, aSeed);
    vAlpha = (0.18 + 0.5 * fract(s * 7.7)) * uDim;
  }
`;

const fragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vAccent;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    vec3 bone = vec3(0.93, 0.9, 0.84);
    vec3 crimson = vec3(1.0, 0.16, 0.24) * 1.6;
    gl_FragColor = vec4(mix(bone, crimson, vAccent), a);
  }
`;

const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float d = length(vUv - 0.5);
      col *= mix(0.25, 1.0, smoothstep(0.85, 0.2, d));
      col += (hash(vUv * 1000.0 + fract(uTime) * 91.7) - 0.5) * 0.05;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

/** Minimal home scene: a cloud of particles that morphs between a globe, an open book and a galaxy. */
export function createIntro(renderer, canvas) {
  let enabled = true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060607);
  const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(0, 0, 9);

  // ---------- Particles ----------
  const sphereArr = new Float32Array(COUNT * 3);
  const bookArr = new Float32Array(COUNT * 3);
  const galaxyArr = new Float32Array(COUNT * 3);
  const seeds = new Float32Array(COUNT);
  const v = new THREE.Vector3();
  for (let i = 0; i < COUNT; i++) {
    sphere(i, v).toArray(sphereArr, i * 3);
    openBook(i, v).toArray(bookArr, i * 3);
    galaxy(i, v).toArray(galaxyArr, i * 3);
    seeds[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(sphereArr, 3));
  geo.setAttribute('aSphere', new THREE.BufferAttribute(sphereArr, 3));
  geo.setAttribute('aBook', new THREE.BufferAttribute(bookArr, 3));
  geo.setAttribute('aGalaxy', new THREE.BufferAttribute(galaxyArr, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uFrom: { value: 0 },
    uTo: { value: 1 },
    uT: { value: 0 },
    uSize: { value: 24 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uPointer: { value: new THREE.Vector2(99, 99) },
    uDim: { value: 1 },
  };
  const points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  points.frustumCulled = false;

  // The holder lets the cloud slide aside when the library is open.
  const holder = new THREE.Group();
  holder.add(points);
  scene.add(holder);

  // Faint orbit line for a touch of structure.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(3.45, 3.46, 256),
    new THREE.MeshBasicMaterial({ color: 0xe8e2d4, transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
  );
  ring.rotation.x = Math.PI / 2.3;
  holder.add(ring);

  // ---------- Post ----------
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.4, 0.45, 0.35));
  composer.addPass(new OutputPass());
  const film = new ShaderPass(FilmShader);
  composer.addPass(film);

  // ---------- Interaction ----------
  const pointerNdc = new THREE.Vector2(9, 9);
  const raycaster = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  const hit = new THREE.Vector3();
  const parallax = new THREE.Vector2();
  const tmp = new THREE.Vector2();

  window.addEventListener('pointermove', (e) => {
    pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  });

  startQuotes();

  // ---------- Morph timeline ----------
  let shapeIndex = 0;
  let clock = 0;
  let mode = 'home'; // 'home' | 'library' | 'immersive'
  const holderTarget = new THREE.Vector3();

  return {
    setEnabled(value) {
      enabled = value;
    },

    /** 'home' sits beside the text, 'immersive' fills the screen, 'library' dims it into a backdrop. */
    setMode(value) {
      mode = value;
    },

    resize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      composer.setSize(window.innerWidth, window.innerHeight);
      uniforms.uPixelRatio.value = renderer.getPixelRatio();
    },

    update(dt, t) {
      uniforms.uTime.value = t;
      film.uniforms.uTime.value = t;

      clock += dt;
      if (clock > HOLD + MORPH) {
        clock = 0;
        shapeIndex = (shapeIndex + 1) % SHAPES;
      }
      uniforms.uFrom.value = shapeIndex;
      uniforms.uTo.value = (shapeIndex + 1) % SHAPES;
      uniforms.uT.value = Math.max(0, (clock - HOLD) / MORPH);

      const library = mode === 'library';
      if (library) holderTarget.set(3.2, -0.4, -3);
      else if (mode === 'immersive') holderTarget.set(0, 0, 1.2);
      else if (window.innerWidth > 900) holderTarget.set(1.6, 0, 0);
      else holderTarget.set(0, 1.6, -1.5); // phones: above the text
      holder.position.lerp(holderTarget, 1 - Math.exp(-dt * 2));
      uniforms.uDim.value += ((library ? 0.35 : 1) - uniforms.uDim.value) * (1 - Math.exp(-dt * 3));

      // Spin slowly, but while the open book is formed turn it to face the viewer so its "lines" read.
      const k = uniforms.uT.value;
      const e = k * k * (3 - 2 * k);
      const bookness = uniforms.uFrom.value === BOOK ? 1 - e : uniforms.uTo.value === BOOK ? e : 0;
      if (bookness > 0.5) {
        const facing = Math.ceil((points.rotation.y - 0.3) / TAU) * TAU + Math.sin(t * 0.4) * 0.3;
        points.rotation.y += (facing - points.rotation.y) * (1 - Math.exp(-dt * 1.5));
      } else {
        points.rotation.y += dt * 0.08;
      }
      const tilt = bookness > 0.5 ? -0.15 : Math.sin(t * 0.15) * 0.15 + 0.2;
      points.rotation.x += (tilt - points.rotation.x) * (1 - Math.exp(-dt * 1.5));
      ring.rotation.z += dt * 0.03;

      // Pointer in the particles' local space (on their z = 0 plane).
      raycaster.setFromCamera(pointerNdc, camera);
      plane.constant = -holder.position.z;
      if (enabled && raycaster.ray.intersectPlane(plane, hit)) {
        points.worldToLocal(hit);
        uniforms.uPointer.value.set(hit.x, hit.y);
      } else {
        uniforms.uPointer.value.set(99, 99);
      }

      parallax.lerp(tmp.copy(pointerNdc).clampScalar(-1, 1), 1 - Math.exp(-dt * 2));
      // Portrait screens are narrow: step back so the cloud still fits.
      const z = camera.aspect < 1 ? 9 + (1 - camera.aspect) * 7 : 9;
      camera.position.set(parallax.x * 0.4, parallax.y * 0.3, z);
      camera.lookAt(0, 0, 0);
    },

    render() {
      composer.render();
    },
  };
}
