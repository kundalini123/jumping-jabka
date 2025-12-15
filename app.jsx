const { useEffect, useMemo, useRef, useState } = React;
const THREE = window.THREE;

/**
 * Симуляция 3D-жабы: прыжки в разные стороны с ограничением поворота до 90° и дрифт после приземления.
 * Запускается как веб-приложение внутри одного React-компонента.
 */

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function lerp(a, b, t) {
  const tt = Number.isFinite(t) ? clamp(t, 0, 1) : 0;
  return a + (b - a) * tt;
}

function smoothstep(edge0, edge1, x) {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function wrapPi(a) {
  if (!Number.isFinite(a)) return 0;
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function lerpAngle(a, b, t) {
  const tt = Number.isFinite(t) ? clamp(t, 0, 1) : 0;
  const d = wrapPi(b - a);
  return a + d * tt;
}

function vec3(x = 0, y = 0, z = 0) {
  return new THREE.Vector3(x, y, z);
}

function hash2i(x, z) {
  let h = (x | 0) ^ 0x9e3779b9;
  h = Math.imul(h, 0x85ebca6b);
  h ^= (z | 0) + 0x7f4a7c15;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function randRange(rng, a, b) {
  return a + (b - a) * rng();
}

function runSelfTests() {
  const eq = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;
  if (!eq(clamp(2, 0, 1), 1)) throw new Error("test: clamp upper");
  if (!eq(clamp(-1, 0, 1), 0)) throw new Error("test: clamp lower");
  if (!eq(clamp(0.5, 0, 1), 0.5)) throw new Error("test: clamp mid");

  if (!eq(lerp(0, 10, 0.5), 5)) throw new Error("test: lerp mid");
  if (!eq(lerp(10, 0, 0.25), 7.5)) throw new Error("test: lerp reverse");
  if (!eq(lerp(3, 3, 0.9), 3)) throw new Error("test: lerp same");
  if (!eq(lerp(0, 10, 2), 10)) throw new Error("test: lerp clamp high");
  if (!eq(lerp(0, 10, -1), 0)) throw new Error("test: lerp clamp low");
  if (!eq(lerp(0, 10, undefined), 0)) throw new Error("test: lerp undefined");
  if (!eq(lerp(0, 10, NaN), 0)) throw new Error("test: lerp NaN");

  if (!eq(smoothstep(0, 1, -1), 0)) throw new Error("test: smoothstep <0");
  if (!eq(smoothstep(0, 1, 2), 1)) throw new Error("test: smoothstep >1");
  if (!eq(smoothstep(0, 1, 0.5), 0.5)) throw new Error("test: smoothstep 0.5");

  if (!eq(wrapPi(Math.PI * 3), Math.PI)) throw new Error("test: wrapPi 3pi");
  if (!eq(wrapPi(-Math.PI * 3), -Math.PI)) throw new Error("test: wrapPi -3pi");
  if (!eq(wrapPi(NaN), 0)) throw new Error("test: wrapPi NaN");
  if (!eq(wrapPi(0), 0)) throw new Error("test: wrapPi 0");

  const a0 = 0;
  const b0 = Math.PI * 1.5;
  const x0 = lerpAngle(a0, b0, 1);
  if (!eq(wrapPi(x0), -Math.PI / 2)) throw new Error("test: lerpAngle wrap");

  const v = vec3(1, 2, 3);
  if (!(v.x === 1 && v.y === 2 && v.z === 3)) throw new Error("test: vec3");
  const z = vec3(1, 0, 0).cross(vec3(0, 1, 0));
  if (!(z.x === 0 && z.y === 0 && z.z === 1)) throw new Error("test: vec3 cross");

  const h = hash2i(12, -7);
  if (!(Number.isInteger(h) && h >= 0)) throw new Error("test: hash2i");
  const rng = makeRng(123);
  const r = rng();
  if (!(r >= 0 && r < 1)) throw new Error("test: rng range");
}

try {
  const dev = typeof process === "undefined" ? true : process?.env?.NODE_ENV !== "production";
  if (dev) runSelfTests();
} catch (e) {
  throw e;
}

function disposeMaterial(mat) {
  if (!mat) return;
  if (Array.isArray(mat)) {
    for (const m of mat) disposeMaterial(m);
    return;
  }
  mat.dispose?.();
}

function App() {
  const mountRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setClearColor(0x0b1c12, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.pointerEvents = "none";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x0b1c12, 34, 260);
    scene.background = new THREE.Color(0x0b1c12);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2500);
    camera.position.set(12.5, 9.5, 12.5);
    camera.up.set(0, 1, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    const hemi = new THREE.HemisphereLight(0xe7f0ff, 0x213326, 1.05);
    const dir = new THREE.DirectionalLight(0xfff7e3, 1.35);
    dir.position.set(10, 18, 6);
    scene.add(ambient, hemi, dir);

    const groundSize = 260;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x11301c, roughness: 1, metalness: 0 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    const frog = new THREE.Group();
    scene.add(frog);

    const frogMat = new THREE.MeshStandardMaterial({ color: 0x2fb34a, roughness: 0.75, metalness: 0.05 });
    const frogDarkMat = new THREE.MeshStandardMaterial({ color: 0x1e7d33, roughness: 0.8, metalness: 0.03 });
    const frogBellyMat = new THREE.MeshStandardMaterial({ color: 0xcbdc9f, roughness: 0.85, metalness: 0.02 });
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.35, metalness: 0.02 });
    const eyePupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, metalness: 0.0 });

    const bodyGeo = new THREE.SphereGeometry(0.65, 20, 16);
    const headGeo = new THREE.SphereGeometry(0.55, 20, 16);
    const bellyGeo = new THREE.SphereGeometry(0.55, 18, 14);
    const eyeGeo = new THREE.SphereGeometry(0.12, 14, 12);
    const pupilGeo = new THREE.SphereGeometry(0.06, 12, 10);
    const limbGeo = new THREE.CapsuleGeometry(0.08, 0.35, 6, 12);
    const footGeo = new THREE.SphereGeometry(0.11, 12, 10);

    const body = new THREE.Mesh(bodyGeo, frogMat);
    body.scale.set(1.15, 0.7, 1.35);
    body.position.set(0, 0.42, 0);

    const head = new THREE.Mesh(headGeo, frogMat);
    head.scale.set(1.05, 0.75, 1.1);
    head.position.set(0, 0.53, 0.62);

    const belly = new THREE.Mesh(bellyGeo, frogBellyMat);
    belly.scale.set(1.08, 0.55, 1.15);
    belly.position.set(0, 0.28, 0.05);
    belly.rotation.x = Math.PI / 2;

    const eyeL = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    const eyeR = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    eyeL.position.set(-0.28, 0.74, 0.95);
    eyeR.position.set(0.28, 0.74, 0.95);

    const pupilL = new THREE.Mesh(pupilGeo, eyePupilMat);
    const pupilR = new THREE.Mesh(pupilGeo, eyePupilMat);
    pupilL.position.set(-0.28, 0.73, 1.03);
    pupilR.position.set(0.28, 0.73, 1.03);

    const frontLegL = new THREE.Mesh(limbGeo, frogDarkMat);
    const frontLegR = new THREE.Mesh(limbGeo, frogDarkMat);
    const backLegL = new THREE.Mesh(limbGeo, frogDarkMat);
    const backLegR = new THREE.Mesh(limbGeo, frogDarkMat);

    frontLegL.position.set(-0.42, 0.22, 0.45);
    frontLegR.position.set(0.42, 0.22, 0.45);
    backLegL.position.set(-0.48, 0.22, -0.35);
    backLegR.position.set(0.48, 0.22, -0.35);

    frontLegL.rotation.set(Math.PI / 2, 0, 0);
    frontLegR.rotation.set(Math.PI / 2, 0, 0);
    backLegL.rotation.set(Math.PI / 2, 0, 0);
    backLegR.rotation.set(Math.PI / 2, 0, 0);

    const footFL = new THREE.Mesh(footGeo, frogDarkMat);
    const footFR = new THREE.Mesh(footGeo, frogDarkMat);
    const footBL = new THREE.Mesh(footGeo, frogDarkMat);
    const footBR = new THREE.Mesh(footGeo, frogDarkMat);

    footFL.position.set(-0.5, 0.11, 0.62);
    footFR.position.set(0.5, 0.11, 0.62);
    footBL.position.set(-0.58, 0.11, -0.55);
    footBR.position.set(0.58, 0.11, -0.55);

    frog.add(
      body,
      head,
      belly,
      eyeL,
      eyeR,
      pupilL,
      pupilR,
      frontLegL,
      frontLegR,
      backLegL,
      backLegR,
      footFL,
      footFR,
      footBL,
      footBR
    );

    const hpShellMat = new THREE.MeshStandardMaterial({ color: 0xb7b9ff, roughness: 0.35, metalness: 0.12 });
    const hpPadMat = new THREE.MeshStandardMaterial({ color: 0x1b1633, roughness: 0.95, metalness: 0.02 });
    const hpLightMat = new THREE.MeshStandardMaterial({
      color: 0x1aa7ff,
      emissive: 0x1aa7ff,
      emissiveIntensity: 2.2,
      roughness: 0.4,
      metalness: 0.1,
    });

    const glassFrameMat = new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.35, metalness: 0.15 });
    const glassLensMat = new THREE.MeshStandardMaterial({
      color: 0x2a3140,
      transparent: true,
      opacity: 0.18,
      roughness: 0.12,
      metalness: 0.0,
    });

    const accessories = new THREE.Group();
    frog.add(accessories);

    const bandCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(-0.54, 0.22, 0.08),
        new THREE.Vector3(-0.36, 0.32, 0.16),
        new THREE.Vector3(0, 0.4, 0.17),
        new THREE.Vector3(0.36, 0.32, 0.16),
        new THREE.Vector3(0.54, 0.22, 0.08),
      ],
      false,
      "catmullrom",
      0.6
    );
    const bandGeo = new THREE.TubeGeometry(bandCurve, 64, 0.055, 12, false);
    const cupGeo = new THREE.BoxGeometry(0.34, 0.55, 0.32);
    const padGeo = new THREE.BoxGeometry(0.26, 0.47, 0.22);
    const lightGeo = new THREE.BoxGeometry(0.03, 0.38, 0.16);
    const yokeGeo = new THREE.BoxGeometry(0.08, 0.28, 0.08);

    const headphones = new THREE.Group();
    headphones.position.set(0, 0.52, 0.6);
    headphones.rotation.x = -0.12;
    accessories.add(headphones);

    const band = new THREE.Mesh(bandGeo, hpShellMat);
    headphones.add(band);

    const makeCup = (sign) => {
      const g = new THREE.Group();
      g.position.set(0.66 * sign, 0.07, 0.03);

      const shell = new THREE.Mesh(cupGeo, hpShellMat);
      shell.position.set(0, 0, 0);
      g.add(shell);

      const pad = new THREE.Mesh(padGeo, hpPadMat);
      pad.position.set(-0.06 * sign, 0, -0.01);
      g.add(pad);

      const light = new THREE.Mesh(lightGeo, hpLightMat);
      light.position.set(0.185 * sign, 0, 0.02);
      g.add(light);

      const yoke = new THREE.Mesh(yokeGeo, hpShellMat);
      yoke.position.set(-0.12 * sign, 0.28, 0.02);
      g.add(yoke);

      return g;
    };

    headphones.add(makeCup(-1), makeCup(1));

    const roundedRectShape = (w, h, r) => {
      const x = -w / 2;
      const y = -h / 2;
      const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
      const s = new THREE.Shape();
      s.moveTo(x + rr, y);
      s.lineTo(x + w - rr, y);
      s.quadraticCurveTo(x + w, y, x + w, y + rr);
      s.lineTo(x + w, y + h - rr);
      s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
      s.lineTo(x + rr, y + h);
      s.quadraticCurveTo(x, y + h, x, y + h - rr);
      s.lineTo(x, y + rr);
      s.quadraticCurveTo(x, y, x + rr, y);
      return s;
    };

    const outer = roundedRectShape(0.52, 0.26, 0.06);
    const inner = roundedRectShape(0.44, 0.18, 0.04);
    outer.holes.push(inner);

    const frameGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.04, bevelEnabled: false, curveSegments: 8 });
    frameGeo.translate(0, 0, -0.02);

    const lensGeo = new THREE.ShapeGeometry(inner);

    const bridgeGeo = new THREE.BoxGeometry(0.12, 0.05, 0.04);
    const templeGeo = new THREE.BoxGeometry(0.04, 0.04, 0.38);

    const glasses = new THREE.Group();
    glasses.position.set(0, 0.73, 0.995);
    accessories.add(glasses);

    const makeFrame = (sign) => {
      const g = new THREE.Group();
      g.position.set(0.31 * sign, 0, 0);

      const frame = new THREE.Mesh(frameGeo, glassFrameMat);
      g.add(frame);

      const lens = new THREE.Mesh(lensGeo, glassLensMat);
      lens.position.set(0, 0, 0.022);
      g.add(lens);

      const temple = new THREE.Mesh(templeGeo, glassFrameMat);
      temple.position.set(0.3 * sign, 0, -0.22);
      g.add(temple);

      return g;
    };

    const bridge = new THREE.Mesh(bridgeGeo, glassFrameMat);
    bridge.position.set(0, 0.015, 0);

    glasses.add(makeFrame(-1), makeFrame(1), bridge);

    const skidBudget = 260;
    const leftArray = new Float32Array(skidBudget * 3);
    const rightArray = new Float32Array(skidBudget * 3);

    const leftGeom = new THREE.BufferGeometry();
    const rightGeom = new THREE.BufferGeometry();

    const leftAttr = new THREE.BufferAttribute(leftArray, 3);
    const rightAttr = new THREE.BufferAttribute(rightArray, 3);

    leftAttr.setUsage(THREE.DynamicDrawUsage);
    rightAttr.setUsage(THREE.DynamicDrawUsage);

    leftGeom.setAttribute("position", leftAttr);
    rightGeom.setAttribute("position", rightAttr);

    leftGeom.setDrawRange(0, 0);
    rightGeom.setDrawRange(0, 0);

    const skidMat = new THREE.LineBasicMaterial({ color: 0xbfd0da, transparent: true, opacity: 0.55 });
    const leftLine = new THREE.Line(leftGeom, skidMat);
    const rightLine = new THREE.Line(rightGeom, skidMat);
    leftLine.frustumCulled = false;
    rightLine.frustumCulled = false;
    scene.add(leftLine, rightLine);

    const forestGroup = new THREE.Group();
    scene.add(forestGroup);

    const trunkGeo = new THREE.CylinderGeometry(1, 1, 1, 7, 1);
    const crownGeo = new THREE.ConeGeometry(1, 1, 7, 1);
    const bushGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3b26, roughness: 1, metalness: 0, vertexColors: true });
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x1d6b33, roughness: 1, metalness: 0, vertexColors: true });
    const bushMat = new THREE.MeshStandardMaterial({ color: 0x2b7a3d, roughness: 1, metalness: 0, vertexColors: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x44484f, roughness: 1, metalness: 0, vertexColors: true });

    const runeBaseGeo = new THREE.CylinderGeometry(0.42, 0.52, 0.34, 14, 1);
    const runeCrystalGeo = new THREE.OctahedronGeometry(0.32, 0);

    const artifactPedestalGeo = new THREE.CylinderGeometry(0.34, 0.46, 0.26, 12, 1);
    const artifactGeo = new THREE.TorusKnotGeometry(0.24, 0.08, 84, 14);

    const canGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.02, 26, 1, false);

    const propStoneMat = new THREE.MeshStandardMaterial({ color: 0x2b333d, roughness: 1, metalness: 0.02 });
    const runeGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 4.6,
      roughness: 0.18,
      metalness: 0.05,
      vertexColors: true,
    });
    runeGlowMat.toneMapped = false;

    const artifactMat = new THREE.MeshStandardMaterial({
      color: 0xd6c27a,
      emissive: 0x3a2a11,
      emissiveIntensity: 0.35,
      roughness: 0.26,
      metalness: 0.9,
    });

    const maxAniso = renderer.capabilities?.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 8;

    const makeCanTexture = (accentHex, label) => {
      const canvas = document.createElement("canvas");
      canvas.width = 256;
      canvas.height = 512;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
        tex.needsUpdate = true;
        return tex;
      }

      ctx.fillStyle = "#06070a";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const accent = new THREE.Color(accentHex);
      const accentCss = `rgb(${Math.round(accent.r * 255)}, ${Math.round(accent.g * 255)}, ${Math.round(accent.b * 255)})`;

      const grad = ctx.createLinearGradient(0, canvas.height, 0, 0);
      grad.addColorStop(0, "rgba(0,0,0,0.0)");
      grad.addColorStop(0.2, "rgba(0,0,0,0.0)");
      grad.addColorStop(0.5, "rgba(255,255,255,0.08)");
      grad.addColorStop(1, "rgba(255,255,255,0.12)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = accentCss;
      ctx.beginPath();
      ctx.moveTo(70, 440);
      ctx.bezierCurveTo(38, 345, 72, 265, 128, 225);
      ctx.bezierCurveTo(165, 200, 212, 160, 212, 110);
      ctx.bezierCurveTo(248, 175, 236, 255, 208, 305);
      ctx.bezierCurveTo(182, 355, 166, 390, 170, 440);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 0.66;
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.moveTo(110, 440);
      ctx.bezierCurveTo(96, 370, 118, 315, 152, 280);
      ctx.bezierCurveTo(176, 255, 182, 224, 182, 186);
      ctx.bezierCurveTo(206, 228, 208, 275, 194, 312);
      ctx.bezierCurveTo(180, 350, 158, 375, 154, 440);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(14, 0, 18, canvas.height);
      ctx.fillRect(canvas.width - 34, 0, 12, canvas.height);

      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = "900 92px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("BURN", canvas.width / 2, 438);

      ctx.fillStyle = accentCss;
      ctx.font = "800 30px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText(label, canvas.width / 2, 478);

      const tex = new THREE.CanvasTexture(canvas);
      if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, maxAniso);
      tex.needsUpdate = true;
      return tex;
    };

    const canVariants = [
      { label: "LEMON", accent: 0xffd24a },
      { label: "VIOLET", accent: 0xb07cff },
      { label: "ORANGE", accent: 0xff6b3a },
      { label: "LIME", accent: 0x61ff78 },
    ];

    const canTextures = canVariants.map((v) => makeCanTexture(v.accent, v.label));
    const canMats = canTextures.map(
      (map) =>
        new THREE.MeshStandardMaterial({
          map,
          emissive: 0x111111,
          emissiveIntensity: 0.32,
          roughness: 0.48,
          metalness: 0.72,
        })
    );

    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    const tmpMat = new THREE.Matrix4();
    const tmpPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();
    const tmpColor = new THREE.Color();
    const tmpEuler = new THREE.Euler(0, 0, 0, "YXZ");

    const tileSize = 120;
    const half = tileSize * 0.5;

    const makeTile = () => {
      const group = new THREE.Group();

      const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, 120);
      const crown = new THREE.InstancedMesh(crownGeo, crownMat, 120);
      const bush = new THREE.InstancedMesh(bushGeo, bushMat, 90);
      const rock = new THREE.InstancedMesh(rockGeo, rockMat, 60);

      const runeBase = new THREE.InstancedMesh(runeBaseGeo, propStoneMat, 4);
      const runeCrystal = new THREE.InstancedMesh(runeCrystalGeo, runeGlowMat, 4);

      const artifactPedestal = new THREE.InstancedMesh(artifactPedestalGeo, propStoneMat, 2);
      const artifact = new THREE.InstancedMesh(artifactGeo, artifactMat, 2);

      const cans = canMats.map((m) => new THREE.InstancedMesh(canGeo, m, 18));

      trunk.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crown.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      bush.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      rock.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      runeBase.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      runeCrystal.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      artifactPedestal.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      artifact.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      for (const c of cans) c.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      runeBase.frustumCulled = false;
      runeCrystal.frustumCulled = false;
      artifactPedestal.frustumCulled = false;
      artifact.frustumCulled = false;
      for (const c of cans) c.frustumCulled = false;

      group.add(trunk, crown, bush, rock, runeBase, runeCrystal, artifactPedestal, artifact, ...cans);

      return { group, trunk, crown, bush, rock, runeBase, runeCrystal, artifactPedestal, artifact, cans };
    };

    const populateTile = (tile, tx, tz) => {
      const seed = hash2i(tx, tz);
      const rng = makeRng(seed);

      const density = 0.92;

      const trunkMax = tile.trunk.instanceMatrix.count;
      const bushMax = tile.bush.instanceMatrix.count;
      const rockMax = tile.rock.instanceMatrix.count;

      const treeCount = Math.max(1, Math.floor(trunkMax * density));
      const bushCount = Math.max(0, Math.floor(bushMax * density));
      const rockCount = Math.max(0, Math.floor(rockMax * (0.75 + 0.25 * density)));

      let ti = 0;
      let bi = 0;
      let ri = 0;

      const sampleXZ = () => ({ x: randRange(rng, -half, half), z: randRange(rng, -half, half) });

      for (let i = 0; i < treeCount; i++) {
        const { x, z } = sampleXZ();
        const rot = randRange(rng, -Math.PI, Math.PI);

        const h = randRange(rng, 2.0, 5.6);
        const r = randRange(rng, 0.09, 0.16);

        tmpQuat.setFromAxisAngle(Y_AXIS, rot);

        tmpPos.set(x, h * 0.5, z);
        tmpScale.set(r, h, r);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.trunk.setMatrixAt(ti, tmpMat);

        const bark = clamp(randRange(rng, 0.22, 0.4), 0, 1);
        tmpColor.setHSL(0.085, 0.42, bark);
        tile.trunk.setColorAt(ti, tmpColor);

        const cH = randRange(rng, 1.6, 4.2);
        const cR = randRange(rng, 0.9, 1.8);

        tmpPos.set(x, h + cH * 0.45, z);
        tmpScale.set(cR, cH, cR);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.crown.setMatrixAt(ti, tmpMat);

        const hue = randRange(rng, 0.27, 0.36);
        const sat = randRange(rng, 0.45, 0.75);
        const lig = randRange(rng, 0.22, 0.32);
        tmpColor.setHSL(hue, sat, lig);
        tile.crown.setColorAt(ti, tmpColor);

        ti++;
      }

      for (let i = 0; i < bushCount; i++) {
        const { x, z } = sampleXZ();
        const rot = randRange(rng, -Math.PI, Math.PI);
        const s = randRange(rng, 0.55, 1.25);

        tmpQuat.setFromAxisAngle(Y_AXIS, rot);
        tmpPos.set(x, s * 0.55, z);
        tmpScale.set(s * 0.95, s * 0.75, s * 0.95);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.bush.setMatrixAt(bi, tmpMat);

        tmpColor.setHSL(randRange(rng, 0.27, 0.36), randRange(rng, 0.32, 0.58), randRange(rng, 0.2, 0.28));
        tile.bush.setColorAt(bi, tmpColor);

        bi++;
      }

      for (let i = 0; i < rockCount; i++) {
        const { x, z } = sampleXZ();
        const rot = randRange(rng, -Math.PI, Math.PI);
        const s = randRange(rng, 0.25, 0.9);

        tmpQuat.setFromAxisAngle(Y_AXIS, rot);
        tmpPos.set(x, s * 0.25, z);
        tmpScale.set(s, s * randRange(rng, 0.65, 1.05), s);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.rock.setMatrixAt(ri, tmpMat);

        const l = randRange(rng, 0.22, 0.38);
        tmpColor.setHSL(0.6, 0.08, l);
        tile.rock.setColorAt(ri, tmpColor);

        ri++;
      }

      let runeTarget = 0;
      if (rng() < 0.82) runeTarget = 1;
      if (rng() < 0.42) runeTarget += 1;
      if (rng() < 0.16) runeTarget += 1;
      runeTarget = Math.min(runeTarget, tile.runeBase.instanceMatrix.count);

      let artifactTarget = 0;
      if (rng() < 0.5) artifactTarget = 1;
      if (rng() < 0.16) artifactTarget += 1;
      artifactTarget = Math.min(artifactTarget, tile.artifact.instanceMatrix.count);

      const cansTarget = 10 + Math.floor(rng() * 10);

      const runeColors = [
        0xff3b3b,
        0xb250ff,
        0x2b7bff,
        0x35ff7b,
        0xffd24a,
        0x43e9ff,
      ];

      let runeN = 0;
      let artN = 0;
      const canN = new Array(canVariants.length).fill(0);

      const samplePropXZ = (minR = 10) => {
        const minR2 = minR * minR;
        for (let k = 0; k < 42; k++) {
          const a = randRange(rng, -Math.PI, Math.PI);
          const rr = (half * 0.62) * Math.sqrt(rng());
          const x = Math.cos(a) * rr;
          const z = Math.sin(a) * rr;
          if (x * x + z * z >= minR2) return { x, z };
        }
        return { x: randRange(rng, -half * 0.35, half * 0.35), z: randRange(rng, -half * 0.35, half * 0.35) };
      };

      for (let r = 0; r < runeTarget; r++) {
        const { x, z } = samplePropXZ(14);
        const rot = randRange(rng, -Math.PI, Math.PI);
        const c = runeColors[Math.floor(rng() * runeColors.length)];

        tmpQuat.setFromAxisAngle(Y_AXIS, rot);

        tmpPos.set(x, 0.17, z);
        tmpScale.set(1.15, 1.1, 1.15);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.runeBase.setMatrixAt(runeN, tmpMat);

        tmpEuler.set(randRange(rng, 0, Math.PI), randRange(rng, -Math.PI, Math.PI), randRange(rng, 0, Math.PI));
        tmpQuat.setFromEuler(tmpEuler);
        tmpPos.set(x, 0.92, z);
        tmpScale.set(1.2, 1.45, 1.2);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.runeCrystal.setMatrixAt(runeN, tmpMat);
        tmpColor.setHex(c);
        tile.runeCrystal.setColorAt(runeN, tmpColor);

        runeN++;
      }

      for (let a = 0; a < artifactTarget; a++) {
        const { x, z } = samplePropXZ(16);
        const rot = randRange(rng, -Math.PI, Math.PI);

        tmpQuat.setFromAxisAngle(Y_AXIS, rot);
        tmpPos.set(x, 0.13, z);
        tmpScale.set(1.25, 1.1, 1.25);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.artifactPedestal.setMatrixAt(artN, tmpMat);

        tmpEuler.set(randRange(rng, -0.08, 0.08), rot, randRange(rng, -0.08, 0.08));
        tmpQuat.setFromEuler(tmpEuler);
        tmpPos.set(x, 0.72, z);
        tmpScale.set(1.25, 1.25, 1.25);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.artifact.setMatrixAt(artN, tmpMat);

        artN++;
      }

      for (let k = 0; k < cansTarget; k++) {
        const vIdx = Math.floor(rng() * canVariants.length);
        const i = canN[vIdx];
        if (i >= tile.cans[vIdx].instanceMatrix.count) continue;

        const { x, z } = samplePropXZ(12);

        const lying = rng() < 0.32;
        const rotY = randRange(rng, -Math.PI, Math.PI);

        const rx = lying ? Math.PI / 2 + randRange(rng, -0.28, 0.28) : randRange(rng, -0.08, 0.08);
        const rz = lying ? randRange(rng, -0.28, 0.28) : randRange(rng, -0.06, 0.06);

        tmpEuler.set(rx, rotY, rz);
        tmpQuat.setFromEuler(tmpEuler);
        tmpPos.set(x, lying ? 0.34 : 0.52, z);
        tmpScale.set(2.85, 2.85, 2.85);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.cans[vIdx].setMatrixAt(i, tmpMat);

        canN[vIdx] = i + 1;
      }

      tile.trunk.count = ti;
      tile.crown.count = ti;
      tile.bush.count = bi;
      tile.rock.count = ri;

      tile.runeBase.count = runeN;
      tile.runeCrystal.count = runeN;
      tile.artifactPedestal.count = artN;
      tile.artifact.count = artN;

      for (let i = 0; i < tile.cans.length; i++) tile.cans[i].count = canN[i];

      tile.trunk.instanceMatrix.needsUpdate = true;
      tile.crown.instanceMatrix.needsUpdate = true;
      tile.bush.instanceMatrix.needsUpdate = true;
      tile.rock.instanceMatrix.needsUpdate = true;

      tile.runeBase.instanceMatrix.needsUpdate = true;
      tile.runeCrystal.instanceMatrix.needsUpdate = true;
      tile.artifactPedestal.instanceMatrix.needsUpdate = true;
      tile.artifact.instanceMatrix.needsUpdate = true;
      for (const c of tile.cans) c.instanceMatrix.needsUpdate = true;

      if (tile.trunk.instanceColor) tile.trunk.instanceColor.needsUpdate = true;
      if (tile.crown.instanceColor) tile.crown.instanceColor.needsUpdate = true;
      if (tile.bush.instanceColor) tile.bush.instanceColor.needsUpdate = true;
      if (tile.rock.instanceColor) tile.rock.instanceColor.needsUpdate = true;

      if (tile.runeCrystal.instanceColor) tile.runeCrystal.instanceColor.needsUpdate = true;
    };

    const tileSlots = [];
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = makeTile();
        t.dx = dx;
        t.dz = dz;
        forestGroup.add(t.group);
        tileSlots.push(t);
      }
    }

    let centerTX = 0;
    let centerTZ = 0;

    const updateForest = (newTX, newTZ) => {
      centerTX = newTX;
      centerTZ = newTZ;
      for (const t of tileSlots) {
        const tx2 = centerTX + t.dx;
        const tz2 = centerTZ + t.dz;
        t.group.position.set(tx2 * tileSize, 0, tz2 * tileSize);
        populateTile(t, tx2, tz2);
      }
    };

    const pos = vec3(0, 0, 0);
    const vel = vec3(0, 0, 0);

    let yaw = 0;
    let targetYaw = 0;
    let turnDelta = 0;

    let airborne = false;
    let vy = 0;
    let groundTimer = 0;
    let airborneTime = 0;

    const maxTurn = Math.PI / 2;
    const g = 9.81;

    const leftCount = { current: 0 };
    const rightCount = { current: 0 };

    const fwd = vec3();
    const right = vec3();
    const camPos = vec3();
    const camLook = vec3();
    const v0 = vec3();
    const v1 = vec3();
    const footL = vec3();
    const footR = vec3();

    const euler = new THREE.Euler(0, 0, 0, "YXZ");

    const planNextJump = () => {
      const d = (Math.random() * 2 - 1) * maxTurn;
      turnDelta = clamp(d, -maxTurn, maxTurn);
      targetYaw = wrapPi(yaw + turnDelta);

      const up = lerp(5.0, 7.4, Math.random());
      const horiz = lerp(8.5, 15.5, Math.random());

      fwd.set(Math.sin(yaw), 0, Math.cos(yaw));

      vel.x = fwd.x * horiz;
      vel.z = fwd.z * horiz;

      vy = up;
      airborne = true;
      airborneTime = 0;
    };

    planNextJump();
    updateForest(0, 0);

    const pushPoint = (arr, countObj, x, y, z) => {
      const n = countObj.current;
      if (n < skidBudget) {
        const i = n * 3;
        arr[i + 0] = x;
        arr[i + 1] = y;
        arr[i + 2] = z;
        countObj.current = n + 1;
        return;
      }
      arr.copyWithin(0, 3);
      const j = (skidBudget - 1) * 3;
      arr[j + 0] = x;
      arr[j + 1] = y;
      arr[j + 2] = z;
    };

    const popFront = (arr, countObj) => {
      const n = countObj.current;
      if (n <= 0) return;
      if (n === 1) {
        countObj.current = 0;
        return;
      }
      arr.copyWithin(0, 3, n * 3);
      countObj.current = n - 1;
    };

    const syncSkids = () => {
      const lc = leftCount.current;
      const rc = rightCount.current;
      leftAttr.needsUpdate = true;
      rightAttr.needsUpdate = true;
      leftGeom.setDrawRange(0, lc >= 2 ? lc : 0);
      rightGeom.setDrawRange(0, rc >= 2 ? rc : 0);
    };

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    resize();
    window.addEventListener("resize", resize);

    let prev = performance.now();
    const tick = (now) => {
      rafRef.current = requestAnimationFrame(tick);

      const delta = (now - prev) / 1000;
      prev = now;
      const dt = clamp(delta, 0.001, 0.03);

      fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
      right.set(fwd.z, 0, -fwd.x);

      let drift = 0;

      if (airborne) {
        airborneTime += dt;

        yaw = lerpAngle(yaw, targetYaw, 1 - Math.exp(-4.8 * dt));

        vy -= g * dt;
        pos.y += vy * dt;
        pos.x += vel.x * dt;
        pos.z += vel.z * dt;

        const airDrag = Math.exp(-0.22 * dt);
        vel.x *= airDrag;
        vel.z *= airDrag;

        if (pos.y <= 0 && vy <= 0) {
          pos.y = 0;
          vy = 0;
          airborne = false;

          yaw = targetYaw;

          vel.x *= 0.92;
          vel.z *= 0.92;

          groundTimer = lerp(0.35, 1.1, Math.random());
        }

        const tuck = smoothstep(0, 0.25, airborneTime) * (1 - smoothstep(0.55, 0.9, airborneTime));
        const t = clamp(tuck, 0, 1);

        frontLegL.rotation.x = Math.PI / 2 - 0.9 * t;
        frontLegR.rotation.x = Math.PI / 2 - 0.9 * t;
        backLegL.rotation.x = Math.PI / 2 - 0.6 * t;
        backLegR.rotation.x = Math.PI / 2 - 0.6 * t;

        footFL.position.y = 0.11 + 0.12 * t;
        footFR.position.y = 0.11 + 0.12 * t;
        footBL.position.y = 0.11 + 0.18 * t;
        footBR.position.y = 0.11 + 0.18 * t;
      } else {
        groundTimer -= dt;

        const vLong = vel.dot(fwd);
        const vLat = vel.dot(right);
        const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

        const beta = Math.atan2(vLat, Math.abs(vLong) + 0.6);
        const betaAbs = Math.abs(beta);

        drift = clamp(smoothstep(0.18, 0.58, betaAbs) * smoothstep(3.0, 10.0, speed), 0, 1);

        const kLong = 2.3;
        const kLat = lerp(1.15, 7.0, 1 - drift);

        const dLong = Math.exp(-kLong * dt);
        const dLat = Math.exp(-kLat * dt);

        const nLong = vLong * dLong;
        const nLat = vLat * dLat;

        vel.x = fwd.x * nLong + right.x * nLat;
        vel.z = fwd.z * nLong + right.z * nLat;

        const overall = Math.exp(-0.22 * dt);
        vel.x *= overall;
        vel.z *= overall;

        pos.x += vel.x * dt;
        pos.z += vel.z * dt;

        if (groundTimer <= 0) {
          const speed2 = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
          if (speed2 < 1.35) planNextJump();
        }

        const extend = 1 - smoothstep(0, 0.4, drift);
        const e = clamp(extend, 0, 1);

        frontLegL.rotation.x = Math.PI / 2 - 0.25 * e;
        frontLegR.rotation.x = Math.PI / 2 - 0.25 * e;
        backLegL.rotation.x = Math.PI / 2 - 0.35 * e;
        backLegR.rotation.x = Math.PI / 2 - 0.35 * e;

        footFL.position.y = 0.11;
        footFR.position.y = 0.11;
        footBL.position.y = 0.11;
        footBR.position.y = 0.11;
      }

      const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

      const snap = 10;
      const gx = Math.round(pos.x / snap) * snap;
      const gz = Math.round(pos.z / snap) * snap;
      ground.position.set(gx, 0, gz);

      const newTX = Math.floor((pos.x + tileSize * 0.5) / tileSize);
      const newTZ = Math.floor((pos.z + tileSize * 0.5) / tileSize);
      if (newTX !== centerTX || newTZ !== centerTZ) updateForest(newTX, newTZ);

      const skidOn = !airborne && drift > 0.38 && speed > 4.0;
      if (skidOn) {
        const footBack = -0.18;
        const halfSpan = 0.38;

        footL.copy(pos).addScaledVector(fwd, footBack).addScaledVector(right, -halfSpan);
        footR.copy(pos).addScaledVector(fwd, footBack).addScaledVector(right, halfSpan);

        pushPoint(leftArray, leftCount, footL.x, 0.01, footL.z);
        pushPoint(rightArray, rightCount, footR.x, 0.01, footR.z);
      } else {
        if (leftCount.current > 0) popFront(leftArray, leftCount);
        if (rightCount.current > 0) popFront(rightArray, rightCount);
      }
      syncSkids();

      frog.position.set(pos.x, pos.y, pos.z);

      const vLong2 = vel.dot(fwd);
      const vLat2 = vel.dot(right);

      const roll = clamp((-vLat2 / 10) * lerp(0.6, 1.1, drift), -0.35, 0.35);
      const pitch = airborne ? clamp(vy / 10, -0.25, 0.25) : clamp((-vLong2 / 18) * 0.18, -0.18, 0.18);

      euler.set(pitch, yaw, roll);
      frog.rotation.copy(euler);

      const camSide = 13.2;
      const camUp = 10.6;
      const camFront = 13.2;

      camPos.copy(pos).add(v0.set(camSide, camUp, camFront));
      camLook.copy(pos).add(v1.set(0, 0.85, 0));

      camera.position.lerp(camPos, 1 - Math.exp(-3.2 * dt));
      camera.lookAt(camLook);

      const pulse = 0.65 + 0.35 * Math.sin(now * 0.003);
      runeGlowMat.emissiveIntensity = 3.8 + 2.0 * pulse;

      renderer.render(scene, camera);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);

      scene.remove(leftLine, rightLine, frog, forestGroup, ground, ambient, hemi, dir);

      leftGeom.dispose();
      rightGeom.dispose();
      skidMat.dispose();

      bodyGeo.dispose();
      headGeo.dispose();
      bellyGeo.dispose();
      eyeGeo.dispose();
      pupilGeo.dispose();
      limbGeo.dispose();
      footGeo.dispose();

      disposeMaterial(frogMat);
      disposeMaterial(frogDarkMat);
      disposeMaterial(frogBellyMat);
      disposeMaterial(eyeWhiteMat);
      disposeMaterial(eyePupilMat);
      disposeMaterial(hpShellMat);
      disposeMaterial(hpPadMat);
      disposeMaterial(hpLightMat);
      disposeMaterial(glassFrameMat);
      disposeMaterial(glassLensMat);

      bandGeo.dispose();
      cupGeo.dispose();
      padGeo.dispose();
      lightGeo.dispose();
      yokeGeo.dispose();
      frameGeo.dispose();
      lensGeo.dispose();
      bridgeGeo.dispose();
      templeGeo.dispose();

      groundGeo.dispose();
      disposeMaterial(groundMat);

      trunkGeo.dispose();
      crownGeo.dispose();
      bushGeo.dispose();
      rockGeo.dispose();

      runeBaseGeo.dispose();
      runeCrystalGeo.dispose();
      artifactPedestalGeo.dispose();
      artifactGeo.dispose();
      canGeo.dispose();

      disposeMaterial(trunkMat);
      disposeMaterial(crownMat);
      disposeMaterial(bushMat);
      disposeMaterial(rockMat);

      disposeMaterial(propStoneMat);
      disposeMaterial(runeGlowMat);
      disposeMaterial(artifactMat);

      for (const t of canTextures) t.dispose?.();
      for (const m of canMats) m.dispose?.();

      renderer.dispose();
      renderer.forceContextLoss?.();

      if (renderer.domElement && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div style={{ width: "100%", height: "100vh", background: "#07110b", position: "relative" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root"))
  .render(React.createElement(App));
