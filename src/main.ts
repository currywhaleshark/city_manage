import * as THREE from 'three';
import { TrafficSimulation } from './simulation';
import type { IntersectionNode, RoadSegment, TrafficSignal, Vec2 } from './types';
import './styles.css';

type Mode = 'road' | 'intersection' | 'signal' | 'vehicle' | 'select' | 'delete' | 'oneway';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <canvas id="city-canvas"></canvas>
  <header class="topbar">
    <div class="brand">Mini Traffic City</div>
    <button id="pauseBtn" class="icon-btn" title="Pause or resume">Pause</button>
    <label class="compact">Speed <input id="speedRange" type="range" min="0.4" max="2.5" value="1" step="0.1"></label>
    <span id="simState" class="status-pill">Running</span>
  </header>
  <aside class="toolbar">
    <button data-mode="road" class="tool active" title="Road placement">Road</button>
    <button data-mode="intersection" class="tool" title="Intersection presets">Junction</button>
    <button data-mode="signal" class="tool" title="Traffic signals">Signal</button>
    <button data-mode="vehicle" class="tool" title="Add vehicles">Vehicle</button>
    <button data-mode="select" class="tool" title="Select and edit">Select</button>
    <button data-mode="delete" class="tool danger" title="Delete roads">Delete</button>
    <button data-mode="oneway" class="tool" title="Toggle one-way">One-way</button>
    <div class="divider"></div>
    <button id="crossBtn" class="tool">Cross</button>
    <button id="tBtn" class="tool">T Road</button>
    <label>Lane <input id="laneInput" type="number" min="1" max="3" value="2"></label>
    <button id="directionBtn" class="tool">Two-way</button>
    <button id="addVehicleBtn" class="tool">Add 8 Cars</button>
    <button id="resetCityBtn" class="tool">Reset City</button>
  </aside>
  <aside id="statsPanel" class="stats-panel">
    <div class="panel-head">
      <strong>Live Stats</strong>
      <span id="fpsBadge">0 FPS</span>
    </div>
    <div id="statsGrid" class="stats-grid"></div>
    <div class="panel-head">
      <strong>Signals</strong>
      <span id="signalPhase">none</span>
    </div>
    <label>Green <input id="greenRange" type="range" min="3" max="20" value="7" step="1"></label>
    <label>Yellow <input id="yellowRange" type="range" min="1" max="6" value="2" step="1"></label>
    <button id="patternBtn">Pattern</button>
    <label class="check"><input id="syncSignals" type="checkbox"> Sync signals</label>
    <div class="panel-head">
      <strong>Congested Roads</strong>
      <span id="congestionState">Normal</span>
    </div>
    <ol id="jamList" class="jam-list"></ol>
    <button id="snapshotBtn">Save Stats</button>
    <button id="resetCompareBtn">Reset Compare</button>
    <div id="compareGrid" class="compare-grid"></div>
  </aside>
  <div class="fps" id="fpsFloat">0</div>
  <footer class="bottombar">
    <span id="modeLabel">Mode: Road placement</span>
    <span id="selectionLabel">No selection</span>
    <span id="hintLabel">Click grid cells to start/end a road. Right click deletes nearest road.</span>
  </footer>
`;

const canvas = document.querySelector<HTMLCanvasElement>('#city-canvas')!;
const sim = new TrafficSimulation();
(window as unknown as { __trafficSim: TrafficSimulation }).__trafficSim = sim;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaed8ee);
scene.fog = new THREE.Fog(0xaed8ee, 45, 95);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 180);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
(window as unknown as { __trafficDebug: unknown }).__trafficDebug = {
  roadScreenPoint: (roadId: string) => {
    const road = sim.roads.get(roadId);
    if (!road) return undefined;
    const a = sim.nodes.get(road.startNodeId)?.position;
    const b = sim.nodes.get(road.endNodeId)?.position;
    if (!a || !b) return undefined;
    return worldToScreen((a.x + b.x) / 2, (a.z + b.z) / 2);
  },
  nodeScreenPoint: (nodeId: string) => {
    const node = sim.nodes.get(nodeId);
    if (!node) return undefined;
    return worldToScreen(node.position.x, node.position.z);
  }
};
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const ambient = new THREE.HemisphereLight(0xf5fbff, 0x7b917b, 1.9);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.position.set(-18, 30, 16);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const root = new THREE.Group();
scene.add(root);
const staticRoot = new THREE.Group();
const roadRoot = new THREE.Group();
const dynamicRoot = new THREE.Group();
const overlayRoot = new THREE.Group();
root.add(staticRoot, roadRoot, overlayRoot, dynamicRoot);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tempPoint = new THREE.Vector3();

const cameraTarget = new THREE.Vector3(0, 0, 0);
let yaw = Math.PI * 0.25;
let pitch = 0.95;
let distance = 48;
let mode: Mode = 'road';
let roadStart: Vec2 | undefined;
let dragStart = new THREE.Vector2();
let draggingCamera = false;
let lastFrame = performance.now();
let fpsSmooth = 60;
let frameCounter = 0;
let lastVisualRoadHash = '';
let lastVisualSignalHash = '';
let lastDynamicHash = '';
const keys = new Set<string>();

const modeNames: Record<Mode, string> = {
  road: 'Road placement',
  intersection: 'Intersection presets',
  signal: 'Signal placement',
  vehicle: 'Vehicle add',
  select: 'Select/edit',
  delete: 'Delete',
  oneway: 'One-way toggle'
};

const statsGrid = document.querySelector<HTMLDivElement>('#statsGrid')!;
const compareGrid = document.querySelector<HTMLDivElement>('#compareGrid')!;
const jamList = document.querySelector<HTMLOListElement>('#jamList')!;
const modeLabel = document.querySelector<HTMLSpanElement>('#modeLabel')!;
const selectionLabel = document.querySelector<HTMLSpanElement>('#selectionLabel')!;
const hintLabel = document.querySelector<HTMLSpanElement>('#hintLabel')!;
const fpsBadge = document.querySelector<HTMLSpanElement>('#fpsBadge')!;
const fpsFloat = document.querySelector<HTMLDivElement>('#fpsFloat')!;
const signalPhase = document.querySelector<HTMLSpanElement>('#signalPhase')!;
const congestionState = document.querySelector<HTMLSpanElement>('#congestionState')!;
const statsPanel = document.querySelector<HTMLDivElement>('#statsPanel')!;
const pauseBtn = document.querySelector<HTMLButtonElement>('#pauseBtn')!;
const simState = document.querySelector<HTMLSpanElement>('#simState')!;
const laneInput = document.querySelector<HTMLInputElement>('#laneInput')!;
const greenRange = document.querySelector<HTMLInputElement>('#greenRange')!;
const yellowRange = document.querySelector<HTMLInputElement>('#yellowRange')!;
const speedRange = document.querySelector<HTMLInputElement>('#speedRange')!;

initStaticScene();
rebuildRoads(true);
bindUi();
resize();
requestAnimationFrame(loop);

function initStaticScene() {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({ color: 0x7fb874, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  staticRoot.add(ground);

  const grid = new THREE.GridHelper(80, 16, 0xffffff, 0xe7f0e4);
  grid.position.y = 0.015;
  staticRoot.add(grid);

  const buildingMat = [
    new THREE.MeshStandardMaterial({ color: 0xf0d7a1, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0xa9d6d0, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0xe9b4ad, roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ color: 0xc6d4f1, roughness: 0.8 })
  ];
  const reserved = new Set(['0,0', '-4,0', '4,0', '0,-4', '0,4', '-3,2', '3,-2']);
  for (let x = -7; x <= 7; x += 2) {
    for (let z = -7; z <= 7; z += 2) {
      const key = `${Math.round(x / 2)},${Math.round(z / 2)}`;
      if (reserved.has(key) || Math.random() < 0.46) continue;
      const h = 1.7 + Math.random() * 4.2;
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, h, 2.3),
        buildingMat[Math.floor(Math.random() * buildingMat.length)]
      );
      building.position.set(x * 5 + (Math.random() - 0.5) * 1.2, h / 2, z * 5 + (Math.random() - 0.5) * 1.2);
      building.castShadow = true;
      building.receiveShadow = true;
      staticRoot.add(building);
    }
  }

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8c6239, roughness: 0.8 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f9d57, roughness: 0.8 });
  for (let i = 0; i < 34; i += 1) {
    const x = (Math.random() - 0.5) * 74;
    const z = (Math.random() - 0.5) * 74;
    if (Math.abs(x) < 23 && Math.abs(z) < 23 && Math.random() < 0.6) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.9, 8), trunkMat);
    trunk.position.y = 0.45;
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.4, 10), leafMat);
    leaves.position.y = 1.45;
    tree.add(trunk, leaves);
    tree.position.set(x, 0, z);
    tree.castShadow = true;
    staticRoot.add(tree);
  }
}

function bindUi() {
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode as Mode));
  });
  document.querySelector('#crossBtn')!.addEventListener('click', () => setMode('intersection'));
  document.querySelector('#tBtn')!.addEventListener('click', () => {
    setMode('intersection');
    hintLabel.textContent = 'Click the grid to place a T road preset.';
  });
  document.querySelector('#directionBtn')!.addEventListener('click', () => {
    sim.defaultDirection = sim.defaultDirection === 'two-way' ? 'one-way' : 'two-way';
    (document.querySelector('#directionBtn') as HTMLButtonElement).textContent =
      sim.defaultDirection === 'two-way' ? 'Two-way' : 'One-way';
  });
  document.querySelector('#addVehicleBtn')!.addEventListener('click', () => {
    for (let i = 0; i < 8; i += 1) sim.addVehicle();
    updateHud();
  });
  document.querySelector('#resetCityBtn')!.addEventListener('click', () => {
    sim.seedCity();
    rebuildRoads(true);
  });
  document.querySelector('#snapshotBtn')!.addEventListener('click', () => {
    sim.saveSnapshot();
    updateHud();
  });
  document.querySelector('#resetCompareBtn')!.addEventListener('click', () => {
    sim.resetComparison();
    updateHud();
  });
  document.querySelector('#patternBtn')!.addEventListener('click', () => {
    const signalId = sim.selectedSignalId ?? [...sim.signals.keys()][0];
    if (signalId) sim.cycleSignalPattern(signalId);
    updateHud();
  });
  document.querySelector<HTMLInputElement>('#syncSignals')!.addEventListener('change', (event) => {
    sim.setSignalSync((event.currentTarget as HTMLInputElement).checked);
  });
  laneInput.addEventListener('change', () => {
    sim.defaultLaneCount = Number(laneInput.value);
    if (sim.selectedRoadId) sim.setRoadLaneCount(sim.selectedRoadId, Number(laneInput.value));
    rebuildRoads(true);
  });
  greenRange.addEventListener('input', updateSelectedSignalDurations);
  yellowRange.addEventListener('input', updateSelectedSignalDurations);
  speedRange.addEventListener('input', () => {
    sim.speedMultiplier = Number(speedRange.value);
  });
  pauseBtn.addEventListener('click', togglePause);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    distance = Math.max(18, Math.min(76, distance + event.deltaY * 0.035));
  }, { passive: false });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      statsPanel.classList.toggle('hidden');
      return;
    }
    keys.add(event.key.toLowerCase());
    if (event.key === '1') setMode('road');
    if (event.key === '2') setMode('intersection');
    if (event.key === '3') setMode('signal');
    if (event.key === '4') setMode('vehicle');
    if (event.key === '5') setMode('select');
    if (event.key === ' ') {
      event.preventDefault();
      togglePause();
    }
    if (event.key.toLowerCase() === 'r') resetCamera();
    if (event.key.toLowerCase() === 'c') {
      sim.congestionOverlay = !sim.congestionOverlay;
      rebuildRoads(true);
    }
  });
  window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
  window.addEventListener('resize', resize);
}

function setMode(next: Mode) {
  mode = next;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === next);
  });
  roadStart = undefined;
  updateHud();
}

function updateSelectedSignalDurations() {
  const signalId = sim.selectedSignalId ?? [...sim.signals.keys()][0];
  if (signalId) sim.setSignalDurations(signalId, Number(greenRange.value), Number(yellowRange.value));
}

function onPointerDown(event: PointerEvent) {
  dragStart.set(event.clientX, event.clientY);
  if (event.button === 2) {
    const p = getGroundPoint(event);
    if (p) {
      const road = sim.nearestRoad(p, 2.2);
      if (road) {
        sim.deleteRoad(road.id);
        rebuildRoads(true);
      }
    }
    return;
  }
  const p = getGroundPoint(event);
  if (mode === 'road' && p && !roadStart) {
    roadStart = sim.snap(p);
    hintLabel.textContent = 'Drag or click another grid cell to finish the road.';
  }
  draggingCamera = mode === 'select';
}

function onPointerMove(event: PointerEvent) {
  if (!draggingCamera || event.buttons === 0) return;
  yaw -= event.movementX * 0.006;
  pitch = Math.max(0.45, Math.min(1.25, pitch + event.movementY * 0.004));
}

function onPointerUp(event: PointerEvent) {
  if (event.button !== 0) return;
  const moved = dragStart.distanceTo(new THREE.Vector2(event.clientX, event.clientY));
  if (draggingCamera && moved > 4) {
    draggingCamera = false;
    return;
  }
  draggingCamera = false;
  const point = getGroundPoint(event);
  if (!point) return;
  const snapped = sim.snap(point);
  if (mode === 'road') {
    if (!roadStart) {
      roadStart = snapped;
      hintLabel.textContent = 'Click another grid cell to finish the road.';
    } else if (Math.abs(snapped.x - roadStart.x) > 0 || Math.abs(snapped.z - roadStart.z) > 0) {
      if (Math.abs(snapped.x - roadStart.x) > Math.abs(snapped.z - roadStart.z)) snapped.z = roadStart.z;
      else snapped.x = roadStart.x;
      sim.addRoad(roadStart, snapped, Number(laneInput.value), sim.defaultDirection);
      roadStart = undefined;
      rebuildRoads(true);
    }
  } else if (mode === 'intersection') {
    if (hintLabel.textContent.includes('T road')) sim.addT(snapped);
    else sim.addCross(snapped);
    rebuildRoads(true);
  } else if (mode === 'signal') {
    const node = sim.nearestNode(point, 3.2);
    if (node) {
      const signal = sim.addSignal(node.id);
      if (signal) sim.selectedSignalId = signal.id;
      rebuildRoads(true);
    }
  } else if (mode === 'vehicle') {
    const node = sim.nearestNode(point, 3.2);
    sim.addVehicle(node?.id);
  } else if (mode === 'delete') {
    const road = sim.nearestRoad(point, 2.2);
    if (road) {
      sim.deleteRoad(road.id);
      rebuildRoads(true);
    }
  } else if (mode === 'oneway') {
    const road = sim.nearestRoad(point, 2.2);
    if (road) {
      sim.toggleRoadDirection(road.id);
      rebuildRoads(true);
    }
  } else {
    const road = sim.nearestRoad(point, 2.2);
    const node = sim.nearestNode(point, 2.8);
    sim.selectedRoadId = road?.id;
    sim.selectedNodeId = node?.id;
    if (node?.signalId) sim.selectedSignalId = node.signalId;
    if (road) laneInput.value = String(road.laneCount);
  }
  updateHud();
}

function getGroundPoint(event: PointerEvent): Vec2 | undefined {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  raycaster.ray.intersectPlane(groundPlane, tempPoint);
  if (!Number.isFinite(tempPoint.x) || !Number.isFinite(tempPoint.z)) return undefined;
  return { x: tempPoint.x, z: tempPoint.z };
}

function rebuildRoads(force = false) {
  const hash = JSON.stringify({
    roads: [...sim.roads.values()].map((r) => [r.id, r.startNodeId, r.endNodeId, r.laneCount, r.direction, r.congestionLevel.toFixed(1)]),
    nodes: [...sim.nodes.values()].map((n) => [n.id, n.connectedRoadIds.length, n.signalId]),
    overlay: sim.congestionOverlay
  });
  if (!force && hash === lastVisualRoadHash) return;
  lastVisualRoadHash = hash;
  roadRoot.clear();
  overlayRoot.clear();
  sim.roads.forEach(addRoadMesh);
  sim.nodes.forEach(addNodeMesh);
  sim.signals.forEach(addSignalMesh);
}

function addRoadMesh(road: RoadSegment) {
  const a = sim.nodes.get(road.startNodeId)?.position;
  const b = sim.nodes.get(road.endNodeId)?.position;
  if (!a || !b) return;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  const width = 1.8 + road.laneCount * 0.75;
  const color = sim.congestionOverlay ? congestionColor(road.congestionLevel) : 0x30343a;
  const roadMesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, 0.08, len),
    new THREE.MeshStandardMaterial({ color, roughness: 0.72 })
  );
  roadMesh.position.set((a.x + b.x) / 2, 0.08, (a.z + b.z) / 2);
  roadMesh.rotation.y = Math.atan2(dx, dz);
  roadMesh.receiveShadow = true;
  roadRoot.add(roadMesh);

  for (let lane = 1; lane < road.laneCount; lane += 1) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.02, len - 0.7),
      new THREE.MeshBasicMaterial({ color: 0xf5e8a0 })
    );
    stripe.position.copy(roadMesh.position);
    stripe.position.y = 0.15;
    stripe.rotation.y = roadMesh.rotation.y;
    const offset = (lane / road.laneCount - 0.5) * width;
    stripe.translateX(offset);
    roadRoot.add(stripe);
  }

  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xc9ced2, roughness: 0.9 });
  [-1, 1].forEach((side) => {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.09, len), sidewalkMat);
    walk.position.copy(roadMesh.position);
    walk.position.y = 0.1;
    walk.rotation.y = roadMesh.rotation.y;
    walk.translateX(side * (width / 2 + 0.36));
    roadRoot.add(walk);
  });

  if (road.direction === 'one-way') {
    const arrow = makeArrow();
    arrow.position.set((a.x + b.x) / 2, 0.28, (a.z + b.z) / 2);
    arrow.rotation.y = Math.atan2(dx, dz);
    roadRoot.add(arrow);
  }

  if (sim.congestionOverlay && road.stoppedCount > 1) {
    const pulse = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.45, 0.05, Math.min(5, len)),
      new THREE.MeshBasicMaterial({ color: 0xff4f4f, transparent: true, opacity: 0.42 })
    );
    pulse.position.copy(roadMesh.position);
    pulse.position.y = 0.24;
    pulse.rotation.y = roadMesh.rotation.y;
    overlayRoot.add(pulse);
  }
}

function addNodeMesh(node: IntersectionNode) {
  const radius = node.type === 'cross' ? 2.25 : node.type === 't' ? 1.95 : 1.55;
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 0.11, 24),
    new THREE.MeshStandardMaterial({ color: node.signalId ? 0x40464f : 0x383d44, roughness: 0.7 })
  );
  mesh.position.set(node.position.x, 0.16, node.position.z);
  roadRoot.add(mesh);
  if (node.connectedRoadIds.length >= 3) {
    for (let i = 0; i < 4; i += 1) {
      const crosswalk = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.03, 0.16),
        new THREE.MeshBasicMaterial({ color: 0xf7f7f2 })
      );
      crosswalk.position.set(node.position.x, 0.27, node.position.z);
      crosswalk.rotation.y = (Math.PI / 2) * i;
      crosswalk.translateZ(1.95);
      roadRoot.add(crosswalk);
    }
  }
}

function addSignalMesh(signal: TrafficSignal) {
  const node = sim.nodes.get(signal.intersectionId);
  if (!node) return;
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x24272d, roughness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.5, 8), poleMat);
  pole.position.y = 1.25;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.9, 0.35), poleMat);
  box.position.y = 2.45;
  group.add(pole, box);
  const activeNS = signal.phase.startsWith('ns');
  const isYellow = signal.phase.endsWith('yellow');
  const redMat = new THREE.MeshBasicMaterial({ color: !isYellow && !activeNS ? 0xff2f2f : 0x4a1515 });
  const yellowMat = new THREE.MeshBasicMaterial({ color: isYellow ? 0xffe05a : 0x47390e });
  const greenMat = new THREE.MeshBasicMaterial({ color: !isYellow && activeNS ? 0x3cff7f : 0x10441f });
  [
    [redMat, 2.72],
    [yellowMat, 2.45],
    [greenMat, 2.18]
  ].forEach(([mat, y]) => {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 8), mat as THREE.Material);
    bulb.position.set(0, y as number, 0.19);
    group.add(bulb);
  });
  const ped = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.28, 0.14),
    new THREE.MeshBasicMaterial({ color: activeNS ? 0x67ff9b : 0xff625c })
  );
  ped.position.set(-0.42, 1.65, 0.08);
  group.add(ped);
  group.position.set(node.position.x + 1.9, 0.18, node.position.z + 1.9);
  roadRoot.add(group);
}

function updateSignalsVisual() {
  const hash = [...sim.signals.values()].map((s) => `${s.id}:${s.phase}`).join('|');
  if (hash === lastVisualSignalHash) return;
  lastVisualSignalHash = hash;
  rebuildRoads(true);
}

function rebuildDynamic() {
  const hash = `${sim.vehicles.size}:${Math.floor(sim.time * 10)}:${sim.paused}`;
  if (hash === lastDynamicHash) return;
  lastDynamicHash = hash;
  dynamicRoot.clear();
  sim.vehicles.forEach((vehicle) => {
    const p = sim.getRoadWorldPosition(vehicle);
    const car = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.34, vehicle.length),
      new THREE.MeshStandardMaterial({ color: vehicle.color, roughness: 0.48, metalness: 0.05 })
    );
    body.position.y = 0.42;
    body.castShadow = true;
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.28, vehicle.length * 0.44),
      new THREE.MeshStandardMaterial({ color: 0x253243, roughness: 0.4 })
    );
    cabin.position.y = 0.74;
    cabin.position.z = -vehicle.length * 0.08;
    car.add(body, cabin);
    car.position.set(p.x, 0.16, p.z);
    car.rotation.y = p.angle;
    dynamicRoot.add(car);
  });
  sim.pedestrians.forEach((ped) => {
    const node = sim.nodes.get(ped.nodeId);
    if (!node) return;
    const walkPhase = Math.sin(ped.phase);
    const person = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.16, 0.38, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x2c5aa0, roughness: 0.6 })
    );
    body.position.y = 0.65;
    person.add(body);
    person.position.set(node.position.x + walkPhase * 1.3, 0.18, node.position.z - 1.8);
    dynamicRoot.add(person);
  });
}

function makeArrow() {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 1.2), mat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.62, 3), mat);
  head.rotation.x = Math.PI / 2;
  head.position.z = 0.72;
  group.add(shaft, head);
  return group;
}

function congestionColor(value: number) {
  if (value < 0.38) return 0x2cbf66;
  if (value < 0.68) return 0xe9c744;
  return 0xe35245;
}

function loop(now: number) {
  const rawDt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  fpsSmooth = fpsSmooth * 0.92 + (1 / Math.max(rawDt, 0.001)) * 0.08;
  moveCamera(rawDt);
  sim.update(rawDt, fpsSmooth);
  frameCounter += 1;
  if (frameCounter % 6 === 0) {
    rebuildRoads();
    updateSignalsVisual();
    updateHud();
  }
  rebuildDynamic();
  updateCameraPosition();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

function moveCamera(dt: number) {
  const speed = 17 * dt;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  if (keys.has('w') || keys.has('arrowup')) cameraTarget.addScaledVector(forward, speed);
  if (keys.has('s') || keys.has('arrowdown')) cameraTarget.addScaledVector(forward, -speed);
  if (keys.has('d') || keys.has('arrowright')) cameraTarget.addScaledVector(right, speed);
  if (keys.has('a') || keys.has('arrowleft')) cameraTarget.addScaledVector(right, -speed);
}

function updateCameraPosition() {
  const y = Math.sin(pitch) * distance;
  const flat = Math.cos(pitch) * distance;
  camera.position.set(
    cameraTarget.x + Math.sin(yaw) * flat,
    y,
    cameraTarget.z + Math.cos(yaw) * flat
  );
  camera.lookAt(cameraTarget);
}

function worldToScreen(x: number, z: number) {
  updateCameraPosition();
  const rect = canvas.getBoundingClientRect();
  const vector = new THREE.Vector3(x, 0.25, z).project(camera);
  return {
    x: rect.left + ((vector.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - vector.y) / 2) * rect.height
  };
}

function resetCamera() {
  cameraTarget.set(0, 0, 0);
  yaw = Math.PI * 0.25;
  pitch = 0.95;
  distance = 48;
}

function togglePause() {
  sim.paused = !sim.paused;
  updateHud();
}

function updateHud() {
  modeLabel.textContent = `Mode: ${modeNames[mode]}`;
  pauseBtn.textContent = sim.paused ? 'Resume' : 'Pause';
  simState.textContent = sim.paused ? 'Paused' : `Running ${sim.speedMultiplier.toFixed(1)}x`;
  congestionState.textContent = sim.congestionOverlay ? 'Overlay ON' : 'Normal';
  const selectedRoad = sim.selectedRoadId ? sim.roads.get(sim.selectedRoadId) : undefined;
  const selectedNode = sim.selectedNodeId ? sim.nodes.get(sim.selectedNodeId) : undefined;
  selectionLabel.textContent = selectedRoad
    ? `${selectedRoad.id}: ${selectedRoad.laneCount} lane, ${selectedRoad.direction}`
    : selectedNode
      ? `${selectedNode.type} intersection`
      : 'No selection';
  if (mode !== 'road' || !roadStart) {
    hintLabel.textContent =
      mode === 'road' ? 'Click grid cells to start/end a road. Right click deletes nearest road.' :
      mode === 'intersection' ? 'Click the grid for a cross preset. Use T Road for a T preset.' :
      mode === 'signal' ? 'Click an intersection to add/select a signal.' :
      mode === 'vehicle' ? 'Click near a node to spawn a vehicle, or use Add 8 Cars.' :
      mode === 'oneway' ? 'Click a road to toggle one-way/two-way.' :
      mode === 'delete' ? 'Click or right click a road to delete it.' :
      'Click roads/nodes to edit. Drag rotates camera.';
  }

  const stats = sim.stats;
  const statRows = [
    ['Avg travel', `${stats.averageTravelTime.toFixed(1)}s`],
    ['Avg wait', `${stats.averageWaitingTime.toFixed(1)}s`],
    ['Throughput', `${stats.throughput}`],
    ['Jam length', `${stats.congestionLength.toFixed(1)}m`],
    ['Avg speed', `${stats.averageSpeed.toFixed(1)}m/s`],
    ['Vehicles', `${stats.currentVehicleCount}`],
    ['Stopped', `${stats.stoppedVehicleCount}`],
    ['FPS', `${stats.fps.toFixed(0)}`]
  ];
  statsGrid.innerHTML = statRows.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
  fpsBadge.textContent = `${stats.fps.toFixed(0)} FPS`;
  fpsFloat.textContent = stats.fps.toFixed(0);

  const signal = sim.selectedSignalId ? sim.signals.get(sim.selectedSignalId) : [...sim.signals.values()][0];
  if (signal) {
    signalPhase.textContent = `${signal.phase} / ${signal.pattern}`;
    greenRange.value = String(Math.round(signal.greenDuration));
    yellowRange.value = String(Math.round(signal.yellowDuration));
  } else {
    signalPhase.textContent = 'none';
  }

  const jams = [...sim.roads.values()].sort((a, b) => b.congestionLevel - a.congestionLevel).slice(0, 5);
  jamList.innerHTML = jams
    .map((road) => `<li><span>${road.id}</span><meter min="0" max="1" value="${road.congestionLevel.toFixed(2)}"></meter></li>`)
    .join('');

  if (sim.comparison) {
    compareGrid.innerHTML = Object.entries(sim.comparison)
      .map(([label, value]) => {
        const good = value >= 0;
        return `<div class="${good ? 'good' : 'bad'}"><span>${label}</span><strong>${value >= 0 ? '+' : ''}${value.toFixed(0)}%</strong></div>`;
      })
      .join('');
  } else {
    compareGrid.innerHTML = '<p class="muted">No snapshot saved.</p>';
  }
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
