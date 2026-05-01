/**
 * Three.js WebGL track — neon road, gates, coins, barriers, runner.
 */
import * as THREE from "three";

const LANE_X = [-1.42, 0, 1.42];
const Z_SCALE = 0.108;

function makeStarfield() {
  const n = 900;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 120;
    pos[i * 3 + 1] = Math.random() * 35 + 4;
    pos[i * 3 + 2] = -Math.random() * 90 - 5;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xaaccff,
    size: 0.06,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  });
  return new THREE.Points(geo, mat);
}

/**
 * Canvas2D “fake lane” when WebGL is missing (sandboxed IDE browser, GPU off, etc.).
 * @param {HTMLElement} container
 */
function createCanvas2dTrackRenderer(container) {
  const canvas = document.createElement("canvas");
  canvas.className = "track-2d-canvas";
  canvas.dataset.webglFallback = "1";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText =
    "position:absolute;inset:0;width:100%;height:100%;z-index:0;display:block;touch-action:none;";
  container.insertBefore(canvas, container.firstChild);

  let cw = 1;
  let ch = 1;
  /** @type {CanvasRenderingContext2D | null} */
  let ctx2 = canvas.getContext("2d");

  function resize(w, h) {
    cw = Math.max(1, w | 0);
    ch = Math.max(1, h | 0);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cw * dpr);
    canvas.height = Math.floor(ch * dpr);
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    ctx2 = canvas.getContext("2d");
    if (ctx2) ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function laneBottomX(lane) {
    const margin = cw * 0.12;
    const span = Math.max(10, cw - 2 * margin);
    return margin + (lane + 0.5) * (span / 3);
  }

  function interpolateX(lane, y, vx, vy, bY) {
    const denom = Math.max(1e-6, bY - vy);
    const p = Math.max(0, Math.min(1, (y - vy) / denom));
    const topX = vx + (lane - 1) * cw * 0.11;
    const botX = laneBottomX(lane);
    return topX + (botX - topX) * p;
  }

  function sync(state) {
    if (!ctx2 || cw < 8 || ch < 8) return;
    const { playerTrackPos, playerLane, scroll, gates, trackPickups, cameraShake } = state;

    const shake = (cameraShake || 0) * 12;
    const ox = shake ? (Math.random() - 0.5) * shake : 0;
    const oy = shake ? (Math.random() - 0.5) * shake : 0;
    ctx2.save();
    ctx2.translate(ox, oy);

    ctx2.fillStyle = "#050912";
    ctx2.fillRect(0, 0, cw, ch);

    const vx = cw / 2;
    const vy = ch * 0.2;
    const bY = ch * 0.97;
    const bL = cw * 0.06;
    const bR = cw * 0.94;
    const tW = cw * 0.13;

    ctx2.fillStyle = "#0c121c";
    ctx2.beginPath();
    ctx2.moveTo(bL, bY);
    ctx2.lineTo(vx - tW, vy);
    ctx2.lineTo(vx + tW, vy);
    ctx2.lineTo(bR, bY);
    ctx2.closePath();
    ctx2.fill();

    ctx2.strokeStyle = "rgba(45, 212, 191, 0.45)";
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    ctx2.moveTo(vx, vy);
    ctx2.lineTo(cw * 0.365, bY);
    ctx2.moveTo(vx, vy);
    ctx2.lineTo(cw * 0.635, bY);
    ctx2.stroke();

    const stripe = 38 + (scroll * 0.35) % 38;
    ctx2.strokeStyle = "rgba(45, 212, 191, 0.14)";
    ctx2.lineWidth = 1;
    for (let i = -2; i < 22; i++) {
      const ty = ((i * stripe + (scroll * 2.8) % stripe) / ch) * (bY - vy) + vy;
      if (ty < vy || ty > bY) continue;
      const spread = ((ty - vy) / (bY - vy)) * cw * 0.33 + cw * 0.07;
      ctx2.beginPath();
      ctx2.moveTo(vx - spread, ty);
      ctx2.lineTo(vx + spread, ty);
      ctx2.stroke();
    }

    const gSorted = [...gates].sort((a, b) => a.at - b.at);
    for (const g of gSorted) {
      if (g.passed) continue;
      const ahead = g.at - playerTrackPos;
      if (ahead < -30 || ahead > 520) continue;
      const y = bY - 22 - Math.min(1, ahead / 240) * (bY - vy - 48);
      const spread = ((y - vy) / (bY - vy)) * cw * 0.4 + cw * 0.05;
      ctx2.fillStyle = "rgba(45, 212, 191, 0.4)";
      ctx2.fillRect(vx - spread, y - 5, spread * 2, 10);
      break;
    }

    for (const p of trackPickups) {
      if (p.kind === "coin" && p.collected) continue;
      if (p.kind === "hazard" && p.hit) continue;
      const ahead = p.at - playerTrackPos;
      if (ahead < -45 || ahead > 480) continue;
      const y = bY - 32 - Math.min(1, ahead / 250) * (bY - vy - 64);
      const x = interpolateX(p.lane, y, vx, vy, bY);
      if (p.kind === "coin") {
        ctx2.fillStyle = "#fbbf24";
        ctx2.beginPath();
        ctx2.arc(x, y, 10, 0, Math.PI * 2);
        ctx2.fill();
      } else {
        ctx2.fillStyle = "rgba(220, 38, 38, 0.92)";
        ctx2.fillRect(x - 7, y - 18, 14, 36);
      }
    }

    const lane = Math.max(0, Math.min(2, playerLane | 0));
    const px = laneBottomX(lane);
    const py = bY - ch * 0.11;
    ctx2.fillStyle = "#2dd4bf";
    ctx2.beginPath();
    ctx2.arc(px, py, 18, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.fillStyle = "#e8b8a8";
    ctx2.beginPath();
    ctx2.arc(px, py - 22, 12, 0, Math.PI * 2);
    ctx2.fill();

    ctx2.fillStyle = "rgba(139, 149, 168, 0.9)";
    ctx2.font = '600 11px system-ui, "DM Sans", sans-serif';
    ctx2.textAlign = "center";
    ctx2.fillText("2D lane · use Chrome / Edge / Safari for full WebGL 3D", cw / 2, ch - 10);

    ctx2.restore();
  }

  function dispose() {
    canvas.remove();
  }

  return {
    sync,
    resize,
    dispose,
    renderer: null,
    scene: null,
    camera: null,
  };
}

export function createTrackRenderer(container) {
  /** @type {THREE.WebGLRenderer | null} */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "default",
      failIfMajorPerformanceCaveat: false,
    });
    if (!renderer.getContext()) throw new Error("No WebGL context");
  } catch (err) {
    console.warn("WebGL unavailable:", err);
    return createCanvas2dTrackRenderer(container);
  }

  try {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x03050a);
  scene.fog = new THREE.FogExp2(0x050912, 0.038);

  const camera = new THREE.PerspectiveCamera(52, 2 / 3, 0.1, 120);
  camera.position.set(0, 2.45, 5.35);
  camera.lookAt(0, 0.55, -10);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  try {
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
  } catch {
    renderer.toneMapping = THREE.NoToneMapping;
  }
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.left = "0";
  renderer.domElement.style.top = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.zIndex = "0";
  container.insertBefore(renderer.domElement, container.firstChild);

  const amb = new THREE.AmbientLight(0x3a4a6e, 0.45);
  scene.add(amb);
  const key = new THREE.DirectionalLight(0xa8c8ff, 0.95);
  key.position.set(-4, 14, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x5eead4, 0.35);
  rim.position.set(6, 4, -2);
  scene.add(rim);
  const pulse = new THREE.PointLight(0x5eead4, 1.4, 28, 2);
  pulse.position.set(0, 1.2, 1);
  scene.add(pulse);

  scene.add(makeStarfield());

  const roadMat = new THREE.MeshStandardMaterial({
    color: 0x0c121c,
    metalness: 0.65,
    roughness: 0.35,
    emissive: 0x061018,
    emissiveIntensity: 0.35,
  });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 200, 1, 1), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, -42);
  scene.add(road);

  const grid = new THREE.GridHelper(200, 80, 0x2dd4bf, 0x1a2332);
  grid.rotation.x = Math.PI / 2;
  grid.position.set(0, 0.02, -45);
  const gmat = grid.material;
  if (gmat) {
    if (Array.isArray(gmat)) gmat.forEach((m) => Object.assign(m, { transparent: true, opacity: 0.22 }));
    else Object.assign(gmat, { transparent: true, opacity: 0.22 });
  }
  scene.add(grid);

  const edgeGeo = new THREE.BoxGeometry(0.08, 0.06, 200);
  const edgeMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    emissive: 0x2dd4bf,
    emissiveIntensity: 0.55,
    metalness: 0.8,
    roughness: 0.25,
  });
  const leftEdge = new THREE.Mesh(edgeGeo, edgeMat);
  leftEdge.position.set(-4.35, 0.04, -42);
  const rightEdge = leftEdge.clone();
  rightEdge.position.x = 4.35;
  scene.add(leftEdge, rightEdge);

  const gateMat = new THREE.MeshStandardMaterial({
    color: 0x134e4a,
    emissive: 0x2dd4bf,
    emissiveIntensity: 0.9,
    metalness: 0.6,
    roughness: 0.2,
    transparent: true,
    opacity: 0.92,
  });
  const gateBeam = new THREE.BoxGeometry(8.2, 0.22, 0.14);
  const maxGates = 10;
  const gateObjs = [];
  for (let i = 0; i < maxGates; i++) {
    const g = new THREE.Mesh(gateBeam, gateMat);
    g.visible = false;
    scene.add(g);
    gateObjs.push(g);
  }

  const coinMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 0.65,
    metalness: 0.9,
    roughness: 0.15,
  });
  const coinGeo = new THREE.TorusGeometry(0.32, 0.11, 12, 28);
  const maxPick = 28;
  const coinObjs = [];
  const hazMat = new THREE.MeshStandardMaterial({
    color: 0x7f1d1d,
    emissive: 0xff4444,
    emissiveIntensity: 0.85,
    metalness: 0.4,
    roughness: 0.35,
  });
  const hazGeo = new THREE.BoxGeometry(0.55, 1.15, 0.35);
  const hazObjs = [];
  for (let i = 0; i < maxPick; i++) {
    const c = new THREE.Mesh(coinGeo, coinMat);
    c.visible = false;
    scene.add(c);
    coinObjs.push(c);
    const h = new THREE.Mesh(hazGeo, hazMat);
    h.visible = false;
    scene.add(h);
    hazObjs.push(h);
  }

  const player = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xe8b8a8, roughness: 0.7 });
  const jacket = new THREE.MeshStandardMaterial({
    color: 0x2dd4bf,
    emissive: 0x115e59,
    emissiveIntensity: 0.25,
    metalness: 0.35,
    roughness: 0.4,
  });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1520, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.55, 6, 12), jacket);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), skin);
  head.position.y = 1.35;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  hair.position.y = 1.42;
  hair.rotation.x = -0.2;
  player.add(body, head, hair);
  player.position.set(0, 0, 0);
  scene.add(player);

  let targetPlayerX = 0;
  let baseCamX = 0;
  let baseCamY = 2.45;

  function resize(w, h) {
    const rw = Math.max(1, w);
    const rh = Math.max(1, h);
    renderer.setSize(rw, rh, false);
    camera.aspect = rw / rh;
    camera.updateProjectionMatrix();
  }

  /**
   * @param {object} state
   */
  function sync(state) {
    const {
      playerTrackPos,
      playerLane,
      scroll,
      gates,
      trackPickups,
      cameraShake,
    } = state;

    targetPlayerX = LANE_X[Math.max(0, Math.min(2, playerLane))] ?? 0;
    player.position.x += (targetPlayerX - player.position.x) * Math.min(1, 0.42);

    const run = scroll * 0.11;
    player.position.y = Math.sin(run * 2) * 0.07;
    player.rotation.z = (targetPlayerX - player.position.x) * -0.12;
    player.rotation.y = Math.sin(run) * 0.08;
    body.rotation.x = Math.sin(run * 2) * 0.15;

    const drift = (scroll * 0.06) % 8;
    grid.position.z = -45 + drift;
    road.position.z = -42 + drift * 0.85;
    leftEdge.position.z = -42 + drift * 0.85;
    rightEdge.position.z = -42 + drift * 0.85;

    pulse.intensity = 1.2 + Math.sin(performance.now() * 0.003) * 0.35;

    const sh = (cameraShake || 0) * 0.22;
    if (sh > 0.01) {
      camera.position.x = baseCamX + (Math.random() - 0.5) * sh;
      camera.position.y = baseCamY + (Math.random() - 0.5) * sh;
    } else {
      camera.position.x = baseCamX;
      camera.position.y = baseCamY;
    }

    let gi = 0;
    const gSorted = [...gates].sort((a, b) => a.at - b.at);
    for (const g of gSorted) {
      const ahead = g.at - playerTrackPos;
      if (ahead < -40 || ahead > 520) continue;
      if (gi >= gateObjs.length) break;
      const mesh = gateObjs[gi++];
      const z = -ahead * Z_SCALE;
      mesh.position.set(0, 0.45, z);
      mesh.visible = true;
    }
    for (; gi < gateObjs.length; gi++) gateObjs[gi].visible = false;

    let ci = 0;
    let hi = 0;
    const sortedP = [...trackPickups].sort((a, b) => b.at - a.at);
    for (const p of sortedP) {
      if (p.kind === "coin" && p.collected) continue;
      if (p.kind === "hazard" && p.hit) continue;
      const ahead = p.at - playerTrackPos;
      if (ahead < -50 || ahead > 520) continue;
      const z = -ahead * Z_SCALE;
      const lx = LANE_X[p.lane] ?? 0;
      if (p.kind === "coin") {
        if (ci >= coinObjs.length) continue;
        const m = coinObjs[ci++];
        m.position.set(lx, 0.55, z);
        m.rotation.x = Math.PI / 2;
        m.rotation.z = scroll * 0.08;
        m.visible = true;
      } else {
        if (hi >= hazObjs.length) continue;
        const m = hazObjs[hi++];
        m.position.set(lx, 0.58, z);
        m.visible = true;
      }
    }
    for (; ci < coinObjs.length; ci++) coinObjs[ci].visible = false;
    for (; hi < hazObjs.length; hi++) hazObjs[hi].visible = false;

    renderer.render(scene, camera);
  }

  function dispose() {
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  }

  return { sync, resize, dispose, renderer, scene, camera };
  } catch (sceneErr) {
    console.warn("WebGL scene failed, using 2D canvas:", sceneErr);
    try {
      renderer.dispose();
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
    } catch (_) {}
    return createCanvas2dTrackRenderer(container);
  }
}
