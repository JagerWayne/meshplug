// ============================================================================
// MESH WORKER
// ============================================================================
// Web worker for heavy mesh computations to keep the UI responsive.

// Import the mesh modules. These are plain scripts that share the global
// scope, so importScripts is all that is needed - no bundler involved.
self.importScripts(
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'geometry.js',
  'analysis.js',
  'repair.js',
  'selection.js',
  'offset.js'
);

// ---------------------------------------------------------------------------
// Message Handler
// ---------------------------------------------------------------------------
self.onmessage = function(e) {
  const { id, operation, data } = e.data;
  
  try {
    let result;
    
    switch (operation) {
      case 'fillHoles':
        result = handleFillHoles(data);
        break;
      case 'smooth':
        result = handleSmooth(data);
        break;
      case 'decimate':
        result = handleDecimate(data);
        break;
      case 'buildShell':
        result = handleBuildShell(data);
        break;
      case 'analyze':
        result = handleAnalyze(data);
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    self.postMessage({ id, success: true, result });
  } catch (error) {
    self.postMessage({ id, success: false, error: error.message });
  }
};

// ---------------------------------------------------------------------------
// Operation Handlers
// ---------------------------------------------------------------------------

function handleFillHoles(data) {
  const { geometryData, options } = data;
  const geometry = deserializeGeometry(geometryData);
  
  self.postMessage({ type: 'progress', progress: 0.3 });
  
  const result = fillHoles(geometry, options);
  
  self.postMessage({ type: 'progress', progress: 0.9 });
  
  return {
    geometry: serializeGeometry(result.geometry),
    filled: result.filled,
    skipped: result.skipped
  };
}

function handleSmooth(data) {
  const { geometryData, options } = data;
  const geometry = deserializeGeometry(geometryData);
  
  self.postMessage({ type: 'progress', progress: 0.3 });
  
  const result = taubinSmooth(geometry, options);
  
  self.postMessage({ type: 'progress', progress: 0.9 });
  
  return { geometry: serializeGeometry(result) };
}

function handleDecimate(data) {
  const { geometryData, options } = data;
  const geometry = deserializeGeometry(geometryData);

  self.postMessage({ type: 'progress', progress: 0.3 });

  const result = decimateQEM(geometry, options);

  self.postMessage({ type: 'progress', progress: 0.9 });

  return { geometry: serializeGeometry(result) };
}

function handleBuildShell(data) {
  const { geometryData, mask, options } = data;
  const geometry = deserializeGeometry(geometryData);
  
  self.postMessage({ type: 'progress', progress: 0.2 });
  
  const result = buildShell(geometry, mask, options);
  
  self.postMessage({ type: 'progress', progress: 0.9 });
  
  return {
    geometry: result.geometry ? serializeGeometry(result.geometry) : null,
    stats: result.stats
  };
}

function handleAnalyze(data) {
  const { geometryData } = data;
  const geometry = deserializeGeometry(geometryData);
  
  self.postMessage({ type: 'progress', progress: 0.5 });
  
  const result = analyzeMesh(geometry);
  
  return result;
}

// ---------------------------------------------------------------------------
// Serialization Helpers
// ---------------------------------------------------------------------------

function serializeGeometry(geometry) {
  const pos = geometry.attributes.position;
  const norm = geometry.attributes.normal;
  const index = geometry.index;
  
  return {
    position: Array.from(pos.array),
    normal: norm ? Array.from(norm.array) : null,
    index: index ? Array.from(index.array) : null
  };
}

function deserializeGeometry(data) {
  const geometry = new THREE.BufferGeometry();
  
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  
  if (data.normal) {
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  }
  
  if (data.index) {
    geometry.setIndex(data.index);
  }
  
  return geometry;
}
