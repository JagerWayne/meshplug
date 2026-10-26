// ============================================================================
// INSPECTOR PANELS
// ============================================================================
// The five steps of the guided workflow, split out of the main application.
//
// Each panel is presentational: it reads its state and calls its actions
// through a single props object, so app.js owns the state and this file owns
// the layout. The props each panel needs are listed with it.
//
// Only the visible step is mounted, so the panels that are off screen cost
// nothing.

const ScanPanel = ({ p }) => {
  const {
    analysis,
    fileInputRef,
    handleFileUpload,
    importScale,
    loadMesh,
    scanGeo,
    scanName,
    setImportScale,
    step,
  } = p;
  return (
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
  );
};

const FixPanel = ({ p }) => {
  const {
    analysis,
    decimateRatio,
    doCullComponents,
    doDecimate,
    doFillHoles,
    doFlipNormals,
    doRepairNormals,
    doSmooth,
    doWeld,
    featureAngle,
    fillMode,
    maxHoleArea,
    minComponentTris,
    previewMode,
    setDecimateRatio,
    setFeatureAngle,
    setFillMode,
    setMaxHoleArea,
    setMinComponentTris,
    setPreviewMode,
    setSmoothIters,
    setSmoothLambda,
    shell,
    smoothIters,
    smoothLambda,
    step,
  } = p;
  return (
    <>
        <Hint tone={analysis && analysis.boundaryEdges === 0 ? 'good' : 'warn'}>
          <span className="font-bold block mb-0.5">Step 2 of 5 - Repair the scan</span>
          {analysis && analysis.boundaryEdges === 0
            ? 'No open holes left. You can go to step 3 and pick the area.'
            : `This scan has ${analysis ? analysis.boundaryEdges : 0} open edge(s) in ${analysis ? analysis.loopCount : 0} hole(s). Fill them first.`}
        </Hint>
        <div className="p-3 space-y-3">
        <label className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-900 border border-slate-800 cursor-pointer hover:border-slate-700">
          <input
            type="checkbox"
            checked={previewMode}
            onChange={(e) => setPreviewMode(e.target.checked)}
            className="w-4 h-4 mt-0.5 accent-emerald-500 shrink-0"
          />
          <span className="flex-1">
            <span className="block text-[11px] font-bold text-slate-200">Preview repairs</span>
            <span className="block text-[10px] text-slate-500 leading-relaxed mt-0.5">
              Show the result as a green ghost first. Nothing changes until you accept it.
            </span>
          </span>
        </label>
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
  );
};

const AreaPanel = ({ p }) => {
  const {
    brushRadius,
    clearSelection,
    closedLoops,
    doClearSection,
    doCloseSection,
    doCloseSelection,
    doDeleteSectionPoint,
    doInvertSection,
    doSmoothSelection,
    doUndoSectionPoint,
    growAngle,
    growSelection,
    invertSelection,
    keepLargest,
    pickRadius,
    sectionClosed,
    sectionPts,
    sectionSel,
    selStats,
    selectAll,
    setBrushRadius,
    setGrowAngle,
    setPickRadius,
    sectionMode,
    setSectionMode,
    setSmoothStrength,
    setTool,
    shell,
    smoothStrength,
    tool,
  } = p;
  return (
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
  );
};

const ShellPanel = ({ p }) => {
  const {
    busy,
    clearance,
    doBooleanSubtract,
    doBuildShell,
    miterLimit,
    rimSegments,
    rimSmooth,
    rimSmoothPasses,
    rimStyle,
    setClearance,
    setMiterLimit,
    setRimSegments,
    setRimSmooth,
    setRimSmoothPasses,
    setRimStyle,
    setShellSide,
    setThickness,
    setUseMiter,
    shell,
    shellSide,
    thickness,
    useMiter,
  } = p;
  return (
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
  );
};

const ExportPanel = ({ p }) => {
  const {
    clearance,
    exportGeometry,
    shell,
    step,
    thickness,
  } = p;
  return (
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
  );
};
