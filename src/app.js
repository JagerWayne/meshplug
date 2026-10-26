// ============================================================================
// 10. MESHPLUG STUDIO - MAIN APPLICATION
// ============================================================================

// ---------------------------------------------------------------------------
// Shared UI atoms. These live at module scope so that dragging a slider does
// not remount the control and steal the pointer.
// ---------------------------------------------------------------------------
const Field = ({ label, value, onChange, unit, step = 0.1, min = 0, max = 999 }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
      <span className="text-[11px] font-bold text-cyan-300 font-mono">
        {typeof value === 'number' ? value.toFixed(step < 1 ? 2 : 0) : value}{unit ? ` ${unit}` : ''}
      </span>
    </div>
    <input
      type="range"
      min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full accent-cyan-500 h-1.5 bg-slate-800 rounded"
    />
  </div>
);

const Stat = ({ label, value, tone = 'text-slate-100' }) => (
  <div className="flex items-center justify-between text-[10px]">
    <span className="text-slate-500">{label}</span>
    <span className={`font-mono font-bold ${tone}`}>{value}</span>
  </div>
);

// ---------------------------------------------------------------------------
// GUIDED WORKFLOW
//   The inspector is a five step path instead of a wall of controls. Every
//   step shows only what belongs to it and has one obvious primary action.
// ---------------------------------------------------------------------------
const WORKFLOW_STEPS = [
  { id: 1, label: 'Scan', icon: 'folder', hint: 'Load a scan file, or start from one of the calibrated samples.' },
  { id: 2, label: 'Fix', icon: 'wand', hint: 'Close the holes and calm down the scanner noise.' },
  { id: 3, label: 'Area', icon: 'target', hint: 'Pick the piece of surface the plastic should cover.' },
  { id: 4, label: 'Shell', icon: 'box', hint: 'Set the wall thickness and mould the part.' },
  { id: 5, label: 'Export', icon: 'download', hint: 'Save the result for printing or for CAD.' }
];

const SELECTION_TOOLS = [
  { id: 'pick', icon: 'target', label: 'Pick', help: 'Click the surface to grab a patch' },
  { id: 'section', icon: 'brackets', label: 'Section', help: 'Trace a closed boundary' },
  { id: 'box', icon: 'grid', label: 'Area', help: 'Drag a rectangle over it' },
  { id: 'grow', icon: 'sparkles', label: 'Grow', help: 'Flood a whole smooth region' },
  { id: 'paint', icon: 'pen', label: 'Brush', help: 'Paint it in by hand' },
  { id: 'erase', icon: 'x', label: 'Erase', help: 'Take faces back out' }
];

const TOOL_HELP = {
  pick: 'Click on the scan to grab the surface patch under the cursor. Click again to add more, Alt+click to take one away.',
  section: 'Click points on the mesh to trace a closed boundary, press Enter to close it, then click the surface inside it.',
  box: 'Drag a rectangle over the part you want the plastic to cover.',
  grow: 'Click once and the selection floods across the whole smooth region, stopping at hard creases.',
  paint: 'Paint the area in with the brush. Drag to sweep across the surface.',
  erase: 'Click faces to take them back out of the selection.'
};

// A one line instruction bar at the top of every step. It stays pinned so the
// instruction is always visible while the controls scroll.
const Hint = ({ children, tone = 'info' }) => (
  <div className={`sticky top-0 z-10 px-3 py-2.5 text-[11px] leading-relaxed border-b border-slate-800 backdrop-blur-md ${tone === 'good'
    ? 'bg-emerald-500/15 text-emerald-100'
    : tone === 'warn'
      ? 'bg-amber-500/15 text-amber-100'
      : 'bg-sky-500/15 text-slate-100'}`}>
    {children}
  </div>
);

function App() {
  // ---------------------------------------------------------------- refs --
  const mountRef = useRef(null);
  const fileInputRef = useRef(null);
  const threeRefs = useRef({});
  const historyRef = useRef({ list: [], idx: -1 });
  const sceneScaleRef = useRef(20);
  const hoverFaceRef = useRef(-1);
  const paintingRef = useRef(false);
  const selMaskRef = useRef(null);
  const boxStartRef = useRef(null);
  const boxAdditiveRef = useRef(false);
  const [historyTick, setHistoryTick] = useState(0);

  // --------------------------------------------------------------- state --
  const [scanGeo, setScanGeo] = useState(null);
  const [scanName, setScanName] = useState('No model');
  const [scanRev, setScanRev] = useState(0);
  const [selMask, setSelMask] = useState(null);
  const [selRev, setSelRev] = useState(0);
  const [shell, setShell] = useState(null);          // { geometry, stats }
  const [shellRev, setShellRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [tool, setTool] = useState('pick');          // pick | box | grow | paint | erase | section
  const [step, setStep] = useState(1);              // guided workflow step 1..5
  const [boxRect, setBoxRect] = useState(null);
  const [pickRadius, setPickRadius] = useState(9);
  const [closedLoops, setClosedLoops] = useState(null);
  // Traced section: a chain of straight chords between clicked mesh points.
  const [sectionPts, setSectionPts] = useState([]);   // { point: Vector3, face: number }
  const [sectionClosed, setSectionClosed] = useState(false);
  const [sectionSeed, setSectionSeed] = useState(null);   // face the region was grown from
  const [sectionSel, setSectionSel] = useState(null);     // index of the edited point
  const [sectionMode, setSectionMode] = useState('line');  // line | spline
  const [smoothStrength, setSmoothStrength] = useState(2);
  const [rimSmooth, setRimSmooth] = useState(true);
  const [rimSmoothPasses, setRimSmoothPasses] = useState(2);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [showDisplay, setShowDisplay] = useState(false);

  // Parameters
  const [importScale, setImportScale] = useState(1.0);
  const [growAngle, setGrowAngle] = useState(35);
  const [brushRadius, setBrushRadius] = useState(6);
  const [thickness, setThickness] = useState(2.0);
  const [clearance, setClearance] = useState(0.2);
  const [rimStyle, setRimStyle] = useState('flat');
  const [rimSegments, setRimSegments] = useState(4);
  const [useMiter, setUseMiter] = useState(true);
  const [miterLimit, setMiterLimit] = useState(3.0);
  const [shellSide, setShellSide] = useState('outer');

  // Repair parameters
  const [fillMode, setFillMode] = useState('curved');
  const [maxHoleArea, setMaxHoleArea] = useState(4000);
  const [smoothIters, setSmoothIters] = useState(8);
  const [smoothLambda, setSmoothLambda] = useState(0.52);
  const [featureAngle, setFeatureAngle] = useState(45);
  const [decimateRatio, setDecimateRatio] = useState(0.5);
  const [minComponentTris, setMinComponentTris] = useState(60);

  // View
  const [wireframe, setWireframe] = useState(false);
  const [scanOpacity, setScanOpacity] = useState(1.0);
  const [shellOpacity, setShellOpacity] = useState(1.0);
  const [showShell, setShowShell] = useState(true);
  const [showScan, setShowScan] = useState(true);
  const [showSelection, setShowSelection] = useState(true);
  const [showHoles, setShowHoles] = useState(true);
  const [projection, setProjection] = useState('persp');
  const [hoverInfo, setHoverInfo] = useState(null);

  // ------------------------------------------------------------ derived --
  const analysis = useMemo(() => (scanGeo ? analyzeMesh(scanGeo) : null), [scanGeo, scanRev]);
  const selStats = useMemo(
    () => (scanGeo && selMask ? selectionStats(scanGeo, selMask) : { faces: 0, percent: 0, area: 0, size: { x: 0, y: 0, z: 0 } }),
    [scanGeo, selMask, selRev]
  );

  // Which workflow steps are finished - drives the ticks in the stepper.
  const stepDone = useCallback((id) => {
    if (id === 1) return !!scanGeo;
    if (id === 2) return !!analysis && analysis.boundaryEdges === 0;
    if (id === 3) return selStats.faces > 0;
    if (id === 4) return !!(shell && shell.stats);
    return false;
  }, [scanGeo, analysis, selStats.faces, shell]);

  const showToast = useCallback((msg, tone = 'info') => {
    setToast({ msg, tone, id: Date.now() });
    setTimeout(() => setToast(null), 2600);
  }, []);

  // Keeps the selection mask in a ref so the pointer handlers always read the
  // freshest value instead of a stale closure.
  const setSelection = useCallback((mask) => {
    selMaskRef.current = mask;
    setSelMask(mask);
    setSelRev((r) => r + 1);
    setClosedLoops(null); // the closed outline has to be re-traced
  }, []);

  // ----------------------------------------------------------- viewport --
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05080f);

    const perspectiveCamera = new THREE.PerspectiveCamera(44, w / h, 0.1, 8000);
    perspectiveCamera.position.set(90, 80, 120);
    const orthoCamera = new THREE.OrthographicCamera(-80, 80, 80, -80, -4000, 8000);
    orthoCamera.position.copy(perspectiveCamera.position);
    let camera = perspectiveCamera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    controls.touches = { ONE: -1, TWO: THREE.TOUCH.DOLLY_PAN };

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
    keyLight.position.set(80, 120, 90);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
    fillLight.position.set(-70, 30, -60);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0x10b981, 0.28);
    rimLight.position.set(0, -70, 50);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(220, 44, 0x1e293b, 0x0f172a);
    grid.position.y = -40;
    scene.add(grid);
    const axes = new THREE.AxesHelper(26);
    axes.position.set(-95, -39, -95);
    scene.add(axes);

    const scanMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({
      color: 0x8ab4d8, metalness: 0.25, roughness: 0.55, side: THREE.DoubleSide
    }));
    scene.add(scanMesh);

    const selMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({
      color: 0x22d3ee, transparent: true, opacity: 0.45, side: THREE.DoubleSide,
      depthTest: false, depthWrite: false
    }));
    selMesh.renderOrder = 900;
    scene.add(selMesh);

    // Outline of the closed selection - always drawn in front of the model.
    const selOutline = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
    );
    selOutline.renderOrder = 950;
    selOutline.visible = false;
    scene.add(selOutline);

    // Traced section: straight chords between the clicked mesh points.
    const sectionLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 1, depthTest: false, depthWrite: false })
    );
    sectionLine.renderOrder = 960;
    sectionLine.visible = false;
    scene.add(sectionLine);

    const sectionDots = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({ color: 0xfde68a, size: 7, sizeAttenuation: false, depthTest: false, depthWrite: false })
    );
    sectionDots.renderOrder = 961;
    sectionDots.visible = false;
    scene.add(sectionDots);

    // Handle on the point that is currently grabbed for editing.
    const sectionHandle = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 })
    );
    sectionHandle.renderOrder = 962;
    sectionHandle.visible = false;
    scene.add(sectionHandle);

    const shellMesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({
      color: 0x34d399, metalness: 0.1, roughness: 0.42, side: THREE.DoubleSide,
      transparent: true, opacity: 0.85
    }));
    shellMesh.renderOrder = 3;
    scene.add(shellMesh);

    const holeGroup = new THREE.Group();
    scene.add(holeGroup);

    const reticle = new THREE.Group();
    reticle.renderOrder = 999;
    const retRing = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.72, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false })
    );
    reticle.add(retRing);
    const retDot = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xfbbf24, depthTest: false })
    );
    reticle.add(retDot);
    reticle.visible = false;
    scene.add(reticle);

    threeRefs.current = {
      scene, camera, perspectiveCamera, orthoCamera, renderer, controls,
      scanMesh, selMesh, selOutline, shellMesh, holeGroup, reticle, grid, axes,
      sectionLine, sectionDots, sectionHandle
    };

    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, threeRefs.current.camera || camera);
    };
    animate();

    const onResize = () => {
      const nw = container.clientWidth || window.innerWidth;
      const nh = container.clientHeight || window.innerHeight;
      renderer.setSize(nw, nh);
      perspectiveCamera.aspect = nw / nh;
      perspectiveCamera.updateProjectionMatrix();
      const halfH = 90;
      const halfW = halfH * (nw / nh);
      orthoCamera.left = -halfW; orthoCamera.right = halfW;
      orthoCamera.top = halfH; orthoCamera.bottom = -halfH;
      orthoCamera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);
    onResize();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement && renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // -------------------------------------------------- scan mesh syncing --
  useEffect(() => {
    const { scanMesh } = threeRefs.current;
    if (!scanMesh) return;
    if (scanGeo) {
      scanMesh.geometry = scanGeo;
      scanMesh.visible = showScan;
      scanMesh.material.wireframe = wireframe;
      scanMesh.material.opacity = scanOpacity;
      scanMesh.material.transparent = scanOpacity < 1;
      scanMesh.material.needsUpdate = true;
      scanGeo.computeBoundingBox();
      const bb = scanGeo.boundingBox;
      if (bb) {
        const size = new THREE.Vector3();
        bb.getSize(size);
        sceneScaleRef.current = Math.max(size.length() * 0.5, 1);
      }
    }
  }, [scanGeo, scanRev, wireframe, scanOpacity, showScan]);

  useEffect(() => {
    const { shellMesh } = threeRefs.current;
    if (!shellMesh) return;
    if (shell && shell.geometry) {
      shellMesh.geometry = shell.geometry;
      shellMesh.visible = showShell;
      shellMesh.material.opacity = shellOpacity;
      shellMesh.material.transparent = true;
      shellMesh.material.depthWrite = shellOpacity > 0.9;
      shellMesh.material.needsUpdate = true;
    } else {
      shellMesh.geometry = new THREE.BufferGeometry();
      shellMesh.visible = false;
    }
  }, [shell, shellRev, showShell, shellOpacity]);

  // Selection overlay ----------------------------------------------------
  useEffect(() => {
    const { selMesh } = threeRefs.current;
    if (!selMesh) return;
    if (!scanGeo || !selMask || !showSelection) {
      selMesh.geometry = new THREE.BufferGeometry();
      selMesh.visible = false;
      return;
    }
    const positions = [];
    const idx = scanGeo.index;
    const triCount = idx ? idx.count / 3 : scanGeo.attributes.position.count / 3;
    const pos = scanGeo.attributes.position;
    for (let t = 0; t < triCount; t++) {
      if (!selMask[t]) continue;
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      positions.push(pos.getX(a), pos.getY(a), pos.getZ(a));
      positions.push(pos.getX(b), pos.getY(b), pos.getZ(b));
      positions.push(pos.getX(c), pos.getY(c), pos.getZ(c));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    selMesh.geometry = geo;
    selMesh.visible = positions.length > 0;
    // The overlay always draws in front of the model (never at the back), but
    // it dims down once a shell exists so the moulded part stays readable.
    selMesh.material.opacity = shell ? 0.22 : 0.45;
    selMesh.material.needsUpdate = true;
  }, [scanGeo, selMask, selRev, showSelection, shell]);

  // Closed selection outline -------------------------------------------
  useEffect(() => {
    const { selOutline } = threeRefs.current;
    if (!selOutline) return;
    if (!scanGeo || !selMask || !closedLoops || !closedLoops.length || !showSelection) {
      selOutline.geometry = new THREE.BufferGeometry();
      selOutline.visible = false;
      return;
    }
    const positions = [];
    closedLoops.forEach((loop) => {
      const pts = loop.points;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    selOutline.geometry = geo;
    selOutline.visible = positions.length > 0;
  }, [scanGeo, selMask, selRev, closedLoops, showSelection]);

  // Traced section overlay ---------------------------------------------
  useEffect(() => {
    const { sectionLine, sectionDots, sectionHandle } = threeRefs.current;
    if (!sectionLine || !sectionDots) return;
    if (!sectionPts.length) {
      sectionLine.geometry = new THREE.BufferGeometry();
      sectionDots.geometry = new THREE.BufferGeometry();
      sectionLine.visible = false;
      sectionDots.visible = false;
      if (sectionHandle) sectionHandle.visible = false;
      return;
    }
    // The outline is drawn as straight chords or as a spline, whichever mode
    // the section is in.
    const drawn = sectionMode === 'spline'
      ? catmullRomClosed(sectionPts.map((p) => p.point), 10)
      : sectionPts.map((p) => p.point);
    const linePts = [];
    drawn.forEach((p) => linePts.push(p.x, p.y, p.z));
    if (!sectionClosed && sectionPts.length > 2) {
      const first = sectionPts[0].point;
      linePts.push(first.x, first.y, first.z);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePts, 3));
    sectionLine.geometry = lineGeo;
    sectionLine.visible = true;

    const dotPts = [];
    sectionPts.forEach((p) => dotPts.push(p.point.x, p.point.y, p.point.z));
    const dotGeo = new THREE.BufferGeometry();
    dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dotPts, 3));
    sectionDots.geometry = dotGeo;
    sectionDots.visible = true;

    if (sectionHandle) {
      const sel = sectionSel !== null ? sectionPts[sectionSel] : null;
      sectionHandle.visible = !!sel;
      if (sel) {
        sectionHandle.position.copy(sel.point);
        const s = sceneScaleRef.current * 0.028;
        sectionHandle.scale.setScalar(Math.max(0.8, s));
      }
    }
  }, [sectionPts, sectionClosed, sectionSel, sectionMode]);

  // Hole markers ---------------------------------------------------------
  useEffect(() => {
    const { holeGroup } = threeRefs.current;
    if (!holeGroup) return;
    clearGroup(holeGroup);
    if (!analysis || !showHoles) return;
    analysis.boundaryLoops.forEach((loop) => {
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(0.9, Math.sqrt(loop.area) * 0.12), 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.85, depthTest: false })
      );
      marker.position.copy(loop.centroid);
      marker.renderOrder = 998;
      holeGroup.add(marker);
    });
  }, [analysis, showHoles, scanRev]);

  // ------------------------------------------------------------ history --
  const pushHistory = useCallback((label, geo, mask) => {
    const h = historyRef.current;
    const snapshot = {
      label,
      geometry: geo ? geo.clone() : null,
      mask: mask ? Uint8Array.from(mask) : null
    };
    h.list = h.list.slice(0, h.idx + 1);
    h.list.push(snapshot);
    if (h.list.length > 40) h.list.shift();
    h.idx = h.list.length - 1;
    setHistoryTick((t) => t + 1);
  }, []);

  const restoreHistory = useCallback((dir) => {
    const h = historyRef.current;
    const next = h.idx + dir;
    if (next < 0 || next >= h.list.length) return;
    h.idx = next;
    const snap = h.list[next];
    setScanGeo(snap.geometry ? snap.geometry.clone() : null);
    setScanRev((r) => r + 1);
    if (snap.mask) { setSelection(Uint8Array.from(snap.mask)); }
    setShell(null);
    setShellRev((r) => r + 1);
    setHistoryTick((t) => t + 1);
    showToast(`${dir < 0 ? 'Undo' : 'Redo'}: ${snap.label}`);
  }, [showToast]);

  const applyGeometry = useCallback((label, geo, keepSelection = false) => {
    if (!geo) return;
    setScanGeo(geo);
    setScanRev((r) => r + 1);
    if (!keepSelection) { setSelection(null); }
    setShell(null);
    setShellRev((r) => r + 1);
    pushHistory(label, geo, keepSelection ? selMask : null);
  }, [pushHistory, selMask]);

  // ------------------------------------------------------------- loading --
  const loadMesh = useCallback((geo, label, scale = 1) => {
    if (!geo) return;
    let g = cleanGeometry(geo, 1e-4);
    if (scale !== 1) {
      g = g.clone();
      g.scale(scale, scale, scale);
      g.computeBoundingBox();
      g.computeBoundingSphere();
    }
    g = repairNormals(g);
    setScanGeo(g);
    setScanName(label);
    setScanRev((r) => r + 1);
    setSelection(null);
    setShell(null);
    setShellRev((r) => r + 1);
    pushHistory(`Load ${label}`, g, null);
    showToast(`Loaded "${label}"`);
    setStep(2);
    setTimeout(fitView, 60);
  }, [pushHistory, showToast]);

  const handleFileUpload = useCallback(async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const geo = await parseMeshFile(file);
      const repaired = repairNormals(cleanGeometry(geo, 1e-4));
      loadMesh(repaired, file.name, importScale);
    } catch (err) {
      showToast(`Could not read "${file.name}": ${err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  }, [importScale, loadMesh, showToast]);

  const fitView = useCallback(() => {
    const { camera, controls, perspectiveCamera, orthoCamera, scanMesh } = threeRefs.current;
    if (!camera || !controls) return;
    const geo = scanMesh && scanMesh.geometry && scanMesh.geometry.attributes.position
      ? scanMesh.geometry : null;
    if (!geo) return;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;
    const centre = new THREE.Vector3();
    bb.getCenter(centre);
    const size = new THREE.Vector3();
    bb.getSize(size);
    const radius = Math.max(size.length() * 0.5, 1);
    const dist = radius / Math.tan((perspectiveCamera.fov * Math.PI) / 360) * 1.5;
    const dir = new THREE.Vector3(0.55, 0.45, 0.72).normalize();
    camera.position.copy(centre).addScaledVector(dir, dist);
    camera.up.set(0, 1, 0);
    camera.near = Math.max(0.01, dist * 0.001);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    perspectiveCamera.near = camera.near;
    perspectiveCamera.far = camera.far;
    perspectiveCamera.updateProjectionMatrix();
    orthoCamera.near = -dist * 10;
    orthoCamera.far = dist * 10;
    orthoCamera.left = -radius * 1.6;
    orthoCamera.right = radius * 1.6;
    orthoCamera.top = radius * 1.6;
    orthoCamera.bottom = -radius * 1.6;
    orthoCamera.updateProjectionMatrix();
    orthoCamera.position.copy(camera.position);
    orthoCamera.quaternion.copy(camera.quaternion);
    controls.target.copy(centre);
    controls.update();
  }, []);

  const setCameraView = useCallback((preset) => {
    const { camera, controls, perspectiveCamera } = threeRefs.current;
    if (!camera || !controls) return;
    const geo = threeRefs.current.scanMesh.geometry;
    if (!geo || !geo.attributes.position) return;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;
    const centre = new THREE.Vector3();
    bb.getCenter(centre);
    const size = new THREE.Vector3();
    bb.getSize(size);
    const radius = Math.max(size.length() * 0.5, 1);
    const dist = radius / Math.tan((perspectiveCamera.fov * Math.PI) / 360) * 1.5;
    const dirs = {
      iso: new THREE.Vector3(0.55, 0.45, 0.72),
      front: new THREE.Vector3(0, 0, 1),
      top: new THREE.Vector3(0, 1, 0.001),
      side: new THREE.Vector3(1, 0, 0)
    };
    const d = (dirs[preset] || dirs.iso).clone().normalize();
    camera.position.copy(centre).addScaledVector(d, dist);
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    controls.target.copy(centre);
    controls.update();
  }, []);

  // ------------------------------------------------------- camera modes --
  const applyProjection = useCallback((mode) => {
    const { camera, perspectiveCamera, orthoCamera, controls } = threeRefs.current;
    setProjection(mode);
    if (!camera || !perspectiveCamera || !orthoCamera || !controls) return;
    const next = mode === 'ortho' ? orthoCamera : perspectiveCamera;
    if (next !== camera) {
      next.position.copy(camera.position);
      next.quaternion.copy(camera.quaternion);
      next.up.copy(camera.up);
      next.zoom = 1;
      next.updateProjectionMatrix();
      controls.object = next;
      threeRefs.current.camera = next;
    }
    controls.update();
  }, []);

  // ------------------------------------------------------------ picking --
  const pickAt = useCallback((clientX, clientY) => {
    const { renderer, camera, scanMesh } = threeRefs.current;
    if (!renderer || !scanMesh || !scanMesh.geometry.attributes.position) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(scanMesh, false);
    if (!hits.length) return null;
    const hit = hits[0];
    return {
      point: hit.point,
      // three.js reports the triangle index straight into the index buffer.
      faceIndex: typeof hit.faceIndex === 'number' ? hit.faceIndex : -1,
      normal: hit.face ? hit.face.normal.clone() : new THREE.Vector3(0, 1, 0),
      ray: raycaster.ray
    };
  }, []);

  // Selects every triangle whose centroid projects inside a screen rectangle.
  // This is the area picker - the shell is then built over exactly that area.
  const selectInRect = useCallback((x0, y0, x1, y1, additive) => {
    const { camera, renderer } = threeRefs.current;
    if (!scanGeo || !camera || !renderer) return 0;
    const canvasRect = renderer.domElement.getBoundingClientRect();
    const triCount = scanGeo.index ? scanGeo.index.count / 3 : scanGeo.attributes.position.count / 3;
    const mask = additive && selMaskRef.current && selMaskRef.current.length === triCount
      ? Uint8Array.from(selMaskRef.current) : new Uint8Array(triCount);

    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const pos = scanGeo.attributes.position;
    const idx = scanGeo.index;
    const v = new THREE.Vector3();
    let picked = 0;

    for (let t = 0; t < triCount; t++) {
      const a = idx ? idx.getX(t * 3) : t * 3;
      const b = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
      const c = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      v.set(
        (pos.getX(a) + pos.getX(b) + pos.getX(c)) / 3,
        (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3,
        (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3
      );
      v.applyMatrix4(camera.matrixWorldInverse);
      if (v.z > -0.001) continue; // behind the camera
      v.applyMatrix4(camera.projectionMatrix);
      const sx = (v.x * 0.5 + 0.5) * canvasRect.width;
      const sy = (-v.y * 0.5 + 0.5) * canvasRect.height;
      if (sx < minX || sx > maxX || sy < minY || sy > maxY) continue;
      mask[t] = 1;
      picked++;
    }
    setSelection(mask);
    return picked;
  }, [scanGeo, setSelection]);

  const handlePointerMove = useCallback((e) => {
    const { reticle } = threeRefs.current;
    const container = mountRef.current;
    const hit = pickAt(e.clientX, e.clientY);
    const face = hit ? hit.faceIndex : -1;

    // Brush painting sweeps while the pointer is held down.
    if (paintingRef.current && tool === 'paint' && scanGeo && hit) {
      const triCount = scanGeo.index ? scanGeo.index.count / 3 : scanGeo.attributes.position.count / 3;
      const current = selMaskRef.current && selMaskRef.current.length === triCount
        ? selMaskRef.current : new Uint8Array(triCount);
      setSelection(paintSphere(scanGeo, current, hit.point, brushRadius, true));
    }

    // Area box drag.
    if (boxStartRef.current && container) {
      const cr = container.getBoundingClientRect();
      setBoxRect({
        x0: boxStartRef.current.x, y0: boxStartRef.current.y,
        x1: e.clientX - cr.left, y1: e.clientY - cr.top
      });
      return;
    }

    if (face === hoverFaceRef.current) return;
    hoverFaceRef.current = face;
    if (reticle) {
      if (hit && face >= 0) {
        reticle.visible = true;
        reticle.position.copy(hit.point);
        const scale = sceneScaleRef.current * 0.012;
        reticle.scale.setScalar(Math.max(0.4, scale));
      } else {
        reticle.visible = false;
      }
    }
    setHoverInfo(face >= 0 ? { face } : null);
  }, [pickAt, tool, scanGeo, brushRadius, setSelection]);

  const handlePointerUp = useCallback(() => {
    paintingRef.current = false;
    if (boxStartRef.current) {
      const r = boxRect;
      boxStartRef.current = null;
      setBoxRect(null);
      if (r) {
        const picked = selectInRect(r.x0, r.y0, r.x1, r.y1, boxAdditiveRef.current);
        showToast(picked ? `Area selected - ${picked.toLocaleString()} faces` : 'No faces inside the box');
      }
    }
  }, [boxRect, selectInRect, showToast]);

  // Projects the section points to screen space so they can be grabbed.
  const projectSectionPoints = useCallback(() => {
    const { camera, renderer } = threeRefs.current;
    if (!camera || !renderer) return [];
    const rect = renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector3();
    return sectionPts.map((p) => {
      v.copy(p.point).project(camera);
      return {
        x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
        y: rect.top + (-v.y * 0.5 + 0.5) * rect.height
      };
    });
  }, [sectionPts]);

  // Re-derives the region a section bounds, re-seeding from the middle of
  // the outline so it never depends on a stale seed.
  const applySectionRegion = useCallback((pts) => {
    const path = sectionPath(pts, sectionMode);
    const seed = autoSeedForSection(scanGeo, pts);
    if (seed < 0 || !pts.length) return null;
    const { mask } = fillRegionBoundedBy(scanGeo, path, pts[0].face, seed);
    let count = 0;
    for (let t = 0; t < mask.length; t++) if (mask[t]) count++;
    const total = mask.length;
    const prev = selMaskRef.current ? selMaskRef.current.reduce((s, v) => s + v, 0) : 0;
    // A section that suddenly swallows the whole model means the outline did
    // not close on this surface - refuse it instead of selecting everything.
    const escaped = count > total * 0.85;
    const jumped = prev > 0 && count > prev * 4 && count > total * 0.35;
    if (escaped || jumped) {
      showToast('That section does not close on this surface - click inside it to select', 'error');
      return null;
    }
    setSectionSeed(seed);
    setSelection(mask);
    return { mask, count };
  }, [scanGeo, sectionMode, setSelection, showToast]);

  // Moves one section point and re-derives the region it bounds.
  const moveSectionPoint = useCallback((index, point, faceIndex) => {
    if (index < 0 || index >= sectionPts.length) return;
    const next = sectionPts.map((p, i) => (i === index ? { point: point.clone(), face: faceIndex } : p));
    setSectionPts(next);
    if (sectionClosed) {
      const res = applySectionRegion(next);
      showToast(res
        ? `Point moved - region re-selected (${res.count.toLocaleString()} faces)`
        : 'Point moved - click inside the section to re-select', res ? 'info' : 'error');
    }
  }, [sectionPts, sectionClosed, applySectionRegion, showToast]);

  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (!scanGeo) return;
    const container = mountRef.current;

    if (tool === 'box') {
      if (!container) return;
      const cr = container.getBoundingClientRect();
      boxStartRef.current = { x: e.clientX - cr.left, y: e.clientY - cr.top };
      boxAdditiveRef.current = !!(e.shiftKey || e.ctrlKey);
      setBoxRect({
        x0: boxStartRef.current.x, y0: boxStartRef.current.y,
        x1: boxStartRef.current.x, y1: boxStartRef.current.y
      });
      return;
    }

    const hit = pickAt(e.clientX, e.clientY);
    if (!hit || hit.faceIndex < 0) return;
    const additive = e.shiftKey || e.ctrlKey;
    const remove = e.altKey;
    const triCount = scanGeo.index ? scanGeo.index.count / 3 : scanGeo.attributes.position.count / 3;
    const current = selMaskRef.current && selMaskRef.current.length === triCount
      ? selMaskRef.current : new Uint8Array(triCount);

    if (tool === 'pick') {
      // Click straight onto the scan: grab the surface patch under the cursor.
      const next = remove
        ? eraseSphere(scanGeo, current, hit.point, pickRadius)
        : paintSphere(scanGeo, current, hit.point, pickRadius, true);
      setSelection(next);
      showToast(remove ? 'Picked faces removed' : 'Picked faces added - click again to add more');
    } else if (tool === 'section') {
      // Grab an existing point first - it is the handle for editing.
      const screenPts = projectSectionPoints();
      let near = -1;
      let nearD = 16 * 16;
      screenPts.forEach((sp, i) => {
        const dx = sp.x - e.clientX, dy = sp.y - e.clientY;
        const d = dx * dx + dy * dy;
        if (d < nearD) { nearD = d; near = i; }
      });
      if (near >= 0) {
        setSectionSel(near);
        showToast(`Point ${near + 1} selected - click the mesh to move it, Del to remove`);
        return;
      }
      if (sectionSel !== null && sectionPts[sectionSel]) {
        // Move the selected point onto the mesh.
        moveSectionPoint(sectionSel, hit.point, hit.faceIndex);
        return;
      }
      if (!sectionClosed) {
        // Drawing the section: every click drops a point, straight chords are
        // drawn between consecutive points.
        setSectionPts((prev) => [...prev, { point: hit.point.clone(), face: hit.faceIndex }]);
        showToast(`Section point ${sectionPts.length + 1} - ${sectionPts.length + 1 >= 3 ? 'press Enter to close it' : 'keep clicking'}`);
      } else {
        // Closed: click inside the section to grow the selection from there.
        const path = sectionPath(sectionPts, sectionMode);
        const { mask } = fillRegionBoundedBy(scanGeo, path, sectionPts[0].face, hit.faceIndex);
        let count = 0;
        for (let t = 0; t < mask.length; t++) if (mask[t]) count++;
        const total = mask.length;
        if (!count) {
          showToast('Nothing inside that section - click on the surface you want', 'error');
        } else if (count > total * 0.6) {
          showToast('That section does not close on this surface - add more points', 'error');
        } else {
          setSectionSeed(hit.faceIndex);
          setSelection(mask);
          showToast(`Section region selected - ${count.toLocaleString()} faces`);
        }
      }
    } else if (tool === 'grow') {
      const mask = growRegion(scanGeo, current, hit.faceIndex, { angleThreshold: growAngle, additive });
      setSelection(mask);
      showToast(`Region grown from face ${hit.faceIndex} (${growAngle}° crease limit)`);
    } else if (tool === 'paint') {
      paintingRef.current = true;
      setSelection(paintSphere(scanGeo, current, hit.point, brushRadius, true));
    } else if (tool === 'erase') {
      const mask = eraseSphere(scanGeo, current, hit.point, pickRadius);
      setSelection(mask);
    }
  }, [scanGeo, tool, growAngle, brushRadius, pickRadius, pickAt, showToast, setSelection, sectionPts, sectionClosed, sectionSel, projectSectionPoints, moveSectionPoint]);

  // ------------------------------------------------------------ actions --
  const runRepair = useCallback((label, fn) => {
    if (!scanGeo) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const result = fn(scanGeo.clone());
        if (result) applyGeometry(label, result);
        showToast(`${label} applied`);
      } catch (err) {
        showToast(`${label} failed: ${err.message}`, 'error');
      } finally {
        setBusy(false);
      }
    }, 20);
  }, [scanGeo, applyGeometry, showToast]);

  const doFillHoles = useCallback(() => {
    runRepair('Fill holes', (geo) => {
      const res = fillHoles(geo, { maxHoleArea, mode: fillMode, smoothIterations: 8 });
      showToast(`Filled ${res.filled} hole(s), skipped ${res.skipped}`);
      return res.geometry;
    });
  }, [runRepair, maxHoleArea, fillMode, showToast]);

  const doSmooth = useCallback(() => {
    runRepair('Taubin smooth', (geo) => taubinSmooth(geo, {
      iterations: smoothIters, lambda: smoothLambda, mu: -smoothLambda * 1.04, featureAngle
    }));
  }, [runRepair, smoothIters, smoothLambda, featureAngle]);

  const doDecimate = useCallback(() => {
    runRepair('Decimate', (geo) => decimateQEM(geo, { targetRatio: decimateRatio, boundaryWeight: 8 }));
  }, [runRepair, decimateRatio]);

  const doCullComponents = useCallback(() => {
    runRepair('Remove debris', (geo) => removeSmallComponents(geo, minComponentTris));
  }, [runRepair, minComponentTris]);

  const doRepairNormals = useCallback(() => {
    runRepair('Repair normals', (geo) => {
      const fixed = fixWinding(geo);
      const n = repairNormals(fixed);
      showToast(`Winding fixed - ${fixed.userData?.flippedFaces || 0} faces flipped`);
      return n;
    });
  }, [runRepair, showToast]);

  const doFlipNormals = useCallback(() => {
    runRepair('Flip normals', (geo) => flipAllFaces(geo));
  }, [runRepair]);

  const doWeld = useCallback(() => {
    runRepair('Weld + clean', (geo) => cleanGeometry(geo, 1e-4));
  }, [runRepair]);

  const doBuildShell = useCallback(() => {
    if (!scanGeo) return;
    const triCount = scanGeo.index ? scanGeo.index.count / 3 : scanGeo.attributes.position.count / 3;
    const raw = selMaskRef.current && selMaskRef.current.length === triCount ? selMaskRef.current : null;
    if (!raw || !raw.some((v) => v)) {
      showToast('Select an area first - use the Section, Area, Grow or Brush tool', 'error');
      setStep(3);
      return;
    }
    // A region that touches itself at one vertex would mould a non-manifold
    // shell, so the selection is cleaned up first.
    const mask = tidySelectionMask(scanGeo, raw);
    if (mask !== raw) {
      setSelection(mask);
      let kept = 0;
      for (let t = 0; t < mask.length; t++) if (mask[t]) kept++;
      showToast(`Selection tidied for a clean rim - ${kept.toLocaleString()} faces`);
    }
    setBusy(true);
    setTimeout(() => {
      try {
        const res = buildShell(scanGeo, mask, {
          thickness, clearance, side: shellSide, useMiter, miterLimit, rimStyle, rimSegments,
          rimSmoothPasses: rimSmooth ? rimSmoothPasses : 0
        });
        if (!res.geometry) {
          showToast('Nothing selected - nothing to build', 'error');
        } else {
          setShell(res);
          setShellRev((r) => r + 1);
          showToast(`Shell over ${res.stats.selectedFaces.toLocaleString()} faces - ${res.stats.shellTriangles.toLocaleString()} tris, min wall ${res.stats.minWall.toFixed(2)} mm`);
        }
      } catch (err) {
        showToast(`Shell build failed: ${err.message}`, 'error');
      } finally {
        setBusy(false);
      }
    }, 20);
  }, [scanGeo, thickness, clearance, shellSide, useMiter, miterLimit, rimStyle, rimSegments, rimSmooth, rimSmoothPasses, showToast]);

  const doBooleanSubtract = useCallback(() => {
    if (!shell || !shell.geometry || !scanGeo) return;
    setBusy(true);
    setTimeout(() => {
      try {
        const res = csgSubtractGeometries(shell.geometry, scanGeo);
        if (res) {
          setShell({ geometry: res, stats: { ...shell.stats, shellTriangles: res.index.count / 3 } });
          setShellRev((r) => r + 1);
          showToast('Boolean: shell minus scan applied');
        } else {
          showToast('Boolean failed - mesh too dense for the BSP engine', 'error');
        }
      } catch (err) {
        showToast(`Boolean failed: ${err.message}`, 'error');
      } finally {
        setBusy(false);
      }
    }, 20);
  }, [shell, scanGeo, showToast]);

  // ----------------------------------------------------------- selection --
  const selectAll = useCallback(() => {
    if (!scanGeo) return;
    const triCount = scanGeo.index ? scanGeo.index.count / 3 : scanGeo.attributes.position.count / 3;
    setSelection(new Uint8Array(triCount).fill(1));
  }, [scanGeo, setSelection]);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, [setSelection]);

  const invertSelection = useCallback(() => {
    if (!scanGeo) return;
    const triCount = scanGeo.index ? scanGeo.index.count / 3 : scanGeo.attributes.position.count / 3;
    const current = selMaskRef.current;
    const next = new Uint8Array(triCount);
    for (let t = 0; t < triCount; t++) next[t] = current && current[t] ? 0 : 1;
    setSelection(next);
  }, [scanGeo, setSelection]);

  const growSelection = useCallback((delta) => {
    if (!scanGeo || !selMaskRef.current) return;
    setSelection(morphSelection(scanGeo, selMaskRef.current, delta));
  }, [scanGeo, setSelection]);

  const keepLargest = useCallback(() => {
    if (!scanGeo || !selMaskRef.current) return;
    setSelection(keepLargestSelectionIsland(scanGeo, selMaskRef.current));
  }, [scanGeo, setSelection]);

  // Closes the picked area: traces the closed boundary of every picked
  // region and shows it on the model. Nothing is thrown away - use "Island"
  // if you want to drop the disconnected specks.
  const doCloseSelection = useCallback(() => {    if (!scanGeo || !selMaskRef.current) {
      showToast('Nothing picked - click on the scan first', 'error');
      return;
    }
    const triCount = scanGeo.index ? scanGeo.index.count / 3 : scanGeo.attributes.position.count / 3;
    const current = selMaskRef.current.length === triCount ? selMaskRef.current : new Uint8Array(triCount);
    let kept = 0;
    for (let t = 0; t < triCount; t++) if (current[t]) kept++;
    if (!kept) {
      setClosedLoops(null);
      showToast('Selection is empty', 'error');
      return;
    }
    const loops = selectionBoundaryLoops(scanGeo, current);
    setClosedLoops(loops);
    const perimeter = loops.reduce((s, l) => s + l.perimeter, 0);
    showToast(`Selection closed - ${kept.toLocaleString()} faces in ${loops.length} region(s), ${perimeter.toFixed(1)} mm outline`);
  }, [scanGeo, showToast]);

  // ------------------------------------------------------------ section --
  const doCloseSection = useCallback(() => {
    if (sectionPts.length < 3) {
      showToast('A section needs at least 3 points', 'error');
      return;
    }
    setSectionClosed(true);
    setSectionSel(null);
    // Closing the section selects the area it encloses straight away.
    const res = applySectionRegion(sectionPts);
    showToast(res
      ? `Section closed - ${res.count.toLocaleString()} faces selected`
      : 'Section closed - click on the surface inside it to select that piece',
    res ? 'info' : 'error');
  }, [sectionPts, applySectionRegion, showToast]);

  const doUndoSectionPoint = useCallback(() => {
    setSectionPts((prev) => prev.slice(0, -1));
    setSectionClosed(false);
    setSectionSel(null);
  }, []);

  const doClearSection = useCallback(() => {
    setSectionPts([]);
    setSectionClosed(false);
    setSectionSel(null);
    setSectionSeed(null);
  }, []);

  const doDeleteSectionPoint = useCallback(() => {
    if (sectionSel === null) return;
    setSectionPts((prev) => prev.filter((_, i) => i !== sectionSel));
    setSectionSel(null);
    setSectionClosed(false);
    showToast('Point deleted');
  }, [sectionSel, showToast]);

  const doInvertSection = useCallback(() => {
    if (!scanGeo || !selMaskRef.current) return;
    const triCount = scanGeo.index ? scanGeo.index.count / 3 : scanGeo.attributes.position.count / 3;
    const current = selMaskRef.current.length === triCount ? selMaskRef.current : new Uint8Array(triCount);
    const next = new Uint8Array(triCount);
    for (let t = 0; t < triCount; t++) next[t] = current[t] ? 0 : 1;
    setSelection(next);
  }, [scanGeo, setSelection]);

  // Rounds off the stepped outline of the picked area.
  const doSmoothSelection = useCallback(() => {
    if (!scanGeo || !selMaskRef.current) return;
    const triCount = scanGeo.index ? scanGeo.index.count / 3 : scanGeo.attributes.position.count / 3;

    // With a traced section the outline itself is rounded off and the region
    // is re-derived from it - that is the visible "smooth" result.
    if (sectionPts.length >= 3) {
      const smoothed = smoothSectionPoints(scanGeo, sectionPts, smoothStrength);
      if (smoothed) {
        setSectionPts(smoothed);
        if (sectionClosed) {
          const res = applySectionRegion(smoothed);
          showToast(res
            ? `Section smoothed - ${res.count.toLocaleString()} faces`
            : 'Section smoothed - click inside it to re-select', res ? 'info' : 'error');
        } else {
          showToast('Section outline smoothed');
        }
        return;
      }
    }

    // Otherwise the face set itself is rounded off.
    const smoothed = smoothSelectionFaces(scanGeo, selMaskRef.current, smoothStrength);
    if (!smoothed) {
      showToast('Selection is already smooth');
      return;
    }
    let count = 0;
    for (let t = 0; t < smoothed.length; t++) if (smoothed[t]) count++;
    setSelection(smoothed);
    showToast(`Selection smoothed - ${count.toLocaleString()} faces`);
  }, [scanGeo, sectionPts, sectionSeed, smoothStrength, setSelection, showToast]);

  // ------------------------------------------------------------- export --
  const triggerDownload = useCallback((content, filename, mime) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    // Removing the anchor straight after the click can cancel the transfer in
    // Chrome - give the browser a moment to pick the blob up first.
    setTimeout(() => {
      if (link.parentNode) link.parentNode.removeChild(link);
      URL.revokeObjectURL(url);
    }, 4000);
  }, []);

  const exportGeometry = useCallback((format) => {
    const target = shell && shell.geometry ? shell.geometry : scanGeo;
    if (!target) { showToast('Nothing to export', 'error'); return; }
    const base = (scanName || 'meshplug').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_');
    if (format === 'stl') triggerDownload(generateBinarySTL(target), `${base}_shell.stl`, 'application/octet-stream');
    else if (format === 'stl-ascii') triggerDownload(generateAsciiSTL(target, base), `${base}_shell.stl`, 'text/plain');
    else if (format === 'obj') triggerDownload(generateOBJ(target, base), `${base}_shell.obj`, 'text/plain');
    else if (format === 'step') triggerDownload(generateStepAP214(target, base), `${base}_shell.step`, 'text/plain');
    showToast(`Exported ${format.toUpperCase()}`);
  }, [shell, scanGeo, scanName, triggerDownload, showToast]);

  // ------------------------------------------------------------ keyboard --
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); restoreHistory(-1); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); restoreHistory(1); }      else if (e.key.toLowerCase() === 'g') setTool('grow');
      else if (e.key.toLowerCase() === 'p') setTool('pick');
      else if (e.key.toLowerCase() === 's') setTool('section');
      else if (e.key.toLowerCase() === 'a') setTool('box');
      else if (e.key.toLowerCase() === 'b') setTool('paint');
      else if (e.key.toLowerCase() === 'e') setTool('erase');
      else if (e.key === 'Enter') { if (sectionPts.length >= 3 && !sectionClosed) doCloseSection(); }
      else if (e.code === 'Space') {
        e.preventDefault();
        setSectionMode((m) => {
          const next = m === 'line' ? 'spline' : 'line';
          showToast(`Section outline: ${next === 'spline' ? 'smooth spline' : 'straight lines'}`);
          return next;
        });
      }
      else if (e.key === 'Escape') { setSectionSel(null); }
      else if (e.key === 'c') doCloseSection();
      else if (e.key === 'o') doCloseSelection();
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sectionSel !== null) doDeleteSectionPoint();
        else clearSelection();
      }
      else if (e.key === 'f') fitView();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [restoreHistory, clearSelection, fitView, doCloseSelection, doCloseSection, doDeleteSectionPoint, sectionSel]);

  // --------------------------------------------------------------- UI ----
  const BTN = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold leading-tight whitespace-nowrap text-slate-200 transition hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed';

  const models = [
    { name: 'Hand Grip Bar', fn: createHandGripScan, desc: 'Scanned grip + hole + debris' },
    { name: 'Machined Flange', fn: createFlangeScan, desc: 'Bored plate with speckle' },
    { name: 'Organic Shell', fn: createShellScan, desc: 'Dome with irregular void' }
  ];

  return (
    <div className="flex flex-col w-full h-full bg-[#05080f] text-slate-100 select-none overflow-hidden relative font-sans">
      {/* ======================================================= HEADER ==== */}
      <header className="h-12 bg-[#080d1a] border-b border-slate-800 shrink-0 flex items-center gap-2 px-2 sm:px-3 shadow-xl z-30 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-emerald-600 via-cyan-500 to-sky-400 flex items-center justify-center shadow-md">
            <Icon name="shield" className="w-4 h-4 text-white" />
          </div>
          <div className="leading-none hidden sm:block">
            <span className="block font-extrabold tracking-wider text-white text-[13px]">MESHPLUG STUDIO</span>
            <span className="block text-[9px] font-mono text-emerald-300 mt-0.5">by Wayne Scicluna</span>
          </div>
        </div>
        <div className="w-px h-7 bg-slate-800/80" />

        <Tooltip title="Workflow" tip="MeshPlug walks you through five steps: load a scan, repair it, pick the area, mould the shell, export it. Click to jump to a step.">
          <button
            onClick={() => { setDrawerOpen(true); setStep(step); }}
            className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center gap-2 hover:border-cyan-500/50"
          >
            <span className="font-mono text-[10px] text-cyan-400 font-bold">{step}/5</span>
            <span className="text-[11px] font-bold text-slate-200 uppercase tracking-wider">{WORKFLOW_STEPS[step - 1].label}</span>
          </button>
        </Tooltip>

        <Tooltip title="Undo / Redo" tip="Ctrl+Z / Ctrl+Y walks the repair history.">
          <div className="flex items-center gap-1">
            <button onClick={() => restoreHistory(-1)} disabled={historyRef.current.idx <= 0} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30"><Icon name="undo" className="w-3.5 h-3.5" /></button>
            <button onClick={() => restoreHistory(1)} disabled={historyRef.current.idx >= historyRef.current.list.length - 1} className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-30"><Icon name="redo" className="w-3.5 h-3.5" /></button>
          </div>
        </Tooltip>
        <div className="flex-1" />

        <div className="flex items-center gap-1.5 shrink-0">
          <Tooltip title="Frame model" tip="Refit the camera to the whole scan (F).">
            <button onClick={fitView} className={BTN}><Icon name="target" className="w-3.5 h-3.5" /> <span className="hidden md:inline">Fit</span></button>
          </Tooltip>
          <div className="hidden lg:flex items-center bg-slate-900 p-0.5 rounded-xl border border-slate-800">
            {['iso', 'front', 'side', 'top'].map((p) => (
              <button key={p} onClick={() => setCameraView(p)} className="px-2 py-1 rounded-lg text-[10px] font-semibold uppercase text-slate-400 hover:text-white hover:bg-slate-800">{p}</button>
            ))}
          </div>
          <Tooltip title="Projection" tip="Orthographic projection shows true dimensions - use it to check wall thickness.">
            <button onClick={() => applyProjection(projection === 'persp' ? 'ortho' : 'persp')} className={BTN}>
              <Icon name="compass" className="w-3.5 h-3.5" /> <span className="hidden md:inline">{projection === 'persp' ? 'PERSP' : 'ORTHO'}</span>
            </button>
          </Tooltip>
          <Tooltip title="Inspector" tip="Show or hide the MeshPlug inspector drawer.">
            <button onClick={() => setDrawerOpen(!drawerOpen)} className={BTN}>
              <Icon name="sliders" className="w-3.5 h-3.5" /> <span className="hidden md:inline">Panel</span>
            </button>
          </Tooltip>
        </div>
      </header>

      {/* ======================================================== BODY ==== */}
      <div className="flex-1 flex min-h-0 relative">
        <div
          ref={mountRef}
          className="flex-1 relative min-w-0 cad-canvas"
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        />

        {/* Area selection rubber band */}
        {boxRect && (
          <div
            className="absolute pointer-events-none border-2 border-cyan-400 bg-cyan-400/10 rounded-sm z-10"
            style={{
              left: Math.min(boxRect.x0, boxRect.x1),
              top: Math.min(boxRect.y0, boxRect.y1),
              width: Math.abs(boxRect.x1 - boxRect.x0),
              height: Math.abs(boxRect.y1 - boxRect.y0)
            }}
          />
        )}

        {/* Floating HUD */}
        <div className="absolute top-3 left-3 pointer-events-none space-y-1.5">
          <div className="cad-glass rounded-xl border border-slate-700/70 px-3 py-2 space-y-0.5">
            <div className="text-[9px] uppercase tracking-[0.18em] text-emerald-300 font-bold">MeshPlug</div>
            <div className="text-[10px] font-mono text-slate-300">{scanName}</div>
            {analysis && (
              <div className="text-[10px] font-mono text-slate-500">
                {analysis.triangleCount.toLocaleString()} tris &middot; {analysis.vertexCount.toLocaleString()} verts
              </div>
            )}
          </div>
          {selStats.faces > 0 && (
            <div className="cad-glass rounded-xl border border-cyan-500/40 px-3 py-2">
              <div className="text-[10px] font-mono text-cyan-300 font-bold">
                {selStats.faces.toLocaleString()} faces selected ({selStats.percent.toFixed(1)}%)
              </div>
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-[11px] font-semibold shadow-2xl border backdrop-blur-md ${toast.tone === 'error'
            ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
            : 'bg-[#03060c]/90 border-emerald-500/40 text-emerald-200'}`}>
            {toast.msg}
          </div>
        )}

        {/* ==================================================== DRAWER ==== */}
        {drawerOpen && (
          <aside className="w-[340px] shrink-0 bg-[#080d1a] border-l border-slate-800 flex flex-col z-20 absolute md:relative md:inset-auto inset-y-0 right-0">
            {/* Workflow stepper */}
            <div className="px-2 py-2 border-b border-slate-800 bg-[#0a0f1d] shrink-0">
              <div className="grid grid-cols-5 gap-1">
                {WORKFLOW_STEPS.map((s) => {
                  const done = stepDone(s.id);
                  const active = step === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setStep(s.id)}
                      title={s.hint}
                      className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg border transition ${active
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-100'
                        : done
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-slate-900 border-slate-800 text-slate-500 hover:text-slate-300'}`}
                    >
                      {done
                        ? <Icon name="check" className="w-3 h-3" />
                        : <Icon name={s.icon} className="w-3 h-3" />}
                      <span className="text-[9px] font-bold uppercase tracking-wider">{s.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto cad-scroll">
              {/* ============================================ STEP 1: SCAN */}
              {step === 1 && (
                <>
                <Hint tone={scanGeo ? 'good' : 'info'}>
                  <span className="font-bold block mb-0.5">Step 1 of 5 - Load a scan</span>
                  {scanGeo ? `Loaded: ${scanName}. Continue to step 2 to repair it.` : 'Import an STL / OBJ / PLY file, or pick a calibrated sample below.'}
                </Hint>
                <div className="p-3 space-y-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 py-2.5 text-[11px] font-bold text-white"
                >
                  <Icon name="upload" className="w-4 h-4" /> Import STL / OBJ / PLY
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".stl,.obj,.ply"
                  className="hidden"
                  onChange={(e) => { handleFileUpload(e.target.files[0]); e.target.value = ''; }}
                />
                <Field label="Import scale" value={importScale} onChange={setImportScale} unit="×" step={0.01} min={0.01} max={100} />
                <div className="text-[10px] text-slate-500 leading-relaxed">
                  Multiply the imported coordinates (use 10 for centimetre scans, 25.4 for inch scans).
                </div>
                <div className="pt-1 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">Calibrated samples</div>
                  {models.map((m) => (
                    <button
                      key={m.name}
                      onClick={() => loadMesh(m.fn(), m.name, 1)}
                      className="w-full px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 text-left"
                    >
                      <div className="text-[11px] font-semibold text-slate-200">{m.name}</div>
                      <div className="text-[10px] text-slate-500">{m.desc}</div>
                    </button>
                  ))}
                </div>
                {analysis && (
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                    <Stat label="Triangles" value={analysis.triangleCount.toLocaleString()} />
                    <Stat label="Vertices" value={analysis.vertexCount.toLocaleString()} />
                    <Stat label="Size (mm)" value={`${analysis.size.x.toFixed(1)} × ${analysis.size.y.toFixed(1)} × ${analysis.size.z.toFixed(1)}`} />
                    <Stat label="Volume (cm³)" value={(analysis.volume / 1000).toFixed(2)} />
                    <Stat label="Area (cm²)" value={(analysis.area / 100).toFixed(1)} />
                    <Stat label="Watertight" value={analysis.watertight ? 'YES' : 'NO'} tone={analysis.watertight ? 'text-emerald-400' : 'text-rose-400'} />
                  </div>
                )}
                </div>
                </>
              )}

              {/* ========================================== STEP 2: REPAIR */}
              {step === 2 && (
                <>
                <Hint tone={analysis && analysis.boundaryEdges === 0 ? 'good' : 'warn'}>
                  <span className="font-bold block mb-0.5">Step 2 of 5 - Repair the scan</span>
                  {analysis && analysis.boundaryEdges === 0
                    ? 'No open holes left. You can go to step 3 and pick the area.'
                    : `This scan has ${analysis ? analysis.boundaryEdges : 0} open edge(s) in ${analysis ? analysis.loopCount : 0} hole(s). Fill them first.`}
                </Hint>
                <div className="p-3 space-y-3">
                {analysis && (
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                    <Stat label="Holes / open edges" value={analysis.boundaryEdges} tone={analysis.boundaryEdges ? 'text-rose-400' : 'text-emerald-400'} />
                    <Stat label="Hole loops" value={analysis.loopCount} tone={analysis.loopCount ? 'text-rose-400' : 'text-emerald-400'} />
                    <Stat label="Total hole area (mm²)" value={analysis.holeArea.toFixed(1)} />
                    <Stat label="Non-manifold edges" value={analysis.nonManifoldEdges} tone={analysis.nonManifoldEdges ? 'text-amber-400' : 'text-emerald-400'} />
                    <Stat label="Inconsistent winding" value={analysis.inconsistentWinding} tone={analysis.inconsistentWinding ? 'text-amber-400' : 'text-emerald-400'} />
                    <Stat label="Degenerate triangles" value={analysis.degenerate} />
                    <Stat label="Duplicate vertices" value={analysis.duplicateVertices} />
                    <Stat label="Shell components" value={analysis.componentCount} />
                    <Stat label="Min edge length" value={`${analysis.minEdge.toFixed(3)} mm`} />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={doWeld} className={`${BTN} justify-center`}>Weld + Clean</button>
                  <button onClick={doRepairNormals} className={`${BTN} justify-center`}>Fix Normals</button>
                  <button onClick={doFlipNormals} className={`${BTN} justify-center col-span-2`}>
                    <Icon name="refresh" className="w-3.5 h-3.5" /> Flip Normals (invert shell direction)
                  </button>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Fill holes</div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[['curved', 'Curvature fit'], ['flat', 'Flat cap']].map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setFillMode(id)}
                        className={`py-1.5 rounded-lg text-[10px] font-bold border ${fillMode === id ? 'bg-sky-600 border-sky-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'}`}
                      >{label}</button>
                    ))}
                  </div>
                  <Field label="Max hole area" value={maxHoleArea} onChange={setMaxHoleArea} unit="mm²" step={100} min={0} max={20000} />
                  <button onClick={doFillHoles} className={`${BTN} w-full justify-center bg-sky-600/80 hover:bg-sky-500 border-sky-400/40 text-white`}>
                    <Icon name="check" className="w-3.5 h-3.5" /> Fill {analysis ? analysis.loopCount : 0} hole(s)
                  </button>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Taubin smoothing</div>
                  <Field label="Iterations" value={smoothIters} onChange={setSmoothIters} step={1} min={1} max={60} />
                  <Field label="Lambda" value={smoothLambda} onChange={setSmoothLambda} step={0.01} min={0.1} max={0.8} />
                  <Field label="Preserve creases over" value={featureAngle} onChange={setFeatureAngle} unit="°" step={1} min={5} max={180} />
                  <button onClick={doSmooth} className={`${BTN} w-full justify-center`}>
                    <Icon name="wave" className="w-3.5 h-3.5" /> Smooth Scan
                  </button>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Decimate (QEM)</div>
                  <Field label="Keep ratio" value={decimateRatio} onChange={setDecimateRatio} unit="×" step={0.05} min={0.05} max={1} />
                  <button onClick={doDecimate} className={`${BTN} w-full justify-center`}>
                    <Icon name="grid" className="w-3.5 h-3.5" /> Simplify
                  </button>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Debris removal</div>
                  <Field label="Min component triangles" value={minComponentTris} onChange={setMinComponentTris} step={10} min={1} max={5000} />
                  <button onClick={doCullComponents} className={`${BTN} w-full justify-center`}>
                    <Icon name="trash" className="w-3.5 h-3.5" /> Keep big shells only
                  </button>
                </div>
                </div>
                </>
              )}

              {/* =========================================== STEP 3: AREA */}
              {step === 3 && (
                <>
                <Hint tone={selStats.faces ? 'good' : 'info'}>
                  <span className="font-bold block mb-0.5">Step 3 of 5 - Choose the area</span>
                  {selStats.faces
                    ? `${selStats.faces.toLocaleString()} faces picked (${selStats.percent.toFixed(1)}% of the scan).`
                    : TOOL_HELP[tool]}
                </Hint>
                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-3 gap-1.5">
                    {SELECTION_TOOLS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTool(t.id)}
                        className={`px-1.5 py-2 rounded-xl border text-left transition ${tool === t.id
                          ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-100'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200'}`}
                      >
                        <Icon name={t.icon} className="w-3.5 h-3.5 mb-1" />
                        <span className="block text-[11px] font-bold">{t.label}</span>
                        <span className="block text-[9px] leading-tight opacity-70">{t.help}</span>
                      </button>
                    ))}
                  </div>
                {tool === 'section' && (
                <div className="p-2.5 rounded-xl bg-slate-900 border border-amber-500/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">Section</span>
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${sectionClosed && selStats.faces
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : sectionPts.length ? 'bg-amber-500/20 text-amber-300' : 'bg-slate-800 text-slate-500'}`}>
                      {sectionPts.length
                        ? `${sectionPts.length} pts${sectionClosed ? (selStats.faces ? ` - ${selStats.faces.toLocaleString()} faces` : ' - closed') : ''}`
                        : 'no section'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 leading-relaxed">
                    {sectionClosed
                      ? (selStats.faces
                        ? `The area inside the section is selected (${selStats.faces.toLocaleString()} faces). Click inside it again to pick a different side.`
                        : 'The section is closed but no area was found inside it - click on the surface inside the outline.')
                      : 'Click points on the mesh: the outline is drawn between them.'}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-700 flex-1">
                      {[['line', 'Lines'], ['spline', 'Splines']].map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => setSectionMode(id)}
                          className={`flex-1 py-1 rounded-md text-[10px] font-bold transition ${sectionMode === id ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}
                        >{label}</button>
                      ))}
                    </div>
                    <kbd className="font-mono text-[9px] px-1.5 py-1 rounded bg-slate-800 border border-slate-700 text-slate-400">Space</kbd>
                  </div>
                  <div className="text-[10px] text-slate-500 leading-relaxed">
                    <strong className="text-slate-300">Lines</strong> joins the points with straight chords,
                    <strong className="text-slate-300"> Splines</strong> runs a smooth curve through them. Press
                    <kbd className="font-mono text-[9px] px-1 rounded bg-slate-800 border border-slate-700"> Space</kbd> to switch.
                  </div>
                  {!sectionClosed && sectionPts.length >= 3 && (
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40">
                      <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-amber-500/50 text-amber-200">Enter</kbd>
                      <span className="text-[10px] text-amber-200 font-semibold">closes the section</span>
                    </div>
                  )}
                  {sectionSel !== null && (
                    <div className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/40">
                      <span className="text-[10px] text-cyan-200 font-semibold">Point {sectionSel + 1} selected</span>
                      <button onClick={doDeleteSectionPoint} className="text-[10px] font-bold text-rose-300 hover:text-rose-200">Delete</button>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button onClick={doUndoSectionPoint} disabled={!sectionPts.length} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-30">Undo pt</button>
                    <button onClick={doClearSection} disabled={!sectionPts.length} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-rose-300 hover:bg-slate-700 disabled:opacity-30">Clear</button>
                    <button onClick={doInvertSection} disabled={!selStats.faces} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-cyan-300 hover:bg-slate-700 disabled:opacity-30">Invert</button>
                  </div>
                  <button
                    onClick={doCloseSection}
                    disabled={sectionPts.length < 3 || sectionClosed}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-400 py-2 text-[11px] font-extrabold text-slate-950 disabled:opacity-40"
                  >
                    <Icon name={sectionClosed ? 'check' : 'brackets'} className="w-3.5 h-3.5" />
                    {sectionClosed ? 'Section Closed' : 'Close Section'}
                    {!sectionClosed && (
                      <kbd className="font-mono text-[9px] px-1 py-0.5 rounded bg-slate-900/70 border border-slate-900/40 text-slate-200">Enter</kbd>
                    )}
                  </button>
                  <div className="text-[10px] text-slate-500 leading-relaxed">
                    Click a point to grab it, then click the mesh to move it. <strong className="text-slate-300">Del</strong> removes
                    the grabbed point, <strong className="text-slate-300">Esc</strong> lets go of it.
                  </div>
                </div>
                )}

                <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Selection</span>
                    <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${selStats.faces ? 'bg-cyan-500/20 text-cyan-300' : 'bg-slate-800 text-slate-500'}`}>
                      {selStats.faces ? `${selStats.faces.toLocaleString()} faces` : 'no area picked'}
                    </span>
                  </div>
                  {selStats.faces > 0 && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                      <Stat label="Coverage" value={`${selStats.percent.toFixed(1)}%`} />
                      <Stat label="Skin area" value={`${(selStats.area / 100).toFixed(1)} cm²`} />
                      <Stat label="Area size X" value={`${selStats.size.x.toFixed(1)} mm`} />
                      <Stat label="Area size Y" value={`${selStats.size.y.toFixed(1)} mm`} />
                    </div>
                  )}
                  {closedLoops && closedLoops.length > 0 && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 pt-1 border-t border-slate-800">
                      <Stat label="Closed loops" value={closedLoops.length} tone="text-amber-300" />
                      <Stat label="Outline" value={`${closedLoops.reduce((s, l) => s + l.perimeter, 0).toFixed(1)} mm`} tone="text-amber-300" />
                    </div>
                  )}
                  {tool === 'pick' && (
                    <Field label="Pick radius" value={pickRadius} onChange={setPickRadius} unit="mm" step={0.5} min={1} max={60} />
                  )}
                  {tool === 'grow' && (
                    <Field label="Crease limit" value={growAngle} onChange={setGrowAngle} unit="°" step={1} min={1} max={180} />
                  )}
                  {tool === 'paint' && (
                    <Field label="Brush radius" value={brushRadius} onChange={setBrushRadius} unit="mm" step={0.5} min={1} max={80} />
                  )}
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-700 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase tracking-wider text-slate-300 font-bold">Smooth selection</span>
                      <button
                        onClick={doSmoothSelection}
                        disabled={!selStats.faces}
                        className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[10px] font-bold text-emerald-300 disabled:opacity-30"
                      >
                        Apply
                      </button>
                    </div>
                    <Field label="Passes" value={smoothStrength} onChange={setSmoothStrength} step={1} min={1} max={6} />
                    <div className="text-[10px] text-slate-500 leading-relaxed">
                      With a traced section the outline itself is rounded off and the region is re-derived
                      from it. Otherwise the stepped face outline is cleaned - thin protrusions go,
                      shallow notches get filled.
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5">
                    <button onClick={selectAll} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-slate-200 hover:bg-slate-700">All</button>
                    <button onClick={clearSelection} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-rose-300 hover:bg-slate-700">None</button>
                    <button onClick={invertSelection} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-amber-300 hover:bg-slate-700">Inv</button>
                    <button onClick={keepLargest} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-cyan-300 hover:bg-slate-700">Island</button>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button onClick={() => growSelection(1)} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-slate-300 hover:bg-slate-700">Grow +1</button>
                    <button onClick={() => growSelection(-1)} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-slate-300 hover:bg-slate-700">Shrink -1</button>
                    <button onClick={() => growSelection(2)} className="py-1.5 rounded-lg bg-slate-800 text-[10px] font-bold text-slate-300 hover:bg-slate-700">Grow +2</button>
                  </div>
                  <button
                    onClick={doCloseSelection}
                    disabled={!selStats.faces}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-slate-800 hover:bg-slate-700 py-2 text-[11px] font-bold text-slate-200 disabled:opacity-40"
                  >
                    <Icon name="check" className="w-3.5 h-3.5" /> Trace Selection Outline
                  </button>
                  <div className="text-[10px] text-slate-500 leading-relaxed">
                    Traces the closed boundary of every picked region and draws it on the model in
                    yellow - the shell rim then follows that outline. Nothing is discarded.
                  </div>
                </div>
                </div>
                </>
              )}

              {/* ========================================== STEP 4: SHELL */}
              {step === 4 && (
                <>
                <Hint tone={shell && shell.stats ? 'good' : 'info'}>
                  <span className="font-bold block mb-0.5">Step 4 of 5 - Mould the shell</span>
                  {shell && shell.stats
                    ? `Shell built: ${shell.stats.shellTriangles.toLocaleString()} triangles, min wall ${shell.stats.minWall.toFixed(2)} mm.`
                    : 'The shell is built over the selected area only. Set the wall thickness, then press Build Shell.'}
                </Hint>
                <div className="p-3 space-y-3">
                <div className="p-2.5 rounded-xl bg-slate-900 border border-emerald-500/30 space-y-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-bold">Solidify shell</div>
                  <div className="text-[10px] text-slate-400 leading-relaxed">
                    The shell is built over the <strong className="text-cyan-300">selected area only</strong> - its rim
                    wall closes the border of that area, so the result is a standalone printable part.
                  </div>
                  <Field label="Wall thickness" value={thickness} onChange={setThickness} unit="mm" step={0.1} min={0.1} max={30} />
                  <Field label="Fit clearance" value={clearance} onChange={setClearance} unit="mm" step={0.05} min={0} max={5} />
                  <div className="grid grid-cols-2 gap-1.5">
                    {[['outer', 'Outside'], ['inner', 'Inside']].map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setShellSide(id)}
                        className={`py-1.5 rounded-lg text-[10px] font-bold border ${shellSide === id ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'}`}
                      >{label}</button>
                    ))}
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold pt-1">Rim wall</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[['flat', 'Flat'], ['rounded', 'Bullnose'], ['none', 'Open']].map(([id, label]) => (
                      <button
                        key={id}
                        onClick={() => setRimStyle(id)}
                        className={`py-1.5 rounded-lg text-[10px] font-bold border ${rimStyle === id ? 'bg-emerald-600 border-emerald-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'}`}
                      >{label}</button>
                    ))}
                  </div>
                  <label className="flex items-center justify-between text-[10px] text-slate-300 pt-1">
                    Smooth rim edge
                    <input type="checkbox" checked={rimSmooth} onChange={(e) => setRimSmooth(e.target.checked)} className="w-4 h-4 accent-emerald-500" />
                  </label>
                  {rimSmooth && (
                    <Field label="Rim smoothing passes" value={rimSmoothPasses} onChange={setRimSmoothPasses} step={1} min={1} max={5} />
                  )}
                  <div className="text-[10px] text-slate-500 leading-relaxed">
                    A face set can only have a stepped outline - the rim edge is pushed onto a smooth curve
                    so the moulded part does not come out with a zig-zag edge.
                  </div>
                  {rimStyle === 'rounded' && (
                    <Field label="Bullnose segments" value={rimSegments} onChange={setRimSegments} step={1} min={2} max={16} />
                  )}
                  <label className="flex items-center justify-between text-[10px] text-slate-400">
                    Even-thickness miter
                    <input type="checkbox" checked={useMiter} onChange={(e) => setUseMiter(e.target.checked)} className="w-4 h-4 accent-emerald-500" />
                  </label>
                  {useMiter && (
                    <Field label="Miter limit" value={miterLimit} onChange={setMiterLimit} unit="×" step={0.5} min={1} max={8} />
                  )}
                  <button
                    onClick={doBuildShell}
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 py-2.5 text-[11px] font-extrabold text-slate-950 disabled:opacity-50"
                  >
                    <Icon name="box" className="w-4 h-4" /> Build Shell
                  </button>
                </div>

                {shell && shell.stats && (
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-emerald-500/30 space-y-1">
                    <Stat label="Shell triangles" value={shell.stats.shellTriangles.toLocaleString()} />
                    <Stat label="Min wall (measured)" value={`${shell.stats.minWall.toFixed(2)} mm`} tone={shell.stats.minWall < thickness * 0.9 ? 'text-rose-400' : 'text-emerald-400'} />
                    <Stat label="Avg wall" value={`${shell.stats.avgWall.toFixed(2)} mm`} />
                    <Stat label="Material volume" value={`${(shell.stats.volume / 1000).toFixed(2)} cm³`} />
                    <Stat label="Watertight" value={shell.stats.watertight ? 'YES' : 'NO'} tone={shell.stats.watertight ? 'text-emerald-400' : 'text-rose-400'} />
                    <Stat label="Open edges" value={shell.stats.openEdges} />
                    <Stat label="Non-manifold edges" value={shell.stats.nonManifoldEdges} tone={shell.stats.nonManifoldEdges ? 'text-rose-400' : 'text-emerald-400'} />
                    <Stat label="Folded triangles" value={shell.stats.invertedTriangles} tone={shell.stats.invertedTriangles ? 'text-amber-400' : 'text-emerald-400'} />
                    <button onClick={doBooleanSubtract} className={`${BTN} w-full justify-center mt-1`}>
                      <Icon name="scissors" className="w-3.5 h-3.5" /> Subtract scan from shell
                    </button>
                  </div>
                )}
                </div>
                </>
              )}

              {/* ========================================= STEP 5: EXPORT */}
              {step === 5 && (
                <>
                <Hint tone={shell && shell.stats ? 'good' : 'info'}>
                  <span className="font-bold block mb-0.5">Step 5 of 5 - Export</span>
                  {shell && shell.stats
                    ? 'This exports the moulded shell. It is watertight and ready for a slicer.'
                    : 'No shell built yet - this will export the repaired scan itself. Build a shell in step 4 first.'}
                </Hint>
                <div className="p-3 space-y-3">
                <div className="text-[10px] text-slate-500 leading-relaxed">
                  Exports the shell when one exists, otherwise the repaired scan itself.
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => exportGeometry('stl')} className={`${BTN} justify-center bg-emerald-600/80 border-emerald-400/40 text-white`}>STL binary</button>
                  <button onClick={() => exportGeometry('stl-ascii')} className={`${BTN} justify-center`}>STL ascii</button>
                  <button onClick={() => exportGeometry('obj')} className={`${BTN} justify-center bg-sky-600/80 border-sky-400/40 text-white`}>OBJ</button>
                  <button onClick={() => exportGeometry('step')} className={`${BTN} justify-center`}>STEP AP214</button>
                </div>
                {shell && shell.stats && (
                  <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-[10px] text-slate-400 leading-relaxed">
                    Printing note: at {thickness.toFixed(2)} mm wall and {clearance.toFixed(2)} mm clearance the shell needs a{' '}
                    <strong className="text-emerald-300">{(thickness / 0.4).toFixed(1)} mm</strong> nozzle or finer, and the
                    measured minimum wall is <strong className="text-cyan-300">{shell.stats.minWall.toFixed(2)} mm</strong>.
                  </div>
                )}
                </div>
                </>
              )}

              {/* Display options - always available, never in the way */}
              <div className="border-t border-slate-800">
                <button
                  onClick={() => setShowDisplay(!showDisplay)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-slate-800/50"
                >
                  <Icon name="eye" className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-200 flex-1">Display options</span>
                  <Icon name={showDisplay ? 'chevronDown' : 'chevronRight'} className="w-3 h-3 text-slate-500" />
                </button>
                {showDisplay && (
                  <div className="px-3 pb-3 space-y-2">
                    <label className="flex items-center justify-between text-[10px] text-slate-300">
                      Show scan
                      <input type="checkbox" checked={showScan} onChange={(e) => setShowScan(e.target.checked)} className="w-4 h-4 accent-blue-500" />
                    </label>
                    <label className="flex items-center justify-between text-[10px] text-slate-300">
                      Show shell
                      <input type="checkbox" checked={showShell} onChange={(e) => setShowShell(e.target.checked)} className="w-4 h-4 accent-emerald-500" />
                    </label>
                    <label className="flex items-center justify-between text-[10px] text-slate-300">
                      Show selection
                      <input type="checkbox" checked={showSelection} onChange={(e) => setShowSelection(e.target.checked)} className="w-4 h-4 accent-cyan-500" />
                    </label>
                    <label className="flex items-center justify-between text-[10px] text-slate-300">
                      Mark holes
                      <input type="checkbox" checked={showHoles} onChange={(e) => setShowHoles(e.target.checked)} className="w-4 h-4 accent-rose-500" />
                    </label>
                    <label className="flex items-center justify-between text-[10px] text-slate-300">
                      Scan wireframe
                      <input type="checkbox" checked={wireframe} onChange={(e) => setWireframe(e.target.checked)} className="w-4 h-4 accent-cyan-500" />
                    </label>
                    <Field label="Scan opacity" value={scanOpacity} onChange={setScanOpacity} step={0.05} min={0.1} max={1} />
                    <Field label="Shell opacity" value={shellOpacity} onChange={setShellOpacity} step={0.05} min={0.1} max={1} />
                    <div className="text-[10px] text-slate-500 leading-relaxed">
                      The selection always draws in front of the model. Drop the shell opacity to 25% to
                      look inside the cavity wall.
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Step navigation */}
            <div className="border-t border-slate-800 bg-[#0a0f1d] px-2 py-2 flex items-center gap-2 shrink-0">
              <button
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-200 disabled:opacity-30"
              >
                Back
              </button>
              <div className="flex-1 text-center">
                <div className="text-[9px] font-mono uppercase tracking-wider text-slate-500">Step {step} of 5</div>
                <div className="text-[11px] font-bold text-cyan-300">{WORKFLOW_STEPS[step - 1].label}</div>
              </div>
              <button
                onClick={() => setStep((s) => Math.min(5, s + 1))}
                disabled={step === 5}
                className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-[11px] font-bold text-white disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* ======================================================= FOOTER ==== */}
      <footer className="h-8 bg-[#080d1a] border-t border-slate-800 px-4 flex items-center justify-between text-[11px] text-slate-400 shrink-0">
        <div className="flex items-center gap-4 font-mono">
          <span className="flex items-center gap-1.5 text-cyan-300 font-sans font-semibold">
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/30">
              {step}/5
            </span>
            {WORKFLOW_STEPS[step - 1].label}
          </span>
          <span className="hidden lg:inline text-slate-500 truncate max-w-[46ch]">{WORKFLOW_STEPS[step - 1].hint}</span>
          {analysis && (
            <>
              <span>Tris: <strong className="text-white">{analysis.triangleCount.toLocaleString()}</strong></span>
              <span>Holes: <strong className={analysis.boundaryEdges ? 'text-rose-400' : 'text-emerald-400'}>{analysis.boundaryEdges}</strong></span>
              <span>Shell: <strong className={analysis.watertight ? 'text-emerald-400' : 'text-amber-400'}>{analysis.watertight ? 'closed' : 'open'}</strong></span>
            </>
          )}
          {hoverInfo && <span className="text-cyan-300">Face <strong>#{hoverInfo.face}</strong></span>}
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden md:inline">P pick &middot; S section &middot; A area &middot; G grow &middot; B brush &middot; E erase &middot; Space spline &middot; Enter close &middot; F fit</span>
          <span className="font-mono text-slate-500">units: mm</span>
        </div>
      </footer>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
