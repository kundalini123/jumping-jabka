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

function HUDOverlay({ hud }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 16,
        top: 16,
        padding: "10px 12px",
        borderRadius: 12,
        background: "rgba(0,0,0,0.35)",
        backdropFilter: "blur(6px)",
        color: "white",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
        fontSize: 13,
        lineHeight: 1.35,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 6 }}>Frog drift</div>
      <div>Скорость: {Math.round(hud.speed)} м/с</div>
      <div>Поворот прыжка: {Math.round((hud.turn * 180) / Math.PI)}°</div>
      <div>Дрифт: {Math.round(hud.drift * 100)}%</div>
    </div>
  );
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
  const [hud, setHud] = useState({ speed: 0, turn: 0, drift: 0 });

  const ui = useMemo(
    () => ({
      lastHudMs: 0,
      hud: { speed: 0, turn: 0, drift: 0 },
    }),
    []
  );

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setClearColor(0x07110b, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.pointerEvents = "none";
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x07110b, 28, 210);
    scene.background = new THREE.Color(0x07110b);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
    camera.position.set(14, 10.5, 14);
    camera.up.set(0, 1, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.42);
    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x1c2a1f, 0.85);
    const dir = new THREE.DirectionalLight(0xfff3d6, 1.15);
    dir.position.set(10, 18, 6);
    scene.add(ambient, hemi, dir);

    const groundSize = 260;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x0a2013, roughness: 1, metalness: 0 });
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
        new THREE.Vector3(0, 0.40, 0.17),
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
      temple.position.set(0.30 * sign, 0, -0.22);
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

    const Y_AXIS = new THREE.Vector3(0, 1, 0);
    const tmpMat = new THREE.Matrix4();
    const tmpPos = new THREE.Vector3();
    const tmpQuat = new THREE.Quaternion();
    const tmpScale = new THREE.Vector3();
    const tmpColor = new THREE.Color();

    const tileSize = 90;
    const half = tileSize * 0.5;

    const makeTile = () => {
      const group = new THREE.Group();

      const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, 120);
      const crown = new THREE.InstancedMesh(crownGeo, crownMat, 120);
      const bush = new THREE.InstancedMesh(bushGeo, bushMat, 90);
      const rock = new THREE.InstancedMesh(rockGeo, rockMat, 60);

      trunk.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crown.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      bush.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      rock.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      group.add(trunk, crown, bush, rock);

      return { group, trunk, crown, bush, rock };
    };

    const populateTile = (tile, tx, tz) => {
      const seed = hash2i(tx, tz);
      const rng = makeRng(seed);

      const density = 0.95;
      const clearR = 0;
      const clearR2 = 0;

      const trunkMax = tile.trunk.instanceMatrix.count;
      const bushMax = tile.bush.instanceMatrix.count;
      const rockMax = tile.rock.instanceMatrix.count;

      const treeCount = Math.max(1, Math.floor(trunkMax * density));
      const bushCount = Math.max(0, Math.floor(bushMax * density));
      const rockCount = Math.max(0, Math.floor(rockMax * (0.75 + 0.25 * density)));

      let ti = 0;
      let bi = 0;
      let ri = 0;

      const sampleXZ = () => {
        let x = 0;
        let z = 0;
        for (let k = 0; k < 24; k++) {
          x = randRange(rng, -half, half);
          z = randRange(rng, -half, half);
          if (clearR2 <= 0) return { x, z };
          const d2 = x * x + z * z;
          if (d2 > clearR2) return { x, z };
        }
        return { x, z };
      };

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

        const bark = clamp(randRange(rng, 0.18, 0.32), 0, 1);
        tmpColor.setHSL(0.08, 0.45, bark);
        tile.trunk.setColorAt(ti, tmpColor);

        const cH = randRange(rng, 1.6, 4.2);
        const cR = randRange(rng, 0.9, 1.8);

        tmpPos.set(x, h + cH * 0.45, z);
        tmpScale.set(cR, cH, cR);
        tmpMat.compose(tmpPos, tmpQuat, tmpScale);
        tile.crown.setMatrixAt(ti, tmpMat);

        const hue = randRange(rng, 0.27, 0.36);
        const sat = randRange(rng, 0.45, 0.75);
        const lig = randRange(rng, 0.18, 0.26);
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

        tmpColor.setHSL(randRange(rng, 0.27, 0.36), randRange(rng, 0.35, 0.6), randRange(rng, 0.16, 0.22));
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

        const l = randRange(rng, 0.18, 0.32);
        tmpColor.setHSL(0.6, 0.08, l);
        tile.rock.setColorAt(ri, tmpColor);

        ri++;
      }

      tile.trunk.count = ti;
      tile.crown.count = ti;
      tile.bush.count = bi;
      tile.rock.count = ri;

      tile.trunk.instanceMatrix.needsUpdate = true;
      tile.crown.instanceMatrix.needsUpdate = true;
      tile.bush.instanceMatrix.needsUpdate = true;
      tile.rock.instanceMatrix.needsUpdate = true;

      if (tile.trunk.instanceColor) tile.trunk.instanceColor.needsUpdate = true;
      if (tile.crown.instanceColor) tile.crown.instanceColor.needsUpdate = true;
      if (tile.bush.instanceColor) tile.bush.instanceColor.needsUpdate = true;
      if (tile.rock.instanceColor) tile.rock.instanceColor.needsUpdate = true;
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
        const tx = centerTX + t.dx;
        const tz = centerTZ + t.dz;
        t.group.position.set(tx * tileSize, 0, tz * tileSize);
        populateTile(t, tx, tz);
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

      const newTX = Math.round(pos.x / tileSize);
      const newTZ = Math.round(pos.z / tileSize);
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

      const camSide = 15.5;
      const camUp = 12.5;
      const camFront = 15.5;

      camPos.copy(pos).add(v0.set(camSide, camUp, camFront));
      camLook.copy(pos).add(v1.set(0, 0.85, 0));

      camera.position.lerp(camPos, 1 - Math.exp(-3.2 * dt));
      camera.lookAt(camLook);

      renderer.render(scene, camera);

      if (now - ui.lastHudMs >= 50) {
        ui.lastHudMs = now;
        ui.hud.speed = speed;
        ui.hud.turn = turnDelta;
        ui.hud.drift = drift;
        setHud({ speed: ui.hud.speed, turn: ui.hud.turn, drift: ui.hud.drift });
      }
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

      disposeMaterial(trunkMat);
      disposeMaterial(crownMat);
      disposeMaterial(bushMat);
      disposeMaterial(rockMat);

      renderer.dispose();
      renderer.forceContextLoss?.();

      if (renderer.domElement && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [ui]);

  return (
    <div style={{ width: "100%", height: "100vh", background: "#07110b", position: "relative" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%" }} />
      <HUDOverlay hud={hud} />
    </div>
  );
}
ReactDOM.createRoot(document.getElementById("root"))
  .render(React.createElement(App));
