/* ═══════════════════════════════════════════════════
   NAVINT — app.js
   Navigation intérieure — logique complète conservée
   + nouveau système UI mobile-first
═══════════════════════════════════════════════════ */

// === Paramètres ===
const POINT_RADIUS_PX   = 4;
const HIT_RADIUS_PX     = 12;
const DELETE_TOLERANCE_PX = 18;
const ZOOM_MIN = 0.25, ZOOM_MAX = 4, ZOOM_STEP = 1.2, WHEEL_SENS = 0.0015;

// === États ===
let nodes = [];
let edges = [];
let edgeMode = false;
let deleteByClickMode = false;
let lastClickedPointId = null;
let selectedPointId = null;
let PLAN_W = 0, PLAN_H = 0;
let cam = { s: 1, tx: 0, ty: 0 };
let isPanning = false;
let panStart = { x: 0, y: 0, tx: 0, ty: 0 };
let panWithSpace = false;
let mPerUnit = null;
let editMode = false;
let currentPathIds = null;
let showWaypoints = false; // waypoints visibles uniquement en mode édition

// === DOM ===
const planImage    = document.getElementById('plan-image');
const svg          = document.getElementById('scene');
const pointsLayer  = document.getElementById('points-layer');
const edgesLayer   = document.getElementById('edges-layer');
const pathLayer    = document.getElementById('path-layer');
const edgeHighlight = document.getElementById('edge-highlight');
const viewport     = document.getElementById('viewport');
const camera       = document.getElementById('camera');

const poiNameInput       = document.getElementById('poiName');
const btnEdgeMode        = document.getElementById('toggleEdgeMode');
const btnDeleteEdgeMode  = document.getElementById('toggleDeleteEdgeMode');
const btnDeleteLastPoint = document.getElementById('deleteLastPoint');
const btnDeleteLastEdge  = document.getElementById('deleteLastEdge');
const btnClearAllEdges   = document.getElementById('clearAllEdges');
const btnExportJson      = document.getElementById('exportJson');
const importInput        = document.getElementById('importFile');
const btnImport          = document.getElementById('importBtn');

const startSelect     = document.getElementById('startSelect');
const endSelect       = document.getElementById('endSelect');
const routeDistanceEl = document.getElementById('routeDistance');
const routeStepsEl    = document.getElementById('routeSteps');
const scaleDistanceInput = document.getElementById('scaleDistance');
const scaleLabelEl    = document.getElementById('scaleLabel');
const zoomLabel       = document.getElementById('zoomLabel');
const modeBadge       = document.getElementById('modeBadge');
const editModeBtn     = document.getElementById('editModeBtn');

// ─── Toast System ─────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.className = 'toast';
  }, 2800);
}

// ─── Utilitaires ──────────────────────────────────
function slugify(s) {
  return (s || 'point')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'point';
}
function uniqueIdFromName(name) {
  const base = slugify(name);
  if (!nodes.some(n => n.id === base)) return base;
  let i = 2;
  while (nodes.some(n => n.id === base + '_' + i)) i++;
  return base + '_' + i;
}
function getNodeById(id) { return nodes.find(n => n.id === id); }
function isWaypoint(n) { return n.type === 'waypoint'; }
function isPoi(n) { return !isWaypoint(n); }
function formatMeters(m) {
  if (!isFinite(m)) return '—';
  if (m < 1000) return Math.round(m) + ' m';
  return (m / 1000).toFixed(2) + ' km';
}
function clientToPlan(clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const p = pt.matrixTransform(ctm.inverse());
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

// ─── Camera ───────────────────────────────────────
function applyCamera() {
  const { s, tx, ty } = cam;
  camera.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  zoomLabel.textContent = Math.round(s * 100) + '%';
}
function zoomAt(clientX, clientY, factor) {
  const rect = svg.getBoundingClientRect();
  const xRoot = clientX - rect.left, yRoot = clientY - rect.top;
  const xPlan = (xRoot - cam.tx) / cam.s, yPlan = (yRoot - cam.ty) / cam.s;
  const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.s * factor));
  cam.tx = xRoot - ns * xPlan;
  cam.ty = yRoot - ns * yPlan;
  cam.s = ns;
  applyCamera();
}
function startPan(clientX, clientY) {
  isPanning = true;
  viewport.classList.add('grabbing');
  const rect = svg.getBoundingClientRect();
  panStart = { x: clientX - rect.left, y: clientY - rect.top, tx: cam.tx, ty: cam.ty };
}
function continuePan(clientX, clientY) {
  if (!isPanning) return;
  const rect = svg.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  cam.tx = panStart.tx + (x - panStart.x);
  cam.ty = panStart.ty + (y - panStart.y);
  applyCamera();
}
function endPan() {
  isPanning = false;
  viewport.classList.remove('grabbing');
}

// ─── Dessin ───────────────────────────────────────
function drawPoints() {
  pointsLayer.innerHTML = '';
  const r = POINT_RADIUS_PX, haloR = r * 2.5;
  const onPath = new Set(currentPathIds || []);

  nodes.forEach(n => {
    const waypoint = isWaypoint(n);

    // En mode navigation : les waypoints sont invisibles SAUF s'ils sont sur le chemin actif
    if (!editMode && waypoint && !onPath.has(n.id)) return;

    // En mode édition sans showWaypoints : waypoints discrets mais présents
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    let cls = 'poi-node';
    if (waypoint)              cls += ' waypoint';
    if (n.id === selectedPointId) cls += ' selected';
    if (onPath.has(n.id))     cls += ' on-path';
    g.setAttribute('class', cls);

    // Zone de clic (toujours présente en édition, réduite pour waypoints sinon)
    const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hit.setAttribute('r', editMode ? HIT_RADIUS_PX : (waypoint ? 0 : HIT_RADIUS_PX));
    hit.setAttribute('class', 'hit');

    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    halo.setAttribute('r', haloR);
    halo.setAttribute('class', 'halo');

    // Point visuel — waypoint = petit point discret, poi = point normal
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const visR = waypoint ? (editMode ? 2 : 0) : r;
    c.setAttribute('r', visR);
    c.setAttribute('class', 'base');

    // Label — masqué pour les waypoints sauf si sélectionné
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.textContent = n.name;
    t.setAttribute('class', 'poi-label' + (waypoint && !(n.id === selectedPointId) ? ' label-hidden' : ''));
    t.setAttribute('x', r * 2 + 4);
    t.setAttribute('y', 0);

    g.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!editMode && !edgeMode) {
        selectedPointId = n.id;
        drawPoints();
        return;
      }
      onPointClick(n.id);
    });

    g.appendChild(hit); g.appendChild(halo); g.appendChild(c); g.appendChild(t);
    pointsLayer.appendChild(g);
  });
}

function drawEdges() {
  edgesLayer.innerHTML = '';
  edges.forEach(e => {
    const n1 = getNodeById(e.from), n2 = getNodeById(e.to);
    if (!n1 || !n2) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', n1.x); line.setAttribute('y1', n1.y);
    line.setAttribute('x2', n2.x); line.setAttribute('y2', n2.y);
    line.setAttribute('class', 'edge');
    edgesLayer.appendChild(line);
  });
}

function drawPath(pathIds) {
  currentPathIds = pathIds;
  pathLayer.innerHTML = '';
  if (!pathIds || pathIds.length < 2) return;
  let d = '';
  pathIds.forEach((id, i) => {
    const n = getNodeById(id);
    if (!n) return;
    d += (i === 0 ? 'M' : 'L') + n.x + ' ' + n.y + ' ';
  });
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d.trim());
  p.setAttribute('class', 'path');
  pathLayer.appendChild(p);
  drawPoints(); // refresh pour coloriser les points sur le chemin
}

// ─── Sélection couloirs ───────────────────────────
function onPointClick(id) {
  if (!editMode) return;
  if (deleteByClickMode) return;

  if (edgeMode) {
    selectedPointId = id;
    drawPoints();
    if (!lastClickedPointId) { lastClickedPointId = id; return; }
    if (lastClickedPointId !== id) {
      addEdge(lastClickedPointId, id);
      lastClickedPointId = null;
      selectedPointId = null;
      drawEdges(); drawPoints();
      return;
    }
    lastClickedPointId = null;
    selectedPointId = null;
    drawPoints();
    return;
  }

  selectedPointId = id;
  drawPoints();
}

function addEdge(a, b) {
  if (a === b) return;
  const exists = edges.some(e => (e.from === a && e.to === b) || (e.from === b && e.to === a));
  if (!exists) edges.push({ from: a, to: b });
}

// ─── Clic scène ───────────────────────────────────
svg.addEventListener('click', ev => {
  if (!editMode) return;
  if (deleteByClickMode) {
    const { x, y } = clientToPlan(ev.clientX, ev.clientY);
    const hit = findClosestEdge(x, y, DELETE_TOLERANCE_PX);
    if (hit) { removeEdge(hit.a, hit.b); hideEdgeHighlight(); }
    return;
  }
  const raw = poiNameInput.value.trim();
  const name = raw || `point_${nodes.length + 1}`;
  const { x, y } = clientToPlan(ev.clientX, ev.clientY);
  const id = uniqueIdFromName(name);
  // Si le nom commence par 'point_' ou est vide → waypoint automatiquement
  const autoWaypoint = !raw || raw.toLowerCase().startsWith('point_') || raw.toLowerCase().startsWith('wp_');
  nodes.push({ id, name, x, y, type: autoWaypoint ? 'waypoint' : 'poi' });
  poiNameInput.value = '';
  drawPoints(); refreshSelectOptions();
});

svg.addEventListener('mousemove', ev => {
  if (!editMode || !deleteByClickMode) { hideEdgeHighlight(); return; }
  const { x, y } = clientToPlan(ev.clientX, ev.clientY);
  const hit = findClosestEdge(x, y, DELETE_TOLERANCE_PX);
  if (hit && hit.n1 && hit.n2) showEdgeHighlight(hit.n1.x, hit.n1.y, hit.n2.x, hit.n2.y);
  else hideEdgeHighlight();
});

// ─── Gomme helpers ────────────────────────────────
function distancePointToSegment(px, py, x1, y1, x2, y2) {
  const ABx = x2 - x1, ABy = y2 - y1, APx = px - x1, APy = py - y1;
  const ab2 = ABx * ABx + ABy * ABy;
  if (ab2 === 0) return Math.hypot(px - x1, py - y1);
  let t = (APx * ABx + APy * ABy) / ab2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * ABx), py - (y1 + t * ABy));
}
function findClosestEdge(x, y, thresholdPx = 18) {
  let best = { i: -1, d: Infinity, a: null, b: null, n1: null, n2: null };
  edges.forEach((e, i) => {
    const n1 = getNodeById(e.from), n2 = getNodeById(e.to);
    if (!n1 || !n2) return;
    const d = distancePointToSegment(x, y, n1.x, n1.y, n2.x, n2.y);
    if (d < best.d) best = { i, d, a: e.from, b: e.to, n1, n2 };
  });
  return (best.i >= 0 && best.d <= thresholdPx) ? best : null;
}
function removeEdge(a, b) {
  const before = edges.length;
  edges = edges.filter(e => !((e.from === a && e.to === b) || (e.from === b && e.to === a)));
  if (edges.length !== before) drawEdges();
}
function showEdgeHighlight(x1, y1, x2, y2) {
  edgeHighlight.setAttribute('x1', x1); edgeHighlight.setAttribute('y1', y1);
  edgeHighlight.setAttribute('x2', x2); edgeHighlight.setAttribute('y2', y2);
  edgeHighlight.style.display = 'block';
}
function hideEdgeHighlight() { edgeHighlight.style.display = 'none'; }

// ─── Boutons édition ──────────────────────────────
btnEdgeMode.onclick = () => {
  if (!editMode) return;
  edgeMode = !edgeMode;
  if (edgeMode) { deleteByClickMode = false; btnDeleteEdgeMode.classList.remove('active'); svg.classList.remove('gomme'); }
  lastClickedPointId = null; selectedPointId = null; drawPoints();
  btnEdgeMode.classList.toggle('active', edgeMode);
  showToast(edgeMode ? 'Mode couloir activé — cliquez 2 points' : 'Mode couloir désactivé');
};
btnDeleteEdgeMode.onclick = () => {
  if (!editMode) return;
  deleteByClickMode = !deleteByClickMode;
  if (deleteByClickMode) {
    edgeMode = false; btnEdgeMode.classList.remove('active');
    svg.classList.add('gomme'); lastClickedPointId = null; selectedPointId = null; drawPoints();
  } else { svg.classList.remove('gomme'); hideEdgeHighlight(); }
  btnDeleteEdgeMode.classList.toggle('active', deleteByClickMode);
  showToast(deleteByClickMode ? 'Gomme activée — cliquez sur un couloir' : 'Gomme désactivée');
};
btnDeleteLastEdge.onclick = () => { if (!editMode) return; edges.pop(); drawEdges(); showToast('Dernier couloir supprimé'); };
btnClearAllEdges.onclick = () => {
  if (!editMode) return;
  if (confirm('Supprimer tous les couloirs ?')) { edges = []; drawEdges(); showToast('Tous les couloirs supprimés', 'error'); }
};
btnDeleteLastPoint.onclick = () => {
  if (!editMode) return;
  const last = nodes.pop();
  if (last) { edges = edges.filter(e => e.from !== last.id && e.to !== last.id); showToast(`"${last.name}" supprimé`); }
  drawPoints(); drawEdges(); refreshSelectOptions();
};
document.getElementById('deleteSelectedPoint').onclick = () => {
  if (!editMode) return showToast('Passe en mode ÉDITION', 'error');
  deletePoint(selectedPointId);
};

// ─── Bascule poi ↔ waypoint du point sélectionné ──
document.getElementById('toggleWaypointType').onclick = () => {
  if (!editMode) return;
  if (!selectedPointId) return showToast('Sélectionne un point d\'abord', 'error');
  const n = getNodeById(selectedPointId);
  if (!n) return;
  n.type = isWaypoint(n) ? 'poi' : 'waypoint';
  drawPoints(); refreshSelectOptions();
  showToast(isWaypoint(n) ? `"${n.name}" → Waypoint (passage)` : `"${n.name}" → POI (destination)`, 'success');
};

// ─── Afficher/masquer les waypoints en édition ────
document.getElementById('toggleWaypointsVisibility').onclick = () => {
  if (!editMode) return;
  showWaypoints = !showWaypoints;
  document.getElementById('toggleWaypointsVisibility').classList.toggle('active', showWaypoints);
  drawPoints();
  showToast(showWaypoints ? 'Waypoints visibles' : 'Waypoints masqués');
};

function deletePoint(id) {
  if (!id) return showToast('Aucun point sélectionné', 'error');
  const node = getNodeById(id);
  edges = edges.filter(e => e.from !== id && e.to !== id);
  nodes = nodes.filter(n => n.id !== id);
  if (selectedPointId === id) selectedPointId = null;
  drawPoints(); drawEdges(); refreshSelectOptions();
  showToast(`"${node ? node.name : id}" supprimé`);
}

// ─── Sélecteurs POI ───────────────────────────────
function refreshSelectOptions() {
  [startSelect, endSelect].forEach(sel => {
    const old = sel.value;
    sel.innerHTML = "<option value=''>Choisir un point...</option>";
    // On n'affiche que les POI (pas les waypoints) dans les sélecteurs
    nodes.filter(isPoi).forEach(n => {
      const o = document.createElement('option');
      o.value = n.id; o.textContent = n.name;
      sel.appendChild(o);
    });
    if ([...(sel.options)].some(o => o.value === old)) sel.value = old;
  });
}

// ─── Dijkstra ─────────────────────────────────────
function euclid(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function buildAdjacency() {
  const adj = new Map();
  nodes.forEach(n => adj.set(n.id, []));
  edges.forEach(e => {
    const n1 = getNodeById(e.from), n2 = getNodeById(e.to);
    if (!n1 || !n2) return;
    const w = euclid(n1, n2);
    adj.get(e.from).push({ to: e.to, w });
    adj.get(e.to).push({ to: e.from, w });
  });
  return adj;
}
function dijkstra(startId, endId) {
  const adj = buildAdjacency();
  const dist = new Map(), prev = new Map(), visited = new Set();
  nodes.forEach(n => dist.set(n.id, Infinity));
  dist.set(startId, 0);
  while (visited.size < nodes.length) {
    let u = null, best = Infinity;
    dist.forEach((d, id) => { if (!visited.has(id) && d < best) { best = d; u = id; } });
    if (!u) break;
    visited.add(u);
    if (u === endId) break;
    (adj.get(u) || []).forEach(({ to, w }) => {
      if (visited.has(to)) return;
      const alt = dist.get(u) + w;
      if (alt < dist.get(to)) { dist.set(to, alt); prev.set(to, u); }
    });
  }
  if (!prev.has(endId) && startId !== endId) return null;
  const path = [];
  let cur = endId;
  while (cur) { path.push(cur); if (cur === startId) break; cur = prev.get(cur); }
  return path.reverse();
}

// ─── Panneau itinéraire ───────────────────────────
function signedAngleDeg(ax, ay, bx, by) {
  const dot = ax * bx + ay * by;
  const det = -(ax * by - ay * bx);
  return Math.atan2(det, dot) * 180 / Math.PI;
}
function turnPhrase(deg) {
  const aa = Math.abs(deg);
  if (aa >= 150) return 'faire demi-tour';
  if (deg > 30)  return 'tourner à gauche';
  if (deg < -30) return 'tourner à droite';
  return 'continuer tout droit';
}
function turnIcon(deg) {
  const aa = Math.abs(deg);
  if (aa >= 150) return '↩';
  if (deg > 30)  return '↰';
  if (deg < -30) return '↱';
  return '↑';
}

function updateRoutePanel(pathIds) {
  routeStepsEl.innerHTML = '';
  const resultBox = document.getElementById('route-result');

  if (!pathIds || pathIds.length < 2) {
    routeDistanceEl.textContent = '—';
    resultBox.classList.add('hidden');
    return;
  }

  const pts = pathIds.map(id => getNodeById(id)).filter(Boolean);
  const segLen = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = euclid(pts[i], pts[i + 1]);
    segLen.push(d); total += d;
  }

  const distStr = mPerUnit ? formatMeters(total * mPerUnit) : total.toFixed(0) + ' unités';
  routeDistanceEl.textContent = '📍 ' + distStr;

  const THRESH = 40;
  const coarseIdx = [0];
  const coarseDist = [];
  let i = 0;
  while (i < pts.length - 1) {
    let run = segLen[i], j = i;
    while (j < pts.length - 2 && segLen[j] < THRESH) { j++; run += segLen[j]; }
    coarseDist.push(run);
    coarseIdx.push(j + 1);
    i = j + 1;
  }

  const start = pts[0], end = pts[pts.length - 1];

  if (start) {
    const li = document.createElement('li');
    li.className = 'step-start';
    li.innerHTML = `<strong>Départ :</strong> ${start.name}`;
    routeStepsEl.appendChild(li);
  }

  for (let k = 0; k < coarseIdx.length - 1; k++) {
    const aIdx = coarseIdx[k], bIdx = coarseIdx[k + 1];
    const A = pts[aIdx], B = pts[bIdx];
    const distPlan = coarseDist[k];
    const distLabel = mPerUnit ? formatMeters(distPlan * mPerUnit) : (distPlan.toFixed(0) + ' unités');
    const li = document.createElement('li');

    if (k === 0) {
      li.innerHTML = `<strong>Aller</strong> vers ${B.name} — ${distLabel}`;
    } else {
      const P = pts[coarseIdx[k - 1]], C = pts[coarseIdx[k]];
      const v1x = C.x - P.x, v1y = C.y - P.y, v2x = B.x - C.x, v2y = B.y - C.y;
      const deg = signedAngleDeg(v1x, v1y, v2x, v2y);
      const phrase = turnPhrase(deg);
      const icon = turnIcon(deg);
      li.className = 'step-turn';
      li.innerHTML = `${icon} À <strong>${C.name}</strong>, ${phrase} → ${B.name} — ${distLabel}`;
    }
    routeStepsEl.appendChild(li);
  }

  if (end) {
    const li = document.createElement('li');
    li.className = 'step-end';
    li.innerHTML = `<strong>Arrivée :</strong> ${end.name}`;
    routeStepsEl.appendChild(li);
  }

  resultBox.classList.remove('hidden');
}

// ─── Bouton calcul ────────────────────────────────
document.getElementById('computeRoute').onclick = () => {
  const s = startSelect.value, t = endSelect.value;
  if (!s || !t) return showToast('Sélectionne un départ et une arrivée', 'error');
  if (s === t) return showToast('Départ et arrivée identiques', 'error');
  const path = dijkstra(s, t);
  if (!path) {
    showToast('Aucun chemin trouvé', 'error');
    drawPath([]); updateRoutePanel(null);
  } else {
    drawPath(path); updateRoutePanel(path);
    showToast('Itinéraire calculé ✓', 'success');
  }
};

// Bouton effacer itinéraire
document.getElementById('clearRouteBtn').onclick = () => {
  drawPath([]); updateRoutePanel(null);
};

// Bouton swap départ/arrivée
document.getElementById('swapBtn').onclick = () => {
  const a = startSelect.value, b = endSelect.value;
  startSelect.value = b; endSelect.value = a;
};

// ─── Échelle ──────────────────────────────────────
document.getElementById('defineScaleBtn').onclick = () => {
  if (!editMode) return showToast('Passe en mode édition', 'error');
  const aId = startSelect.value, bId = endSelect.value;
  if (!aId || !bId) return showToast('Sélectionne 2 points', 'error');
  const A = getNodeById(aId), B = getNodeById(bId);
  if (!A || !B) return showToast('Points invalides', 'error');
  const planDist = euclid(A, B);
  if (!(planDist > 0)) return showToast('Distance nulle entre ces points', 'error');
  const realMeters = parseFloat(scaleDistanceInput.value);
  if (!(realMeters > 0)) return showToast('Entrez une distance positive', 'error');
  mPerUnit = realMeters / planDist;
  scaleLabelEl.textContent = `1 u = ${mPerUnit.toFixed(4)} m`;
  showToast('Échelle définie ✓', 'success');
  if (startSelect.value && endSelect.value) {
    const path = dijkstra(startSelect.value, endSelect.value);
    if (path) updateRoutePanel(path);
  }
};

// ─── Import / Export ──────────────────────────────
btnExportJson.onclick = () => {
  const data = { nodes, edges, meta: { planW: PLAN_W, planH: PLAN_H, scale_m_per_unit: mPerUnit ?? null } };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'plan_graph.json'; a.click();
  URL.revokeObjectURL(url);
  showToast('JSON exporté ✓', 'success');
};
btnImport.onclick = async () => {
  const f = importInput.files[0];
  if (!f) return showToast('Choisis un fichier JSON', 'error');
  try {
    const data = JSON.parse(await f.text());
    loadGraph(data);
    showToast('Graphe importé ✓', 'success');
  } catch (e) {
    showToast('Erreur : fichier JSON invalide', 'error');
  }
};

// ─── Zoom & Pan ───────────────────────────────────
document.getElementById('zoomInBtn').onclick = () => {
  const rect = svg.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, ZOOM_STEP);
};
document.getElementById('zoomOutBtn').onclick = () => {
  const rect = svg.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / ZOOM_STEP);
};
document.getElementById('zoomResetBtn').onclick = () => { cam = { s: 1, tx: 0, ty: 0 }; applyCamera(); };

viewport.addEventListener('wheel', ev => {
  ev.preventDefault();
  const factor = ev.deltaY < 0
    ? Math.max(1.05, 1 + Math.abs(ev.deltaY) * WHEEL_SENS)
    : Math.min(0.95, 1 - Math.abs(ev.deltaY) * WHEEL_SENS);
  zoomAt(ev.clientX, ev.clientY, factor);
}, { passive: false });

window.addEventListener('keydown', e => { if (e.code === 'Space') { panWithSpace = true; viewport.classList.add('grab'); } });
window.addEventListener('keyup',   e => { if (e.code === 'Space') { panWithSpace = false; viewport.classList.remove('grab'); if (isPanning) endPan(); } });
viewport.addEventListener('mousedown', e => { if (e.button === 1 || panWithSpace) { e.preventDefault(); startPan(e.clientX, e.clientY); } });
window.addEventListener('mousemove', e => { if (isPanning) continuePan(e.clientX, e.clientY); });
window.addEventListener('mouseup', () => { if (isPanning) endPan(); });

// ─── Touch pan ────────────────────────────────────
let touchStart = null;
viewport.addEventListener('touchstart', e => {
  if (e.touches.length === 1) {
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: cam.tx, ty: cam.ty };
  }
}, { passive: true });
viewport.addEventListener('touchmove', e => {
  if (e.touches.length === 1 && touchStart) {
    e.preventDefault();
    const dx = e.touches[0].clientX - touchStart.x;
    const dy = e.touches[0].clientY - touchStart.y;
    cam.tx = touchStart.tx + dx;
    cam.ty = touchStart.ty + dy;
    applyCamera();
  }
}, { passive: false });
viewport.addEventListener('touchend', () => { touchStart = null; });

// ─── Touch pinch zoom ─────────────────────────────
let lastPinchDist = null;
viewport.addEventListener('touchmove', e => {
  if (e.touches.length === 2) {
    e.preventDefault();
    const d = Math.hypot(
      e.touches[0].clientX - e.touches[1].clientX,
      e.touches[0].clientY - e.touches[1].clientY
    );
    if (lastPinchDist) {
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      zoomAt(cx, cy, d / lastPinchDist);
    }
    lastPinchDist = d;
  }
}, { passive: false });
viewport.addEventListener('touchend', e => { if (e.touches.length < 2) lastPinchDist = null; });

// ─── Bottom panel drag (mobile) ───────────────────
const bottomPanel = document.getElementById('bottomPanel');
let panelDragStart = null;
let panelStartHeight = null;

document.getElementById('dragHandle').addEventListener('touchstart', e => {
  panelDragStart = e.touches[0].clientY;
  panelStartHeight = bottomPanel.getBoundingClientRect().height;
}, { passive: true });

window.addEventListener('touchmove', e => {
  if (panelDragStart === null) return;
  const dy = panelDragStart - e.touches[0].clientY;
  const newH = Math.max(120, Math.min(window.innerHeight * 0.8, panelStartHeight + dy));
  bottomPanel.style.maxHeight = newH + 'px';
  bottomPanel.style.minHeight = newH + 'px';
}, { passive: true });

window.addEventListener('touchend', () => { panelDragStart = null; });

// ─── Mode Édition ─────────────────────────────────
const EDIT_SECRET_KEY = "HELENE2026";

function setEditMode(on) {
  editMode = !!on;
  showWaypoints = on; // en édition, waypoints visibles par défaut

  modeBadge.textContent = on ? 'Édition' : 'Navigation';
  modeBadge.classList.toggle('edit', on);
  editModeBtn.classList.toggle('active', on);

  const navPanel  = document.getElementById('nav-panel');
  const editPanel = document.getElementById('edit-panel');
  navPanel.classList.toggle('hidden', on);
  editPanel.classList.toggle('hidden', !on);

  [btnEdgeMode, btnDeleteEdgeMode, btnDeleteLastPoint, btnDeleteLastEdge,
   btnClearAllEdges, btnExportJson, btnImport, importInput, poiNameInput
  ].forEach(el => { if (el) el.disabled = !on; });

  if (!on) {
    edgeMode = false; deleteByClickMode = false;
    svg.classList.remove('gomme');
    if (btnEdgeMode) btnEdgeMode.classList.remove('active');
    if (btnDeleteEdgeMode) btnDeleteEdgeMode.classList.remove('active');
    lastClickedPointId = null; selectedPointId = null;
  }
  drawPoints();
}

function askEditKey() {
  if (editMode === true) { setEditMode(false); showToast('Mode navigation'); return; }
  const userInput = prompt("Clé éditeur :");
  if (userInput === EDIT_SECRET_KEY) {
    setEditMode(true); showToast('Mode édition activé', 'success');
  } else {
    showToast('Clé incorrecte', 'error'); setEditMode(false);
  }
}

if (editModeBtn) editModeBtn.addEventListener('click', askEditKey);

// ─── Chargement ───────────────────────────────────
async function autoLoadGraph() {
  try {
    const resp = await fetch('data/plan_graph.json', { cache: 'no-store' });
    const data = await resp.json();
    loadGraph(data);
  } catch (e) {
    console.warn('Impossible de charger data/plan_graph.json', e);
    drawPoints(); drawEdges(); updateRoutePanel(null);
    scaleLabelEl.textContent = 'Non définie';
  }
}

function loadGraph(data) {
  nodes  = data.nodes || [];
  edges  = data.edges || [];
  PLAN_W = (data.meta && data.meta.planW) || 0;
  PLAN_H = (data.meta && data.meta.planH) || 0;

  mPerUnit = (data.meta && typeof data.meta.scale_m_per_unit === 'number'
              && isFinite(data.meta.scale_m_per_unit)
              && data.meta.scale_m_per_unit > 0)
              ? data.meta.scale_m_per_unit : null;

  scaleLabelEl.textContent = mPerUnit
    ? `1 u = ${mPerUnit.toFixed(4)} m`
    : 'Non définie';

  drawPoints(); drawEdges(); drawPath([]); refreshSelectOptions(); updateRoutePanel(null);
  initBackgroundDimensions();
}

function initBackgroundDimensions() {
  const img = new Image();
  img.onload = () => {
    PLAN_W = PLAN_W || img.naturalWidth;
    PLAN_H = PLAN_H || img.naturalHeight;
    planImage.style.width  = PLAN_W + 'px';
    planImage.style.height = PLAN_H + 'px';
    svg.setAttribute('width', PLAN_W);
    svg.setAttribute('height', PLAN_H);
    applyCamera();
  };
  img.src = 'assets/plan.png';
}

(function init() {
  setEditMode(false);
  autoLoadGraph();
})();
