// ============================================================================
// 4. MESH PARSERS & EXPORTERS  (STL / OBJ / PLY  ->  STL / OBJ / STEP)
// ============================================================================

// Reads a glTF / GLB file via the GLTFLoader. The scene's meshes are merged
// into a single geometry, with their world matrices applied.
function parseGLTF(buffer, onProgress) {
  return new Promise((resolve, reject) => {
    if (!THREE.GLTFLoader) {
      reject(new Error('GLTFLoader is not available'));
      return;
    }
    if (onProgress) onProgress(0.2, 'Parsing glTF');
    const loader = new THREE.GLTFLoader();
    loader.parse(buffer, '', (gltf) => {
      try {
        if (onProgress) onProgress(0.8, 'Building mesh');
        resolve(gltfToGeometry(gltf));
        if (onProgress) onProgress(1, 'Loaded');
      } catch (e) {
        reject(e);
      }
    }, (err) => reject(new Error((err && err.message) || 'glTF parse failed')));
  });
}

// Flattens a glTF scene graph into one BufferGeometry.
function gltfToGeometry(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const geometries = [];
  gltf.scene.traverse((node) => {
    if (node.isMesh && node.geometry) {
      const g = node.geometry.clone();
      if (g.attributes.position) g.applyMatrix4(node.matrixWorld);
      if (g.index || g.attributes.position) geometries.push(g);
    }
  });
  if (!geometries.length) throw new Error('No meshes in the file');
  const merged = geometries.reduce((acc, g) => mergeGeometries(acc, g));
  const welded = weldVertices(merged);
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

// Reads a File into an ArrayBuffer, reporting the download progress.
function readFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!onProgress || !file.size) {
      file.arrayBuffer().then(resolve, reject);
      return;
    }
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total, 'Reading file');
    };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsArrayBuffer(file);
  });
}

// Reads a binary or ASCII STL. Facet normals from the file are ignored and
// recomputed from the triangle winding.
async function parseSTL(buffer, onProgress) {
  if (!buffer || buffer.byteLength === 0) throw new Error('Empty file');
  const view = new DataView(buffer);
  const triCount = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const head = new TextDecoder().decode(buffer.slice(0, 32)).trim().toLowerCase();
  const looksAscii = head.startsWith('solid');
  const isBinary = !looksAscii && buffer.byteLength > 84 && triCount * 50 + 84 === buffer.byteLength;

  let geo;
  if (isBinary) {
    const positions = new Float32Array(triCount * 9);
    let offset = 84;
    const tick = makeTicker(onProgress, triCount, 'Reading triangles');
    for (let i = 0; i < triCount; i++) {
      offset += 12; // stored facet normal
      for (let j = 0; j < 9; j++) { positions[i * 9 + j] = view.getFloat32(offset, true); offset += 4; }
      offset += 2; // attribute byte count
      if ((i & 8191) === 0) await tick(i);
    }
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  } else {
    const text = new TextDecoder().decode(buffer);
    const lines = text.split('\n');
    const positions = [];
    const tick = makeTicker(onProgress, lines.length, 'Reading vertices');
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].trim().split(/\s+/);
      if (parts[0] === 'vertex') {
        const x = parseFloat(parts[1]), y = parseFloat(parts[2]), z = parseFloat(parts[3]);
        if (!isNaN(x) && !isNaN(y) && !isNaN(z)) positions.push(x, y, z);
      }
      if ((i & 4095) === 0) await tick(i);
    }
    if (positions.length < 9) throw new Error('No triangles found');
    geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  }
  if (!geo.attributes.position || geo.attributes.position.count < 3) throw new Error('No triangles found');
  const welded = await weldVerticesAsync(geo, onProgress);
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

// Reads a Wavefront OBJ (triangulates n-gons with a fan).
async function parseOBJ(text, onProgress) {
  const verts = [], positions = [];
  const lines = text.split('\n');
  const tick = makeTicker(onProgress, lines.length, 'Reading faces');
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].trim().split(/\s+/);
    if (parts[0] === 'v') {
      const x = parseFloat(parts[1]), y = parseFloat(parts[2]), z = parseFloat(parts[3]);
      if (!isNaN(x) && !isNaN(y) && !isNaN(z)) verts.push(new THREE.Vector3(x, y, z));
    } else if (parts[0] === 'f') {
      const face = [];
      for (let k = 1; k < parts.length; k++) {
        const idx = parseInt(parts[k].split('/')[0], 10) - 1;
        if (!isNaN(idx) && verts[idx]) face.push(verts[idx]);
      }
      for (let k = 1; k < face.length - 1; k++) {
        positions.push(face[0].x, face[0].y, face[0].z, face[k].x, face[k].y, face[k].z, face[k + 1].x, face[k + 1].y, face[k + 1].z);
      }
    }
    if ((i & 4095) === 0) await tick(i);
  }
  if (positions.length < 9) throw new Error('No triangles found');
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const welded = await weldVerticesAsync(geo, onProgress);
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

// PLY scalar type -> byte size.
const PLY_TYPES = {
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4,
  float: 4, float32: 4,
  double: 8, float64: 8
};

// Reads ASCII and binary-little/big-endian PLY meshes.
async function parsePLY(buffer, onProgress) {
  if (!buffer || buffer.byteLength === 0) throw new Error('Empty file');
  const bytes = new Uint8Array(buffer);
  const headerText = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 65536)));
  const headerEnd = headerText.indexOf('end_header');
  if (headerEnd < 0) throw new Error('Not a PLY file (no end_header)');
  const headerLines = headerText.slice(0, headerEnd).split(/\r?\n/);
  const bodyOffset = headerText.indexOf('\n', headerEnd) + 1;

  let format = 'ascii';
  const elements = [];
  let current = null;
  for (const raw of headerLines) {
    const line = raw.trim();
    if (!line || line.startsWith('comment') || line.startsWith('obj_info')) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === 'format') {
      format = parts[1];
    } else if (parts[0] === 'element') {
      current = { name: parts[1], count: parseInt(parts[2], 10), properties: [] };
      elements.push(current);
    } else if (parts[0] === 'property' && current) {
      if (parts[1] === 'list') {
        current.properties.push({ kind: 'list', countType: parts[2], itemType: parts[3], name: parts[4] });
      } else {
        current.properties.push({ kind: 'scalar', type: parts[1], name: parts[2] });
      }
    }
  }
  if (!elements.length) throw new Error('PLY header has no elements');

  const vertexEl = elements.find((e) => e.name === 'vertex');
  const faceEl = elements.find((e) => e.name === 'face');
  if (!vertexEl) throw new Error('PLY has no vertex element');

  const readScalar = (view, offset, type, littleEndian) => {
    switch (type) {
      case 'char': case 'int8': return view.getInt8(offset);
      case 'uchar': case 'uint8': return view.getUint8(offset);
      case 'short': case 'int16': return view.getInt16(offset, littleEndian);
      case 'ushort': case 'uint16': return view.getUint16(offset, littleEndian);
      case 'int': case 'int32': return view.getInt32(offset, littleEndian);
      case 'uint': case 'uint32': return view.getUint32(offset, littleEndian);
      case 'float': case 'float32': return view.getFloat32(offset, littleEndian);
      case 'double': case 'float64': return view.getFloat64(offset, littleEndian);
      default: return view.getFloat32(offset, littleEndian);
    }
  };

  const positions = [];
  const faces = [];
  const isBinary = format !== 'ascii';
  const littleEndian = format !== 'binary_big_endian';
  const view = new DataView(buffer);

  if (!isBinary) {
    const body = new TextDecoder().decode(bytes.slice(bodyOffset));
    const rows = body.split(/\r?\n/).filter((l) => l.trim().length);
    let row = 0;
    const total = elements.reduce((s, e) => s + e.count, 0);
    const tick = makeTicker(onProgress, total, 'Reading vertices');
    let done = 0;
    for (const el of elements) {
      for (let i = 0; i < el.count; i++) {
        const tokens = rows[row++].trim().split(/\s+/);
        if (el === vertexEl) {
          const xIdx = el.properties.findIndex((p) => p.name === 'x');
          const yIdx = el.properties.findIndex((p) => p.name === 'y');
          const zIdx = el.properties.findIndex((p) => p.name === 'z');
          positions.push(parseFloat(tokens[xIdx]), parseFloat(tokens[yIdx]), parseFloat(tokens[zIdx]));
        } else if (el === faceEl && el.properties[0] && el.properties[0].kind === 'list') {
          const n = parseInt(tokens[0], 10);
          const idx = [];
          for (let k = 0; k < n; k++) idx.push(parseInt(tokens[1 + k], 10));
          faces.push(idx);
        }
        if ((++done & 4095) === 0) await tick(done);
      }
    }
  } else {
    let offset = bodyOffset;
    const total = elements.reduce((s, e) => s + e.count, 0);
    const tick = makeTicker(onProgress, total, 'Reading vertices');
    let done = 0;
    for (const el of elements) {
      const propBytes = el.properties.reduce((s, p) => s + (p.kind === 'list' ? 1 : PLY_TYPES[p.type] || 4), 0);
      for (let i = 0; i < el.count; i++) {
        if (el === vertexEl) {
          const xIdx = el.properties.findIndex((p) => p.name === 'x');
          const yIdx = el.properties.findIndex((p) => p.name === 'y');
          const zIdx = el.properties.findIndex((p) => p.name === 'z');
          const values = [];
          let o = offset;
          for (let p = 0; p < el.properties.length; p++) {
            const prop = el.properties[p];
            values[p] = readScalar(view, o, prop.type, littleEndian);
            o += PLY_TYPES[prop.type] || 4;
          }
          positions.push(values[xIdx], values[yIdx], values[zIdx]);
        } else if (el === faceEl && el.properties[0] && el.properties[0].kind === 'list') {
          const listProp = el.properties[0];
          const n = readScalar(view, offset, listProp.countType, littleEndian);
          let o = offset + (PLY_TYPES[listProp.countType] || 1);
          const idx = [];
          for (let k = 0; k < n; k++) {
            idx.push(readScalar(view, o, listProp.itemType, littleEndian));
            o += PLY_TYPES[listProp.itemType] || 4;
          }
          faces.push(idx);
          offset = o;
          done++;
          if ((done & 4095) === 0) await tick(done);
          continue;
        }
        offset += propBytes;
        done++;
        if ((done & 4095) === 0) await tick(done);
      }
    }
  }

  if (positions.length < 9) throw new Error('PLY contained no vertices');
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const tri = [];
  faces.forEach((f) => {
    for (let i = 1; i < f.length - 1; i++) tri.push(f[0], f[i], f[i + 1]);
  });
  if (tri.length) geo.setIndex(tri);
  const welded = await weldVerticesAsync(geo, onProgress);
  welded.computeBoundingBox();
  welded.computeBoundingSphere();
  return welded;
}

// Dispatches to the right parser based on the file extension / signature.
// `onProgress(fraction, label)` is called throughout so a long load shows
// real progress instead of a frozen page.
async function parseMeshFile(file, onProgress) {
  const name = (file.name || '').toLowerCase();
  const buffer = await readFileWithProgress(file, (f) => {
    if (onProgress) onProgress(f * 0.15, 'Reading file');
  });
  // The parsers own the 0.15 - 0.9 band; welding takes the last of it.
  const parseProgress = onProgress
    ? (f, label) => onProgress(0.15 + f * 0.75, label)
    : null;

  const parse = async () => {
    if (name.endsWith('.stl')) return parseSTL(buffer, parseProgress);
    if (name.endsWith('.obj')) return parseOBJ(new TextDecoder().decode(buffer), parseProgress);
    if (name.endsWith('.ply')) return parsePLY(buffer, parseProgress);
    if (name.endsWith('.glb') || name.endsWith('.gltf')) return parseGLTF(buffer, parseProgress);
    // Fall back to content sniffing.
    const head = new TextDecoder().decode(new Uint8Array(buffer.slice(0, 16))).trim().toLowerCase();
    if (head.startsWith('ply')) return parsePLY(buffer, parseProgress);
    if (head.startsWith('gltf')) return parseGLTF(buffer, parseProgress);
    if (head.startsWith('solid')) {
      try { return await parseSTL(buffer, parseProgress); } catch (e) { /* fall through */ }
    }
    if (head.startsWith('v ') || head.startsWith('#')) return parseOBJ(new TextDecoder().decode(buffer), parseProgress);
    return parseSTL(buffer, parseProgress);
  };

  const geometry = await parse();
  // The bar has to reach the end, even when the parse was too quick to
  // report anything in between.
  if (onProgress) onProgress(1, 'Loaded');
  return geometry;
}

// ---------------------------------------------------------------------------
// EXPORTERS
// ---------------------------------------------------------------------------

function generateBinarySTL(geometry) {
  if (!geometry) return null;
  const src = ensureOutwardWinding(geometry.clone());
  const pos = src.attributes.position;
  const index = src.index;
  const numTris = index ? index.count / 3 : pos.count / 3;
  const buffer = new ArrayBuffer(84 + numTris * 50);
  const view = new DataView(buffer);
  view.setUint32(80, numTris, true);
  let offset = 84;
  for (let i = 0; i < numTris; i++) {
    const i0 = index ? index.getX(i * 3) : i * 3;
    const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    const p0 = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    const p1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    const p2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    const norm = new THREE.Vector3().crossVectors(new THREE.Vector3().subVectors(p1, p0), new THREE.Vector3().subVectors(p2, p0)).normalize();
    view.setFloat32(offset, norm.x, true); offset += 4;
    view.setFloat32(offset, norm.y, true); offset += 4;
    view.setFloat32(offset, norm.z, true); offset += 4;
    [p0, p1, p2].forEach(p => {
      view.setFloat32(offset, p.x, true); offset += 4;
      view.setFloat32(offset, p.y, true); offset += 4;
      view.setFloat32(offset, p.z, true); offset += 4;
    });
    view.setUint16(offset, 0, true); offset += 2;
  }
  return new Blob([buffer], { type: 'application/octet-stream' });
}

function generateAsciiSTL(geometry, name = 'MeshPlug_Solid') {
  if (!geometry) return '';
  const src = ensureOutwardWinding(geometry.clone());
  const pos = src.attributes.position;
  const index = src.index;
  const numTris = index ? index.count / 3 : pos.count / 3;
  let stl = `solid ${name}\n`;
  for (let i = 0; i < numTris; i++) {
    const i0 = index ? index.getX(i * 3) : i * 3;
    const i1 = index ? index.getX(i * 3 + 1) : i * 3 + 1;
    const i2 = index ? index.getX(i * 3 + 2) : i * 3 + 2;
    stl += `  facet normal 0 0 0\n    outer loop\n`;
    stl += `      vertex ${pos.getX(i0).toFixed(4)} ${pos.getY(i0).toFixed(4)} ${pos.getZ(i0).toFixed(4)}\n`;
    stl += `      vertex ${pos.getX(i1).toFixed(4)} ${pos.getY(i1).toFixed(4)} ${pos.getZ(i1).toFixed(4)}\n`;
    stl += `      vertex ${pos.getX(i2).toFixed(4)} ${pos.getY(i2).toFixed(4)} ${pos.getZ(i2).toFixed(4)}\n`;
    stl += `    endloop\n  endfacet\n`;
  }
  stl += `endsolid ${name}\n`;
  return stl;
}

function generateOBJ(geometry, groupName = 'MeshPlug_Solid') {
  if (!geometry) return '';
  const src = ensureOutwardWinding(geometry.clone());
  const pos = src.attributes.position;
  const index = src.index;
  let obj = `# MeshPlug Studio by Wayne Scicluna - Wavefront OBJ\no ${groupName}\n`;
  for (let i = 0; i < pos.count; i++) {
    obj += `v ${pos.getX(i).toFixed(4)} ${pos.getY(i).toFixed(4)} ${pos.getZ(i).toFixed(4)}\n`;
  }
  const numTris = index ? index.count / 3 : pos.count / 3;
  for (let i = 0; i < numTris; i++) {
    const a = (index ? index.getX(i * 3) : i * 3) + 1;
    const b = (index ? index.getX(i * 3 + 1) : i * 3 + 1) + 1;
    const c = (index ? index.getX(i * 3 + 2) : i * 3 + 2) + 1;
    obj += `f ${a} ${b} ${c}\n`;
  }
  return obj;
}

// ISO 10303-21 (STEP AP214) faceted B-Rep writer - FACETED_BREP +
// CLOSED_SHELL + FACE_OUTER_BOUND + POLY_LOOP, which is the schema-valid
// idiom for triangle data and is what solid CAD kernels expect to import.
function generateStepAP214(geometry, partName = 'MeshPlug_Solid') {
  if (!geometry) return '';
  const src = ensureOutwardWinding(geometry.clone());
  const pos = src.attributes.position;
  const index = src.index;
  const numFaces = index ? index.count / 3 : pos.count / 3;
  if (!numFaces) return '';
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, '');

  const lines = [];
  lines.push('ISO-10303-21;');
  lines.push('HEADER;');
  lines.push("FILE_DESCRIPTION(('MeshPlug Studio by Wayne Scicluna - Solid'),'2;1');");
  lines.push(`FILE_NAME('${partName}.step','${stamp}',('Wayne Scicluna'),('MeshPlug Studio by Wayne Scicluna'),'MeshPlug Studio by Wayne Scicluna','MeshPlug Studio by Wayne Scicluna','');`);
  lines.push("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));");
  lines.push('ENDSEC;');
  lines.push('DATA;');
  lines.push("#1=APPLICATION_CONTEXT('automotive design');");
  lines.push("#2=APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',1998,#1);");
  lines.push("#3=PRODUCT_CONTEXT('part definition',#1,'mechanical');");
  lines.push(`#4=PRODUCT('${partName}','${partName}','Solid',(#3));`);
  lines.push("#5=PRODUCT_DEFINITION_FORMATION('1','Release',#4);");
  lines.push("#6=PRODUCT_DEFINITION('design','solid model',#5,#3);");
  lines.push("#7=PRODUCT_DEFINITION_SHAPE('','',#6);");
  lines.push(`#10=FACETED_BREP('${partName}',#11);`);

  let eid = 100;
  const ptMap = new Map();
  const getPtId = (x, y, z) => {
    const k = `${x.toFixed(4)}_${y.toFixed(4)}_${z.toFixed(4)}`;
    if (ptMap.has(k)) return ptMap.get(k);
    const id = eid++;
    lines.push(`#${id}=CARTESIAN_POINT('',(${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}));`);
    ptMap.set(k, id);
    return id;
  };

  const boundRefs = [];
  for (let f = 0; f < numFaces; f++) {
    const i0 = index ? index.getX(f * 3) : f * 3;
    const i1 = index ? index.getX(f * 3 + 1) : f * 3 + 1;
    const i2 = index ? index.getX(f * 3 + 2) : f * 3 + 2;
    const p0 = getPtId(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
    const p1 = getPtId(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
    const p2 = getPtId(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
    const boundId = eid++;
    const loopId = eid++;
    lines.push(`#${boundId}=FACE_OUTER_BOUND('',#${loopId},.T.);`);
    lines.push(`#${loopId}=POLY_LOOP('',(#${p0},#${p1},#${p2}));`);
    boundRefs.push(`#${boundId}`);
  }

  lines.push(`#11=CLOSED_SHELL('',(${boundRefs.join(',')}));`);
  lines.push('#200=SHAPE_DEFINITION_REPRESENTATION(#7,#201);');
  lines.push(`#201=SHAPE_REPRESENTATION('${partName}',(#10),#202);`);
  lines.push("#202=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#203))GLOBAL_UNIT_ASSIGNED_CONTEXT((#204,#205,#206))REPRESENTATION_CONTEXT('',''));");
  lines.push("#203=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#204,'distance_accuracy_value','confusion accuracy');");
  lines.push('#204=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));');
  lines.push('#205=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));');
  lines.push('#206=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());');
  lines.push('ENDSEC;');
  lines.push('END-ISO-10303-21;');
  return lines.join('\n');
}
