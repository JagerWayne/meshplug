// ============================================================================
// GPU COMPUTE
// ============================================================================
// WebGL helpers that move the two jobs that actually scale with mesh size
// onto the GPU:
//
//   * Taubin smoothing - a Laplacian iteration over every vertex, repeated
//     many times. It is embarrassingly parallel, so it is the single biggest
//     win in the app for a multi-million triangle scan.
//
//   * Face quadrics - the per-triangle error metric that drives the
//     quadric-error decimator.
//
// Both run on the main thread against the app's own renderer, so the
// intermediate results stay in GPU memory. Every entry point returns null
// when the hardware cannot do it, and the caller falls back to the CPU path.

const GPU_MAX_SLOTS = 3;            // 3 texture slots x 4 indices = 12 neighbours
const GPU_FLOATS_PER_TEXEL = 4;

// ---------------------------------------------------------------------------
// Shared GPU plumbing
// ---------------------------------------------------------------------------
const GPU_QUAD_VERTEX = `
precision highp float;
attribute vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// A float texture that can be rendered into. WebGL2 needs
// EXT_color_buffer_float, WebGL1 needs WEBGL_color_buffer_float.
function gpuFloatSupport(renderer) {
  const gl = renderer.getContext();
  const isGL2 = renderer.capabilities.isWebGL2;
  const ext = isGL2
    ? (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))
    : gl.getExtension('WEBGL_color_buffer_float');
  return !!ext;
}

// Owns the fullscreen quad and the render targets used by every pass.
class GPURender {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.targets = [];
  }

  // Renders a fragment shader into a float target of the given size.
  render(fragmentShader, uniforms, target) {
    const material = new THREE.RawShaderMaterial({
      vertexShader: GPU_QUAD_VERTEX,
      fragmentShader,
      uniforms,
      depthTest: false,
      depthWrite: false
    });
    this.quad.material = material;
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);
    material.dispose();
  }

  makeTarget(width, height) {
    const rt = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false
    });
    this.targets.push(rt);
    return rt;
  }

  // Proves that a float target really round-trips, so a silent driver
  // failure cannot be mistaken for a working GPU path.
  probe() {
    try {
      const rt = this.makeTarget(2, 2);
      this.render(
        `
precision highp float;
void main() { gl_FragColor = vec4(0.25, 0.5, 0.75, 1.0); }
`,
        {},
        rt
      );
      const buf = new Float32Array(2 * 2 * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, 2, 2, buf);
      const ok = Math.abs(buf[0] - 0.25) < 1e-5 && Math.abs(buf[1] - 0.5) < 1e-5;
      if (!ok) return false;
      const tex = new THREE.DataTexture(new Float32Array(4 * 4 * 4), 2, 2, THREE.RGBAFormat, THREE.FloatType);
      tex.needsUpdate = true;
      tex.dispose();
      return true;
    } catch (e) {
      return false;
    }
  }

  // Compiles a shader and reports whether it produced the expected value.
  // A shader that does not compile silently leaves the target untouched, so
  // this is how a broken shader is caught instead of shipping garbage.
  probeShader(fragmentShader, uniforms) {
    try {
      const rt = this.makeTarget(2, 2);
      this.render(fragmentShader, uniforms, rt);
      const buf = new Float32Array(2 * 2 * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, 2, 2, buf);
      return buf.slice(0, 4).every((v) => isFinite(v));
    } catch (e) {
      return false;
    }
  }

  dispose() {
    this.targets.forEach((t) => t.dispose());
    this.targets = [];
    if (this.quad.geometry) this.quad.geometry.dispose();
  }
}

// Builds a float data texture for the GPU.
function makeFloatTexture(data, width, height) {
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

// Chooses a texture width that keeps the texture close to square without
// exceeding the hardware limit.
function textureShape(count, maxSize) {
  const width = Math.min(maxSize, Math.max(1, Math.ceil(Math.sqrt(count))));
  const height = Math.max(1, Math.ceil(count / width));
  return { width, height };
}

// ---------------------------------------------------------------------------
// GPU TAUBIN SMOOTHING
// ---------------------------------------------------------------------------
//
// The CPU version averages every vertex with its neighbours and nudges it
// towards that average, once with a positive factor and once with a negative
// one. Every vertex only reads its neighbours, so the whole pass is a single
// texture read per neighbour - which is exactly what a fragment shader is
// good at.
//
// Two textures are used:
//   posTex - xyz is the position, w packs the neighbour count and the
//            "on a sharp crease, do not move me" flag
//   nbrTex - four neighbour vertex indices per texel, SLOTS texels per vertex
//
const SMOOTH_FRAGMENT = `
precision highp float;

uniform sampler2D posTex;
uniform sampler2D nbrTex;
uniform vec2 posTexSize;
uniform float slots;
uniform float factor;

vec2 uvOf(float v) {
  float x = mod(v, posTexSize.x);
  float y = floor(v / posTexSize.x);
  return (vec2(x, y) + 0.5) / posTexSize;
}

vec2 uvOfNbr(float v, float s) {
  float x = mod(v, posTexSize.x);
  float y = floor(v / posTexSize.x);
  return (vec2(x, y * slots + s) + 0.5) / vec2(posTexSize.x, posTexSize.y * slots);
}

void main() {
  float v = floor(gl_FragCoord.y) * posTexSize.x + floor(gl_FragCoord.x);
  vec4 self = texture2D(posTex, uvOf(v));
  float meta = self.w;
  float count = mod(meta, 256.0);
  float sharp = floor(meta / 256.0);

  // Creased vertices and lonely vertices stay exactly where they are.
  if (sharp > 0.5 || count < 0.5) {
    gl_FragColor = self;
    return;
  }

  vec3 sum = vec3(0.0);
  float taken = 0.0;

  for (int s = 0; s < ${GPU_MAX_SLOTS}; s++) {
    if (float(s) >= count) break;
    vec4 n = texture2D(nbrTex, uvOfNbr(v, float(s)));

    if (taken + 1.0 <= count) { float ni = n.x; if (ni >= 0.0) { sum += texture2D(posTex, uvOf(ni)).xyz; taken += 1.0; } }
    if (taken + 1.0 <= count) { float ni = n.y; if (ni >= 0.0) { sum += texture2D(posTex, uvOf(ni)).xyz; taken += 1.0; } }
    if (taken + 1.0 <= count) { float ni = n.z; if (ni >= 0.0) { sum += texture2D(posTex, uvOf(ni)).xyz; taken += 1.0; } }
    if (taken + 1.0 <= count) { float ni = n.w; if (ni >= 0.0) { sum += texture2D(posTex, uvOf(ni)).xyz; taken += 1.0; } }
  }

  vec3 avg = sum / max(count, 1.0);
  gl_FragColor = vec4(self.xyz + factor * (avg - self.xyz), meta);
}
`;

class GPUSmoother {
  constructor(renderer) {
    this.renderer = renderer;
    this.gpu = new GPURender(renderer);
    this.supported = null;
  }

  isSupported() {
    if (this.supported === null) {
      this.supported = gpuFloatSupport(this.renderer) && this.gpu.probe();
      if (this.supported) {
        // The smoothing shader has to compile as well, otherwise the passes
        // would quietly render nothing.
        this.supported = this.gpu.probeShader(SMOOTH_FRAGMENT, {
          posTex: { value: null },
          nbrTex: { value: null },
          posTexSize: { value: new THREE.Vector2(2, 2) },
          slots: { value: GPU_MAX_SLOTS },
          factor: { value: 0.5 }
        });
      }
    }
    return this.supported;
  }

  // Returns a smoothed copy of the geometry, or null when the GPU cannot do
  // it and the caller should use the CPU path.
  smooth(geometry, { iterations = 8, lambda = 0.52, mu = -0.54, featureAngle = 45 } = {}) {
    if (!this.isSupported()) return null;
    if (!geometry || !geometry.index || !geometry.attributes.position) return null;

    const pos = geometry.attributes.position;
    const vertexCount = pos.count;
    if (vertexCount < 64) return null;   // not worth the setup cost

    const maxSize = this.renderer.capabilities.maxTextureSize || 2048;
    if (vertexCount > maxSize * maxSize) return null;

    // --- adjacency and crease flags (CPU, same rules as the CPU version) ---
    const { vertexAdj } = buildAdjacency(geometry);
    const sharp = computeSharpVertices(geometry, featureAngle);

    // --- pack the neighbour lists into a texture -------------------------
    const shape = textureShape(vertexCount, maxSize);
    const { width, height } = shape;

    const posData = new Float32Array(width * height * GPU_FLOATS_PER_TEXEL);
    const nbrHeight = height * GPU_MAX_SLOTS;
    const nbrData = new Float32Array(width * nbrHeight * GPU_FLOATS_PER_TEXEL);
    nbrData.fill(-1);
    // The adjacency list holds one entry per incident triangle, so the same
    // neighbour can appear several times. The CPU version averages over the
    // distinct neighbours, and so does this one - which means the count
    // packed into the position texture has to be the deduplicated one too.
    const distinct = uniqueNeighbours(vertexAdj, vertexCount);

    for (let v = 0; v < vertexCount; v++) {
      const o = v * 4;
      posData[o] = pos.getX(v);
      posData[o + 1] = pos.getY(v);
      posData[o + 2] = pos.getZ(v);

      const list = distinct[v];
      const count = Math.min(list.length, GPU_MAX_SLOTS * 4);
      posData[o + 3] = count + (sharp[v] ? 256 : 0);

      const x = v % width;
      const y = Math.floor(v / width);
      for (let k = 0; k < count; k++) {
        const slot = Math.floor(k / 4);
        const comp = k % 4;
        const texel = ((y * GPU_MAX_SLOTS + slot) * width + x) * 4 + comp;
        nbrData[texel] = list[k];
      }
    }
    const posTex = makeFloatTexture(posData, width, height);
    const nbrTex = makeFloatTexture(nbrData, width, nbrHeight);

    // --- ping-pong targets ------------------------------------------------
    const rtA = this.gpu.makeTarget(width, height);
    const rtB = this.gpu.makeTarget(width, height);

    const uniforms = {
      posTex: { value: null },
      nbrTex: { value: nbrTex },
      posTexSize: { value: new THREE.Vector2(width, height) },
      slots: { value: GPU_MAX_SLOTS },
      factor: { value: 0 }
    };

    const runPass = (factor, readTexture, writeTarget) => {
      uniforms.posTex.value = readTexture;
      uniforms.factor.value = factor;
      this.gpu.render(SMOOTH_FRAGMENT, uniforms, writeTarget);
    };

    // The first pass reads the data texture; later passes ping-pong between
    // the two targets. The write target always alternates, and is never the
    // one being read from.
    const targets = [rtA, rtB];
    let readTexture = posTex;
    let writeIndex = 0;
    let lastTarget = rtA;
    for (let it = 0; it < iterations; it++) {
      const a = targets[writeIndex];
      runPass(lambda, readTexture, a);
      readTexture = a.texture;
      lastTarget = a;
      writeIndex = 1 - writeIndex;

      const b = targets[writeIndex];
      runPass(mu, readTexture, b);
      readTexture = b.texture;
      lastTarget = b;
      writeIndex = 1 - writeIndex;
    }

    // --- read the result back --------------------------------------------
    const out = new Float32Array(width * height * GPU_FLOATS_PER_TEXEL);
    this.renderer.readRenderTargetPixels(lastTarget, 0, 0, width, height, out);

    posTex.dispose();
    nbrTex.dispose();
    rtA.dispose();
    rtB.dispose();

    // --- volume restoration, exactly as the CPU version does --------------
    const outPos = new Float32Array(vertexCount * 3);
    for (let v = 0; v < vertexCount; v++) {
      outPos[v * 3] = out[v * 4];
      outPos[v * 3 + 1] = out[v * 4 + 1];
      outPos[v * 3 + 2] = out[v * 4 + 2];
    }

    // A shader that failed to compile leaves the target empty or full of
    // rubbish, so the result is checked before it is trusted. Anything
    // suspicious sends the caller back to the CPU path.
    if (!looksLikeSmoothedMesh(outPos, vertexCount, pos)) return null;

    applyVolumeRestoration(geometry, outPos, vertexCount);

    const smoothed = new THREE.BufferGeometry();
    smoothed.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
    smoothed.setIndex(new THREE.BufferAttribute(geometry.index.array.slice(0), 1));
    smoothed.computeVertexNormals();
    smoothed.computeBoundingBox();
    smoothed.computeBoundingSphere();
    return smoothed;
  }

  dispose() {
    this.gpu.dispose();
    this.supported = null;
  }
}

// ---------------------------------------------------------------------------
// The engine the app talks to
// ---------------------------------------------------------------------------
// One place that owns the smoother and the quadric evaluator, and knows how
// to fall back to the CPU when the hardware cannot help.
class GPUEngine {
  constructor() {
    this.renderer = null;
    this.smoother = null;
    this.quadrics = null;
    this.supported = null;
  }

  setRenderer(renderer) {
    this.renderer = renderer;
    this.smoother = new GPUSmoother(renderer);
    this.quadrics = new GPUQuadrics(renderer);
    this.supported = null;
  }

  isSupported() {
    if (this.supported === null) {
      this.supported = !!(this.smoother && this.smoother.isSupported());
    }
    return this.supported;
  }

  // Smooths on the GPU when it is worth it, otherwise on the CPU.
  smooth(geometry, options) {
    if (this.smoother && this.smoother.isSupported()) {
      const out = this.smoother.smooth(geometry, options);
      if (out) return { geometry: out, path: 'gpu' };
    }
    return { geometry: taubinSmooth(geometry.clone(), options), path: 'cpu' };
  }

  // Per-face quadrics for the decimator, or null when the GPU cannot help.
  faceQuadrics(geometry) {
    if (!this.quadrics || !this.quadrics.isSupported()) return null;
    return this.quadrics.compute(geometry);
  }
}

const gpuEngine = new GPUEngine();

// ---------------------------------------------------------------------------
// GPU FACE QUADRICS
// ---------------------------------------------------------------------------
//
// The quadric error metric needs, for every triangle, the outer product of
// its plane normal scaled by its area. That is a per-triangle calculation
// with no data dependency, so it goes on the GPU as well.
//
const QUADRIC_FRAGMENT = `
precision highp float;

uniform sampler2D posTex;
uniform sampler2D idxTex;
uniform vec2 faceTexSize;
uniform vec2 posTexSize;
uniform float slot;

// The face texture and the vertex texture have different shapes, so each
// one needs its own lookup.
vec2 uvOfFace(float f) {
  float x = mod(f, faceTexSize.x);
  float y = floor(f / faceTexSize.x);
  return (vec2(x, y) + 0.5) / faceTexSize;
}

vec2 uvOfPos(float v) {
  float x = mod(v, posTexSize.x);
  float y = floor(v / posTexSize.x);
  return (vec2(x, y) + 0.5) / posTexSize;
}

vec3 fetchPos(float i) {
  return texture2D(posTex, uvOfPos(i)).xyz;
}

void main() {
  float f = floor(gl_FragCoord.y) * faceTexSize.x + floor(gl_FragCoord.x);
  vec3 idx = texture2D(idxTex, uvOfFace(f)).rgb;
  vec3 a = fetchPos(idx.x);
  vec3 b = fetchPos(idx.y);
  vec3 c = fetchPos(idx.z);

  vec3 e1 = b - a;
  vec3 e2 = c - a;
  vec3 n = cross(e1, e2);
  float len = length(n);
  if (len < 1e-20) { gl_FragColor = vec4(0.0); return; }
  vec3 fn = n / len;
  float area = len * 0.5;

  if (slot < 0.5) {
    gl_FragColor = vec4(fn.x * fn.x * area, fn.x * fn.y * area, fn.x * fn.z * area, fn.x * area);
  } else if (slot < 1.5) {
    gl_FragColor = vec4(fn.y * fn.y * area, fn.y * fn.z * area, fn.y * area, fn.z * fn.z * area);
  } else {
    gl_FragColor = vec4(fn.z * area, area, 0.0, 0.0);
  }
}
`;

class GPUQuadrics {
  constructor(renderer) {
    this.renderer = renderer;
    this.gpu = new GPURender(renderer);
    this.supported = null;
  }

  isSupported() {
    if (this.supported === null) {
      this.supported = gpuFloatSupport(this.renderer) && this.gpu.probe();
    }
    return this.supported;
  }

  // Returns a Float32Array of 10 quadric components per triangle, or null.
  compute(geometry) {
    if (!this.isSupported()) return null;
    if (!geometry || !geometry.index || !geometry.attributes.position) return null;

    const pos = geometry.attributes.position;
    const idx = geometry.index.array;
    const faceCount = idx.length / 3;
    if (faceCount < 64) return null;

    const maxSize = this.renderer.capabilities.maxTextureSize || 2048;
    if (faceCount > maxSize * maxSize) return null;

    const shape = textureShape(faceCount, maxSize);
    const { width, height } = shape;

    const posShape = textureShape(pos.count, maxSize);
    const posData = new Float32Array(posShape.width * posShape.height * 4);
    for (let v = 0; v < pos.count; v++) {
      posData[v * 4] = pos.getX(v);
      posData[v * 4 + 1] = pos.getY(v);
      posData[v * 4 + 2] = pos.getZ(v);
    }
    const posTex = makeFloatTexture(posData, posShape.width, posShape.height);

    const idxData = new Float32Array(width * height * 4);
    for (let f = 0; f < faceCount; f++) {
      idxData[f * 4] = idx[f * 3];
      idxData[f * 4 + 1] = idx[f * 3 + 1];
      idxData[f * 4 + 2] = idx[f * 3 + 2];
    }
    const idxTex = makeFloatTexture(idxData, width, height);

    const uniforms = {
      posTex: { value: posTex },
      idxTex: { value: idxTex },
      faceTexSize: { value: new THREE.Vector2(width, height) },
      posTexSize: { value: new THREE.Vector2(posShape.width, posShape.height) },
      slot: { value: 0 }
    };

    const parts = [];
    for (let s = 0; s < 3; s++) {
      uniforms.slot.value = s;
      const rt = this.gpu.makeTarget(width, height);
      this.gpu.render(QUADRIC_FRAGMENT, uniforms, rt);
      const buf = new Float32Array(width * height * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, width, height, buf);
      parts.push(buf);
      rt.dispose();
    }

    posTex.dispose();
    idxTex.dispose();

    // Pack the three textures into the 10 components the decimator wants.
    const out = new Float32Array(faceCount * 10);
    for (let f = 0; f < faceCount; f++) {
      const o = f * 10;
      out[o] = parts[0][f * 4];
      out[o + 1] = parts[0][f * 4 + 1];
      out[o + 2] = parts[0][f * 4 + 2];
      out[o + 3] = parts[0][f * 4 + 3];
      out[o + 4] = parts[1][f * 4];
      out[o + 5] = parts[1][f * 4 + 1];
      out[o + 6] = parts[1][f * 4 + 2];
      out[o + 7] = parts[1][f * 4 + 3];
      out[o + 8] = parts[2][f * 4];
      out[o + 9] = parts[2][f * 4 + 1];
    }

    // A few faces are checked against the CPU calculation. If they do not
    // agree, the GPU result is thrown away rather than used.
    if (!quadricsLookRight(out, geometry, faceCount)) return null;

    return out;
  }

  dispose() {
    this.gpu.dispose();
    this.supported = null;
  }
}

// Checks a sample of the GPU quadrics against the CPU calculation. A
// relative error above a percent means the GPU result is wrong and must
// not be used.
function quadricsLookRight(gpu, geometry, faceCount) {
  const pos = geometry.attributes.position;
  const idx = geometry.index.array;
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const fn = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const samples = [0, Math.floor(faceCount / 3), Math.floor(faceCount / 2), faceCount - 1];
  for (const t of samples) {
    if (t < 0 || t >= faceCount) continue;
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    pA.set(pos.getX(a), pos.getY(a), pos.getZ(a));
    pB.set(pos.getX(b), pos.getY(b), pos.getZ(b));
    pC.set(pos.getX(c), pos.getY(c), pos.getZ(c));
    e1.subVectors(pB, pA); e2.subVectors(pC, pA);
    fn.crossVectors(e1, e2);
    const area = fn.length() * 0.5;
    fn.normalize();
    const o = t * 10;
    const cpu = [
      fn.x * fn.x * area, fn.x * fn.y * area, fn.x * fn.z * area, fn.x * area,
      fn.y * fn.y * area, fn.y * fn.z * area, fn.y * area, fn.z * fn.z * area,
      fn.z * area, area
    ];
    for (let k = 0; k < 10; k++) {
      const expected = cpu[k];
      const got = gpu[o + k];
      if (!isFinite(got)) return false;
      const rel = Math.abs(got - expected) / Math.max(1e-6, Math.abs(expected));
      if (rel > 0.01) return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Shared CPU helpers
// ---------------------------------------------------------------------------

// Rejects a GPU result that cannot be right. Smoothing only ever moves a
// vertex towards the average of its neighbours, so the result has to stay
// inside the bounding box of the input. A shader that failed to compile, or
// a pass that read and wrote the same buffer, breaks that instantly.
function looksLikeSmoothedMesh(outPos, vertexCount, originalPos) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < vertexCount; v++) {
    const x = originalPos.getX(v), y = originalPos.getY(v), z = originalPos.getZ(v);
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const pad = Math.max(maxX - minX, maxY - minY, maxZ - minZ) * 0.01 + 1e-6;

  let moved = 0;
  for (let v = 0; v < vertexCount; v++) {
    const x = outPos[v * 3], y = outPos[v * 3 + 1], z = outPos[v * 3 + 2];
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
    if (x < minX - pad || x > maxX + pad) return false;
    if (y < minY - pad || y > maxY + pad) return false;
    if (z < minZ - pad || z > maxZ + pad) return false;
    if (x !== originalPos.getX(v) || y !== originalPos.getY(v) || z !== originalPos.getZ(v)) moved++;
  }
  // Nothing moving at all means the pass did not run.
  return moved > 0;
}

// Marks the vertices that sit on a sharp crease, so the smoothing does not
// melt the detail that makes a scan readable. Mirrors the CPU smoother.
function computeSharpVertices(geometry, featureAngle) {
  const pos = geometry.attributes.position;
  const sharp = new Uint8Array(pos.count);
  const { edges, triVerts } = cachedEdgeIndex(geometry);
  const cosLimit = Math.cos((featureAngle * Math.PI) / 180);
  const pA = new THREE.Vector3(), pB = new THREE.Vector3(), pC = new THREE.Vector3();
  const n1 = new THREE.Vector3(), n2 = new THREE.Vector3();
  edges.forEach((rec) => {
    if (rec.faces.length !== 2) return;
    const t1 = rec.faces[0], t2 = rec.faces[1];
    const a1 = triVerts[t1 * 3], b1 = triVerts[t1 * 3 + 1], c1 = triVerts[t1 * 3 + 2];
    const a2 = triVerts[t2 * 3], b2 = triVerts[t2 * 3 + 1], c2 = triVerts[t2 * 3 + 2];
    pA.set(pos.getX(a1), pos.getY(a1), pos.getZ(a1));
    pB.set(pos.getX(b1), pos.getY(b1), pos.getZ(b1));
    pC.set(pos.getX(c1), pos.getY(c1), pos.getZ(c1));
    n1.crossVectors(pB.clone().sub(pA), pC.clone().sub(pA)).normalize();
    pA.set(pos.getX(a2), pos.getY(a2), pos.getZ(a2));
    pB.set(pos.getX(b2), pos.getY(b2), pos.getZ(b2));
    pC.set(pos.getX(c2), pos.getY(c2), pos.getZ(c2));
    n2.crossVectors(pB.clone().sub(pA), pC.clone().sub(pA)).normalize();
    if (n1.dot(n2) < cosLimit) { sharp[rec.u] = 1; sharp[rec.v] = 1; }
  });
  return sharp;
}

// Restores the volume the smoothing lost, by scaling about the centroid.
// Mirrors the CPU version so both paths give the same result - including the
// centroid, which the CPU version takes from the *original* positions.
function applyVolumeRestoration(geometry, outPos, vertexCount) {
  const before = geometrySignedVolume(geometry);
  const pos = geometry.attributes.position;
  const centroid = new THREE.Vector3();
  for (let v = 0; v < vertexCount; v++) {
    centroid.x += pos.getX(v);
    centroid.y += pos.getY(v);
    centroid.z += pos.getZ(v);
  }
  centroid.multiplyScalar(1 / Math.max(1, vertexCount));

  // Volume of the smoothed mesh, computed from the output positions.
  const after = signedVolumeFromPositions(geometry, outPos);
  if (!(Math.abs(before) > 1e-6 && Math.abs(after) > 1e-6)) return;
  const ratio = before / after;
  if (!(Math.abs(ratio - 1) < 0.25 && ratio > 0)) return;
  for (let v = 0; v < vertexCount; v++) {
    outPos[v * 3] = centroid.x + (outPos[v * 3] - centroid.x) * ratio;
    outPos[v * 3 + 1] = centroid.y + (outPos[v * 3 + 1] - centroid.y) * ratio;
    outPos[v * 3 + 2] = centroid.z + (outPos[v * 3 + 2] - centroid.z) * ratio;
  }
}

function signedVolumeFromPositions(geometry, outPos) {
  const idx = geometry.index.array;
  let vol = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = outPos[a], ay = outPos[a + 1], az = outPos[a + 2];
    const bx = outPos[b], by = outPos[b + 1], bz = outPos[b + 2];
    const cx = outPos[c], cy = outPos[c + 1], cz = outPos[c + 2];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}
