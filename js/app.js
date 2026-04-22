/* ═══════════════════════════════════════════════════
   NAVINT — app.js  (multi-étages)
   Architecture :
   - floors[]  : tableau de { nodes, edges, meta, planSrc }
   - currentFloor : index de l'étage affiché
   - Dijkstra global sur tous les nœuds (préfixés floor_X__)
   - Connecteurs inter-étages : type "connector", linkedTo "floor_Y__id"
═══════════════════════════════════════════════════ */

// === Paramètres ===
const POINT_RADIUS_PX    = 2.5;
const HIT_RADIUS_PX      = 9;
const DELETE_TOLERANCE_PX = 18;
const ZOOM_MIN = 0.25, ZOOM_MAX = 4, ZOOM_STEP = 1.2, WHEEL_SENS = 0.0015;

// === État multi-étages ===
let floors = [];          // [{ nodes, edges, meta }]
let currentFloor = 0;     // index étage affiché

// Raccourcis vers l'étage courant
function floorData() { return floors[currentFloor] || { nodes:[], edges:[], meta:{} }; }

// Vrais getters (évite les alias ES6 dans le scope global)
function curNodes() { return floors[currentFloor]?.nodes || []; }
function curEdges() { return floors[currentFloor]?.edges || []; }

// === États UI ===
let edgeMode          = false;
let deleteByClickMode = false;
let lastClickedPointId = null;
let selectedPointId   = null;
let cam = { s:1, tx:0, ty:0 };
let isPanning = false;
let panStart  = { x:0, y:0, tx:0, ty:0 };
let panWithSpace = false;
let editMode      = false;
let showWaypoints = false;

// Itinéraire courant (multi-étages)
let currentRoute = null;
// { segments: [{ floor, pathIds }], totalDist }

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
const startSelect        = document.getElementById('startSelect');
const endSelect          = document.getElementById('endSelect');
const routeDistanceEl    = document.getElementById('routeDistance');
const routeStepsEl       = document.getElementById('routeSteps');
const scaleDistanceInput = document.getElementById('scaleDistance');
const scaleLabelEl       = document.getElementById('scaleLabel');
const zoomLabel          = document.getElementById('zoomLabel');
const modeBadge          = document.getElementById('modeBadge');
const editModeBtn        = document.getElementById('editModeBtn');
const floorButtonsEl     = document.getElementById('floorButtons');

// ─── Toast ────────────────────────────────────────
const toastEl = document.getElementById('toast');
let toastTimer = null;
function showToast(msg, type = '') {
  toastEl.textContent = msg;
  toastEl.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 2800);
}

// ─── Utilitaires ──────────────────────────────────
function slugify(s) {
  return (s || 'point')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-zA-Z0-9]+/g,'_')
    .replace(/^_+|_+$/g,'')
    .toLowerCase() || 'point';
}
function uniqueIdFromName(name) {
  const nodes = curNodes();
  const base = slugify(name);
  if (!nodes.some(n => n.id === base)) return base;
  let i = 2;
  while (nodes.some(n => n.id === base+'_'+i)) i++;
  return base+'_'+i;
}
function getNodeById(id, floorIdx = currentFloor) {
  return (floors[floorIdx]?.nodes || []).find(n => n.id === id);
}
// Recherche globale (tous étages) — renvoie {node, floor}
function getNodeGlobal(globalId) {
  // format: "F{floorIdx}__{id}"
  const m = globalId.match(/^F(\d+)__(.+)$/);
  if (!m) return null;
  const fi = parseInt(m[1]), id = m[2];
  const node = floors[fi]?.nodes?.find(n => n.id === id);
  return node ? { node, floor: fi } : null;
}
function globalId(floorIdx, localId) { return `F${floorIdx}__${localId}`; }

function isWaypoint(n)  { return n.type === 'waypoint'; }
function isConnector(n) { return n.type === 'connector'; }
function isPoi(n)       { return !isWaypoint(n) && !isConnector(n); }

function formatMeters(m) {
  if (!isFinite(m)) return '—';
  if (m < 1000) return Math.round(m) + ' m';
  return (m/1000).toFixed(2) + ' km';
}
function euclid(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function clientToPlan(clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return {x:0,y:0};
  const p = pt.matrixTransform(ctm.inverse());
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

// ─── Camera ───────────────────────────────────────
function applyCamera() {
  const { s, tx, ty } = cam;
  camera.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
  zoomLabel.textContent = Math.round(s*100) + '%';
}
function zoomAt(clientX, clientY, factor) {
  const rect = svg.getBoundingClientRect();
  const xRoot = clientX - rect.left, yRoot = clientY - rect.top;
  const xPlan = (xRoot - cam.tx) / cam.s, yPlan = (yRoot - cam.ty) / cam.s;
  const ns = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, cam.s * factor));
  cam.tx = xRoot - ns*xPlan; cam.ty = yRoot - ns*yPlan; cam.s = ns;
  applyCamera();
}
function startPan(clientX, clientY) {
  isPanning = true; viewport.classList.add('grabbing');
  const rect = svg.getBoundingClientRect();
  panStart = { x: clientX-rect.left, y: clientY-rect.top, tx: cam.tx, ty: cam.ty };
}
function continuePan(clientX, clientY) {
  if (!isPanning) return;
  const rect = svg.getBoundingClientRect();
  cam.tx = panStart.tx + (clientX-rect.left - panStart.x);
  cam.ty = panStart.ty + (clientY-rect.top  - panStart.y);
  applyCamera();
}
function endPan() { isPanning = false; viewport.classList.remove('grabbing'); }

// ─── Dessin ───────────────────────────────────────
function pathIdsOnCurrentFloor() {
  if (!currentRoute) return new Set();
  const seg = currentRoute.segments.find(s => s.floor === currentFloor);
  return new Set(seg ? seg.pathIds : []);
}

function drawPoints() {
  pointsLayer.innerHTML = '';
  const r = POINT_RADIUS_PX, haloR = r*2.5;
  const onPath = pathIdsOnCurrentFloor();
  const nodes  = curNodes();

  nodes.forEach(n => {
    const waypoint  = isWaypoint(n);
    const connector = isConnector(n);

    if (!editMode && waypoint && !onPath.has(n.id)) return;

    const g = document.createElementNS('http://www.w3.org/2000/svg','g');
    g.setAttribute('transform', `translate(${n.x},${n.y})`);

    let cls = 'poi-node';
    if (waypoint)               cls += ' waypoint';
    if (connector)              cls += ' connector';
    if (n.id === selectedPointId) cls += ' selected';
    if (onPath.has(n.id))       cls += ' on-path';
    g.setAttribute('class', cls);

    const hit = document.createElementNS('http://www.w3.org/2000/svg','circle');
    hit.setAttribute('r', editMode ? HIT_RADIUS_PX : (waypoint ? 0 : HIT_RADIUS_PX));
    hit.setAttribute('class','hit');

    const halo = document.createElementNS('http://www.w3.org/2000/svg','circle');
    halo.setAttribute('r', haloR); halo.setAttribute('class','halo');

    const c = document.createElementNS('http://www.w3.org/2000/svg','circle');
    const visR = waypoint ? (editMode ? 2 : 0) : (connector ? r*1.4 : r);
    c.setAttribute('r', visR); c.setAttribute('class','base');

    const t = document.createElementNS('http://www.w3.org/2000/svg','text');
    t.textContent = connector ? '⬆ ' + n.name : n.name;
    const hideLabel = waypoint && n.id !== selectedPointId;
    t.setAttribute('class','poi-label' + (hideLabel ? ' label-hidden' : ''));
    t.setAttribute('x', r*2+4); t.setAttribute('y',0);

    g.addEventListener('click', ev => {
      ev.stopPropagation();
      if (!editMode) { selectedPointId = n.id; drawPoints(); return; }
      onPointClick(n.id);
    });

    g.appendChild(hit); g.appendChild(halo); g.appendChild(c); g.appendChild(t);
    pointsLayer.appendChild(g);
  });
}

function drawEdges() {
  edgesLayer.innerHTML = '';
  const nodes = curNodes();
  curEdges().forEach(e => {
    const n1 = nodes.find(n=>n.id===e.from), n2 = nodes.find(n=>n.id===e.to);
    if (!n1||!n2) return;
    const line = document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',n1.x); line.setAttribute('y1',n1.y);
    line.setAttribute('x2',n2.x); line.setAttribute('y2',n2.y);
    line.setAttribute('class','edge');
    edgesLayer.appendChild(line);
  });
}

function drawPath() {
  pathLayer.innerHTML = '';
  if (!currentRoute) return;
  const seg = currentRoute.segments.find(s => s.floor === currentFloor);
  if (!seg || seg.pathIds.length < 2) return;

  let d = '';
  seg.pathIds.forEach((id, i) => {
    const n = curNodes().find(n=>n.id===id);
    if (!n) return;
    d += (i===0?'M':'L') + n.x + ' ' + n.y + ' ';
  });
  const p = document.createElementNS('http://www.w3.org/2000/svg','path');
  p.setAttribute('d', d.trim()); p.setAttribute('class','path');
  pathLayer.appendChild(p);
  drawPoints();
}

// ─── Boutons d'étage ──────────────────────────────
function buildFloorButtons() {
  floorButtonsEl.innerHTML = '';
  floors.forEach((f, i) => {
    const btn = document.createElement('button');
    btn.className = 'floor-btn' + (i === currentFloor ? ' active' : '');
    btn.textContent = f.meta?.label || (i === 0 ? 'RDC' : `Étage ${i}`);
    btn.onclick = () => switchFloor(i);
    floorButtonsEl.appendChild(btn);
  });
}

function switchFloor(idx) {
  if (idx < 0 || idx >= floors.length) return;
  currentFloor = idx;
  buildFloorButtons();
  updatePlanImage();
  drawPoints(); drawEdges(); drawPath();
  refreshSelectOptions();
  if (editMode) scaleLabelEl.textContent = floors[idx].meta?.scale_m_per_unit
    ? `1 u = ${floors[idx].meta.scale_m_per_unit.toFixed(4)} m` : 'Non définie';
}

function updatePlanImage() {
  const src = floors[currentFloor]?.meta?.planSrc || `assets/plan_${currentFloor}.png`;
  console.log('updatePlanImage → src:', src);
  planImage.style.backgroundImage = `url("${src}")`;
  const f = floors[currentFloor];
  const W = f?.meta?.planW || 0, H = f?.meta?.planH || 0;
  if (W && H) {
    planImage.style.width  = W + 'px';
    planImage.style.height = H + 'px';
    svg.setAttribute('width',  W);
    svg.setAttribute('height', H);
  }
}

// ─── Dijkstra multi-étages ────────────────────────
function buildGlobalAdjacency() {
  const adj = new Map();

  floors.forEach((f, fi) => {
    (f.nodes||[]).forEach(n => adj.set(globalId(fi, n.id), []));

    // Arêtes intra-étage
    (f.edges||[]).forEach(e => {
      const n1 = f.nodes.find(n=>n.id===e.from);
      const n2 = f.nodes.find(n=>n.id===e.to);
      if (!n1||!n2) return;
      const w = euclid(n1,n2);
      const g1 = globalId(fi,e.from), g2 = globalId(fi,e.to);
      adj.get(g1).push({ to:g2, w });
      adj.get(g2).push({ to:g1, w });
    });

    // Arêtes inter-étages via connecteurs
    (f.nodes||[]).filter(isConnector).forEach(n => {
      if (!n.linkedTo) return; // format "F1__id_etage_1"
      const gSrc = globalId(fi, n.id);
      const gDst = n.linkedTo; // déjà préfixé
      if (!adj.has(gDst)) return;
      // Coût arbitraire de 50 unités pour emprunter un ascenseur/escalier
      if (!adj.get(gSrc).some(e=>e.to===gDst)) {
        adj.get(gSrc).push({ to:gDst, w:50 });
        adj.get(gDst).push({ to:gSrc, w:50 });
      }
    });
  });
  return adj;
}

function dijkstraGlobal(startGid, endGid) {
  const adj = buildGlobalAdjacency();
  const dist = new Map(), prev = new Map(), visited = new Set();
  adj.forEach((_, id) => dist.set(id, Infinity));
  dist.set(startGid, 0);
  while (true) {
    let u = null, best = Infinity;
    dist.forEach((d,id) => { if (!visited.has(id) && d < best) { best=d; u=id; } });
    if (!u || u === endGid) break;
    visited.add(u);
    (adj.get(u)||[]).forEach(({to,w}) => {
      if (visited.has(to)) return;
      const alt = dist.get(u) + w;
      if (alt < dist.get(to)) { dist.set(to,alt); prev.set(to,u); }
    });
  }
  if (!prev.has(endGid) && startGid !== endGid) return null;
  const path = [];
  let cur = endGid;
  while (cur) { path.push(cur); if (cur===startGid) break; cur=prev.get(cur); }
  return path.reverse();
}

// Découpe le chemin global en segments par étage
function buildRoute(startGid, endGid) {
  const globalPath = dijkstraGlobal(startGid, endGid);
  if (!globalPath) return null;

  let mpu = null;
  const segments = [];
  let curSeg = null;

  globalPath.forEach(gid => {
    const res = getNodeGlobal(gid);
    if (!res) return;
    const { node, floor: fi } = res;

    if (!curSeg || curSeg.floor !== fi) {
      if (curSeg) segments.push(curSeg);
      curSeg = { floor: fi, pathIds: [] };
    }
    curSeg.pathIds.push(node.id);
  });
  if (curSeg) segments.push(curSeg);

  // Distance totale (intra-étages seulement pour l'affichage)
  let total = 0;
  segments.forEach(seg => {
    const f = floors[seg.floor];
    if (!f) return;
    const mpu2 = f.meta?.scale_m_per_unit || null;
    for (let i=0; i<seg.pathIds.length-1; i++) {
      const a = f.nodes.find(n=>n.id===seg.pathIds[i]);
      const b = f.nodes.find(n=>n.id===seg.pathIds[i+1]);
      if (a&&b) total += euclid(a,b) * (mpu2||1);
    }
    if (!mpu && mpu2) mpu = mpu2;
  });

  return { segments, totalDist: total, hasMpu: !!mpu };
}

// ─── Sélecteurs POI (tous étages) ────────────────
function refreshSelectOptions() {
  [startSelect, endSelect].forEach(sel => {
    const old = sel.value;
    sel.innerHTML = "<option value=''>Choisir un point...</option>";

    floors.forEach((f, fi) => {
      const label = f.meta?.label || (fi===0?'RDC':`Étage ${fi}`);
      const group = document.createElement('optgroup');
      group.label = label;
      (f.nodes||[]).filter(n => isPoi(n) || isConnector(n)).forEach(n => {
        const o = document.createElement('option');
        o.value = globalId(fi, n.id);
        o.textContent = (isConnector(n) ? '⬆ ' : '') + n.name;
        group.appendChild(o);
      });
      if (group.children.length) sel.appendChild(group);
    });
    if ([...(sel.options)].some(o=>o.value===old)) sel.value = old;
  });
}

// ─── Panneau itinéraire ───────────────────────────
function signedAngleDeg(ax,ay,bx,by) {
  return Math.atan2(-(ax*by-ay*bx), ax*bx+ay*by) * 180/Math.PI;
}
function turnPhrase(deg) {
  const aa=Math.abs(deg);
  if(aa>=150) return 'faire demi-tour';
  if(deg>30)  return 'tourner à gauche';
  if(deg<-30) return 'tourner à droite';
  return 'continuer tout droit';
}
function turnIcon(deg) {
  const aa=Math.abs(deg);
  if(aa>=150) return '↩'; if(deg>30) return '↰'; if(deg<-30) return '↱'; return '↑';
}

function updateRoutePanel(route) {
  routeStepsEl.innerHTML = '';
  const resultBox = document.getElementById('route-result');

  if (!route) {
    routeDistanceEl.textContent = '—';
    resultBox.classList.add('hidden');
    return;
  }

  const distStr = route.hasMpu ? formatMeters(route.totalDist) : Math.round(route.totalDist) + ' unités';
  routeDistanceEl.textContent = '📍 ' + distStr;

  const THRESH = 40;

  route.segments.forEach((seg, si) => {
    const f = floors[seg.floor];
    if (!f) return;
    const floorLabel = f.meta?.label || (seg.floor===0?'RDC':`Étage ${seg.floor}`);
    const mpu = f.meta?.scale_m_per_unit || null;
    const pts = seg.pathIds.map(id => f.nodes.find(n=>n.id===id)).filter(Boolean);

    // Séparateur d'étage
    if (route.segments.length > 1) {
      const div = document.createElement('li');
      div.className = 'step-floor';
      const isFirst = si === 0;
      div.innerHTML = isFirst
        ? `<strong>${floorLabel}</strong>`
        : `🛗 Changement d'étage → <strong>${floorLabel}</strong>`;
      routeStepsEl.appendChild(div);

      // Bouton pour basculer sur cet étage
      const btnFloor = document.createElement('button');
      btnFloor.className = 'step-floor-btn';
      btnFloor.textContent = `Voir ${floorLabel}`;
      btnFloor.onclick = () => switchFloor(seg.floor);
      div.appendChild(btnFloor);
    }

    if (pts.length === 0) return;

    // Départ du segment
    const liStart = document.createElement('li');
    liStart.className = si===0 ? 'step-start' : 'step-turn';
    liStart.innerHTML = si===0
      ? `<strong>Départ :</strong> ${pts[0].name}`
      : `<strong>Depuis :</strong> ${pts[0].name}`;
    routeStepsEl.appendChild(liStart);

    // Étapes intermédiaires
    const segLen = [];
    for (let i=0;i<pts.length-1;i++) segLen.push(euclid(pts[i],pts[i+1]));

    const coarseIdx=[0], coarseDist=[];
    let i=0;
    while (i<pts.length-1) {
      let run=segLen[i],j=i;
      while(j<pts.length-2&&segLen[j]<THRESH){j++;run+=segLen[j];}
      coarseDist.push(run); coarseIdx.push(j+1); i=j+1;
    }

    for (let k=0;k<coarseIdx.length-1;k++) {
      const B=pts[coarseIdx[k+1]], distPlan=coarseDist[k];
      const distLabel=mpu ? formatMeters(distPlan*mpu) : distPlan.toFixed(0)+' unités';
      const li=document.createElement('li');
      if (k===0) {
        li.innerHTML=`<strong>Aller</strong> vers ${B.name} — ${distLabel}`;
      } else {
        const P=pts[coarseIdx[k-1]],C=pts[coarseIdx[k]];
        const deg=signedAngleDeg(C.x-P.x,C.y-P.y,B.x-C.x,B.y-C.y);
        li.className='step-turn';
        li.innerHTML=`${turnIcon(deg)} À <strong>${C.name}</strong>, ${turnPhrase(deg)} → ${B.name} — ${distLabel}`;
      }
      routeStepsEl.appendChild(li);
    }

    // Arrivée du segment
    const last = pts[pts.length-1];
    const isLastSeg = si === route.segments.length-1;
    if (isLastSeg) {
      const liEnd=document.createElement('li');
      liEnd.className='step-end';
      liEnd.innerHTML=`<strong>Arrivée :</strong> ${last.name}`;
      routeStepsEl.appendChild(liEnd);
    }
  });

  resultBox.classList.remove('hidden');
}

// ─── Calcul itinéraire ────────────────────────────
document.getElementById('computeRoute').onclick = () => {
  const s = startSelect.value, t = endSelect.value;
  if (!s||!t) return showToast('Sélectionne un départ et une arrivée','error');
  if (s===t)  return showToast('Départ et arrivée identiques','error');

  const route = buildRoute(s, t);
  if (!route) {
    showToast('Aucun chemin trouvé','error');
    currentRoute = null; drawPath(); updateRoutePanel(null);
  } else {
    currentRoute = route;
    // Basculer sur l'étage du départ
    const startRes = getNodeGlobal(s);
    if (startRes) switchFloor(startRes.floor);
    else { drawPath(); }
    updateRoutePanel(route);
    showToast('Itinéraire calculé ✓','success');
  }
};

document.getElementById('clearRouteBtn').onclick = () => {
  currentRoute = null; drawPath(); drawPoints(); updateRoutePanel(null);
};
document.getElementById('swapBtn').onclick = () => {
  const a=startSelect.value, b=endSelect.value;
  startSelect.value=b; endSelect.value=a;
};

// ─── Édition — clic scène ─────────────────────────
svg.addEventListener('click', ev => {
  if (!editMode) return;
  if (deleteByClickMode) {
    const {x,y}=clientToPlan(ev.clientX,ev.clientY);
    const hit=findClosestEdge(x,y,DELETE_TOLERANCE_PX);
    if (hit) { removeEdge(hit.a,hit.b); hideEdgeHighlight(); }
    return;
  }
  const raw=poiNameInput.value.trim();
  const name=raw||`point_${curNodes().length+1}`;
  const {x,y}=clientToPlan(ev.clientX,ev.clientY);
  const id=uniqueIdFromName(name);
  const autoWaypoint=!raw||raw.toLowerCase().startsWith('point_')||raw.toLowerCase().startsWith('wp_');
  floors[currentFloor].nodes.push({ id, name, x, y, type: autoWaypoint?'waypoint':'poi' });
  poiNameInput.value='';
  drawPoints(); refreshSelectOptions();
});

svg.addEventListener('mousemove', ev => {
  if (!editMode||!deleteByClickMode){hideEdgeHighlight();return;}
  const {x,y}=clientToPlan(ev.clientX,ev.clientY);
  const hit=findClosestEdge(x,y,DELETE_TOLERANCE_PX);
  if(hit&&hit.n1&&hit.n2) showEdgeHighlight(hit.n1.x,hit.n1.y,hit.n2.x,hit.n2.y);
  else hideEdgeHighlight();
});

// ─── Sélection couloirs ───────────────────────────
function onPointClick(id) {
  if (!editMode||deleteByClickMode) return;
  if (edgeMode) {
    selectedPointId=id; drawPoints();
    if (!lastClickedPointId){lastClickedPointId=id;return;}
    if (lastClickedPointId!==id){
      addEdge(lastClickedPointId,id);
      lastClickedPointId=null; selectedPointId=null;
      drawEdges(); drawPoints(); return;
    }
    lastClickedPointId=null; selectedPointId=null; drawPoints(); return;
  }
  selectedPointId=id; drawPoints();
}
function addEdge(a,b){
  if(a===b) return;
  const edges=floors[currentFloor].edges;
  if(!edges.some(e=>(e.from===a&&e.to===b)||(e.from===b&&e.to===a)))
    edges.push({from:a,to:b});
}

// ─── Gomme helpers ────────────────────────────────
function distancePointToSegment(px,py,x1,y1,x2,y2){
  const ABx=x2-x1,ABy=y2-y1,APx=px-x1,APy=py-y1,ab2=ABx*ABx+ABy*ABy;
  if(ab2===0) return Math.hypot(px-x1,py-y1);
  let t=Math.max(0,Math.min(1,(APx*ABx+APy*ABy)/ab2));
  return Math.hypot(px-(x1+t*ABx),py-(y1+t*ABy));
}
function findClosestEdge(x,y,thr=18){
  let best={i:-1,d:Infinity,a:null,b:null,n1:null,n2:null};
  const nodes=curNodes();
  curEdges().forEach((e,i)=>{
    const n1=nodes.find(n=>n.id===e.from),n2=nodes.find(n=>n.id===e.to);
    if(!n1||!n2) return;
    const d=distancePointToSegment(x,y,n1.x,n1.y,n2.x,n2.y);
    if(d<best.d) best={i,d,a:e.from,b:e.to,n1,n2};
  });
  return(best.i>=0&&best.d<=thr)?best:null;
}
function removeEdge(a,b){
  const before=floors[currentFloor].edges.length;
  floors[currentFloor].edges=floors[currentFloor].edges.filter(
    e=>!((e.from===a&&e.to===b)||(e.from===b&&e.to===a)));
  if(floors[currentFloor].edges.length!==before) drawEdges();
}
function showEdgeHighlight(x1,y1,x2,y2){
  edgeHighlight.setAttribute('x1',x1);edgeHighlight.setAttribute('y1',y1);
  edgeHighlight.setAttribute('x2',x2);edgeHighlight.setAttribute('y2',y2);
  edgeHighlight.style.display='block';
}
function hideEdgeHighlight(){edgeHighlight.style.display='none';}

// ─── Boutons édition ──────────────────────────────
btnEdgeMode.onclick=()=>{
  if(!editMode)return;
  edgeMode=!edgeMode;
  if(edgeMode){deleteByClickMode=false;btnDeleteEdgeMode.classList.remove('active');svg.classList.remove('gomme');}
  lastClickedPointId=null;selectedPointId=null;drawPoints();
  btnEdgeMode.classList.toggle('active',edgeMode);
  showToast(edgeMode?'Mode couloir activé':'Mode couloir désactivé');
};
btnDeleteEdgeMode.onclick=()=>{
  if(!editMode)return;
  deleteByClickMode=!deleteByClickMode;
  if(deleteByClickMode){edgeMode=false;btnEdgeMode.classList.remove('active');svg.classList.add('gomme');lastClickedPointId=null;selectedPointId=null;drawPoints();}
  else{svg.classList.remove('gomme');hideEdgeHighlight();}
  btnDeleteEdgeMode.classList.toggle('active',deleteByClickMode);
  showToast(deleteByClickMode?'Gomme activée':'Gomme désactivée');
};
btnDeleteLastEdge.onclick=()=>{if(!editMode)return;floors[currentFloor].edges.pop();drawEdges();showToast('Dernier couloir supprimé');};
btnClearAllEdges.onclick=()=>{if(!editMode)return;if(confirm('Supprimer tous les couloirs ?')){floors[currentFloor].edges=[];drawEdges();showToast('Couloirs supprimés','error');}};
btnDeleteLastPoint.onclick=()=>{
  if(!editMode)return;
  const last=floors[currentFloor].nodes.pop();
  if(last){floors[currentFloor].edges=floors[currentFloor].edges.filter(e=>e.from!==last.id&&e.to!==last.id);showToast(`"${last.name}" supprimé`);}
  drawPoints();drawEdges();refreshSelectOptions();
};
document.getElementById('deleteSelectedPoint').onclick=()=>{
  if(!editMode)return showToast('Passe en mode ÉDITION','error');
  deletePoint(selectedPointId);
};

function deletePoint(id){
  if(!id)return showToast('Aucun point sélectionné','error');
  const node=curNodes().find(n=>n.id===id);
  floors[currentFloor].edges=floors[currentFloor].edges.filter(e=>e.from!==id&&e.to!==id);
  floors[currentFloor].nodes=floors[currentFloor].nodes.filter(n=>n.id!==id);
  if(selectedPointId===id)selectedPointId=null;
  drawPoints();drawEdges();refreshSelectOptions();
  showToast(`"${node?node.name:id}" supprimé`);
}

// Bascule poi ↔ waypoint
document.getElementById('toggleWaypointType').onclick=()=>{
  if(!editMode||!selectedPointId)return showToast('Sélectionne un point','error');
  const n=curNodes().find(n=>n.id===selectedPointId);
  if(!n)return;
  n.type=isWaypoint(n)?'poi':'waypoint';
  drawPoints();refreshSelectOptions();
  showToast(isWaypoint(n)?`"${n.name}" → Waypoint`:`"${n.name}" → POI`,'success');
};

// Bascule connector
document.getElementById('toggleConnectorType').onclick=()=>{
  if(!editMode||!selectedPointId)return showToast('Sélectionne un point','error');
  const n=curNodes().find(n=>n.id===selectedPointId);
  if(!n)return;
  if(isConnector(n)){
    n.type='poi'; delete n.linkedTo;
    showToast(`"${n.name}" → POI`,'success');
  } else {
    // Demander l'étage cible et l'ID du nœud lié
    const targetFloor=prompt(`Étage cible (0=${floors[0]?.meta?.label||'RDC'}, 1=${floors[1]?.meta?.label||'Étage 1'}, ...) :`);
    const fi=parseInt(targetFloor);
    if(isNaN(fi)||fi===currentFloor||!floors[fi])return showToast('Étage invalide','error');
    const targetId=prompt(`ID du point connecteur sur l'étage ${fi} (laisser vide pour créer manuellement) :`);
    n.type='connector';
    n.linkedTo=targetId?globalId(fi,targetId.trim()):null;
    showToast(`"${n.name}" → Connecteur inter-étage`,'success');
  }
  drawPoints();refreshSelectOptions();
};

// Afficher/masquer waypoints
document.getElementById('toggleWaypointsVisibility').onclick=()=>{
  if(!editMode)return;
  showWaypoints=!showWaypoints;
  document.getElementById('toggleWaypointsVisibility').classList.toggle('active',showWaypoints);
  drawPoints();
  showToast(showWaypoints?'Waypoints visibles':'Waypoints masqués');
};

// ─── Échelle ──────────────────────────────────────
document.getElementById('defineScaleBtn').onclick=()=>{
  if(!editMode)return showToast('Passe en mode édition','error');
  const aId=startSelect.value,bId=endSelect.value;
  if(!aId||!bId)return showToast('Sélectionne 2 points','error');
  const ra=getNodeGlobal(aId),rb=getNodeGlobal(bId);
  if(!ra||!rb||ra.floor!==rb.floor)return showToast('Les 2 points doivent être sur le même étage','error');
  const planDist=euclid(ra.node,rb.node);
  if(!(planDist>0))return showToast('Distance nulle','error');
  const realMeters=parseFloat(scaleDistanceInput.value);
  if(!(realMeters>0))return showToast('Distance réelle invalide','error');
  floors[currentFloor].meta.scale_m_per_unit=realMeters/planDist;
  scaleLabelEl.textContent=`1 u = ${floors[currentFloor].meta.scale_m_per_unit.toFixed(4)} m`;
  showToast('Échelle définie ✓','success');
};

// ─── Import / Export (étage courant) ─────────────
btnExportJson.onclick=()=>{
  const f=floors[currentFloor];
  const data={nodes:f.nodes,edges:f.edges,meta:f.meta};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`plan_graph_${currentFloor}.json`;a.click();
  URL.revokeObjectURL(url);
  showToast(`Étage ${currentFloor} exporté ✓`,'success');
};
btnImport.onclick=async()=>{
  const f=importInput.files[0];
  if(!f)return showToast('Choisis un fichier JSON','error');
  try{
    const data=JSON.parse(await f.text());
    floors[currentFloor].nodes=data.nodes||[];
    floors[currentFloor].edges=data.edges||[];
    floors[currentFloor].meta={...floors[currentFloor].meta,...(data.meta||{})};
    updatePlanImage();drawPoints();drawEdges();drawPath();refreshSelectOptions();
    showToast('Graphe importé ✓','success');
  }catch(e){showToast('Fichier JSON invalide','error');}
};

// ─── Zoom & Pan ───────────────────────────────────
document.getElementById('zoomInBtn').onclick=()=>{const r=svg.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,ZOOM_STEP);};
document.getElementById('zoomOutBtn').onclick=()=>{const r=svg.getBoundingClientRect();zoomAt(r.left+r.width/2,r.top+r.height/2,1/ZOOM_STEP);};
document.getElementById('zoomResetBtn').onclick=()=>{cam={s:1,tx:0,ty:0};applyCamera();};
viewport.addEventListener('wheel',ev=>{
  ev.preventDefault();
  const f=ev.deltaY<0?Math.max(1.05,1+Math.abs(ev.deltaY)*WHEEL_SENS):Math.min(0.95,1-Math.abs(ev.deltaY)*WHEEL_SENS);
  zoomAt(ev.clientX,ev.clientY,f);
},{passive:false});
window.addEventListener('keydown',e=>{if(e.code==='Space'){panWithSpace=true;viewport.classList.add('grab');}});
window.addEventListener('keyup',e=>{if(e.code==='Space'){panWithSpace=false;viewport.classList.remove('grab');if(isPanning)endPan();}});
viewport.addEventListener('mousedown',e=>{if(e.button===1||panWithSpace){e.preventDefault();startPan(e.clientX,e.clientY);}});
window.addEventListener('mousemove',e=>{if(isPanning)continuePan(e.clientX,e.clientY);});
window.addEventListener('mouseup',()=>{if(isPanning)endPan();});

// Touch pan
let touchStart=null;
viewport.addEventListener('touchstart',e=>{if(e.touches.length===1)touchStart={x:e.touches[0].clientX,y:e.touches[0].clientY,tx:cam.tx,ty:cam.ty};},{passive:true});
viewport.addEventListener('touchmove',e=>{
  if(e.touches.length===1&&touchStart){e.preventDefault();cam.tx=touchStart.tx+e.touches[0].clientX-touchStart.x;cam.ty=touchStart.ty+e.touches[0].clientY-touchStart.y;applyCamera();}
},{passive:false});
viewport.addEventListener('touchend',()=>{touchStart=null;});

// Pinch zoom
let lastPinchDist=null;
viewport.addEventListener('touchmove',e=>{
  if(e.touches.length===2){e.preventDefault();const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);if(lastPinchDist)zoomAt((e.touches[0].clientX+e.touches[1].clientX)/2,(e.touches[0].clientY+e.touches[1].clientY)/2,d/lastPinchDist);lastPinchDist=d;}
},{passive:false});
viewport.addEventListener('touchend',e=>{if(e.touches.length<2)lastPinchDist=null;});

// Bottom panel drag
const bottomPanel=document.getElementById('bottomPanel');
let panelDragStart=null,panelStartHeight=null;
document.getElementById('dragHandle').addEventListener('touchstart',e=>{panelDragStart=e.touches[0].clientY;panelStartHeight=bottomPanel.getBoundingClientRect().height;},{passive:true});
window.addEventListener('touchmove',e=>{if(panelDragStart===null)return;const dy=panelDragStart-e.touches[0].clientY;const newH=Math.max(120,Math.min(window.innerHeight*.8,panelStartHeight+dy));bottomPanel.style.maxHeight=newH+'px';bottomPanel.style.minHeight=newH+'px';},{passive:true});
window.addEventListener('touchend',()=>{panelDragStart=null;});

// ─── Mode Édition ─────────────────────────────────
const EDIT_SECRET_KEY='HELENE2026';
function setEditMode(on){
  editMode=!!on; showWaypoints=on;
  modeBadge.textContent=on?'Édition':'Navigation';
  modeBadge.classList.toggle('edit',on);
  editModeBtn.classList.toggle('active',on);
  document.getElementById('nav-panel').classList.toggle('hidden',on);
  document.getElementById('edit-panel').classList.toggle('hidden',!on);
  [btnEdgeMode,btnDeleteEdgeMode,btnDeleteLastPoint,btnDeleteLastEdge,
   btnClearAllEdges,btnExportJson,btnImport,importInput,poiNameInput
  ].forEach(el=>{if(el)el.disabled=!on;});
  if(!on){edgeMode=false;deleteByClickMode=false;svg.classList.remove('gomme');
    if(btnEdgeMode)btnEdgeMode.classList.remove('active');
    if(btnDeleteEdgeMode)btnDeleteEdgeMode.classList.remove('active');
    lastClickedPointId=null;selectedPointId=null;}
  drawPoints();
}
function askEditKey(){
  if(editMode){setEditMode(false);showToast('Mode navigation');return;}
  const k=prompt('Clé éditeur :');
  if(k===EDIT_SECRET_KEY){setEditMode(true);showToast('Mode édition activé','success');}
  else{showToast('Clé incorrecte','error');setEditMode(false);}
}
if(editModeBtn) editModeBtn.addEventListener('click',askEditKey);

// ─── Chargement initial ───────────────────────────
async function loadFloorFile(idx) {
  // Essaie plan_graph_0.json, plan_graph_1.json, etc.
  // Fallback sur plan_graph.json pour l'étage 0
  const urls = idx===0
    ? [`data/plan_graph_${idx}.json`, 'data/plan_graph.json']
    : [`data/plan_graph_${idx}.json`];

  for (const url of urls) {
    try {
      const r=await fetch(url,{cache:'no-store'});
      if(!r.ok) continue;
      const data=await r.json();
      return data;
    } catch(e) { continue; }
  }
  return null;
}

async function autoLoadGraph() {
  floors = [];

  // Charger jusqu'à 10 étages (s'arrête au premier introuvable après le 0)
  for (let i=0; i<10; i++) {
    const data=await loadFloorFile(i);
    if(!data && i>0) break; // fin des étages
    if(!data && i===0) {
      // Aucun fichier trouvé — créer un étage vide
      floors.push({ nodes:[], edges:[], meta:{ label:'RDC', planSrc:'assets/plan_0.png' } });
    } else {
      // Assurer le label et planSrc dans meta
      const meta=data.meta||{};
      if(!meta.label) meta.label = i===0?'RDC':`Étage ${i}`;
      if(!meta.planSrc) meta.planSrc = `assets/plan_${i}.png`;
      floors.push({ nodes:data.nodes||[], edges:data.edges||[], meta });
    }
  }

  // S'assurer d'avoir au moins 1 étage
  if(floors.length===0) floors.push({ nodes:[], edges:[], meta:{ label:'RDC', planSrc:'assets/plan_0.png' } });

  currentFloor=0;
  buildFloorButtons();
  updatePlanImage();
  initBackgroundDimensions();
  drawPoints(); drawEdges(); drawPath();
  refreshSelectOptions();
  updateRoutePanel(null);
}

function initBackgroundDimensions() {
  const meta=floors[currentFloor]?.meta||{};
  const src=meta.planSrc||`assets/plan_${currentFloor}.png`;
  const img=new Image();
  img.onload=()=>{
    const W=meta.planW||img.naturalWidth, H=meta.planH||img.naturalHeight;
    if(W&&H){
      planImage.style.width=W+'px'; planImage.style.height=H+'px';
      svg.setAttribute('width',W); svg.setAttribute('height',H);
    }
    applyCamera();
  };
  img.src=src;
}

(function init(){
  setEditMode(false);
  autoLoadGraph();
})();
