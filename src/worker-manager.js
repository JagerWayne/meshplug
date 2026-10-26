// ============================================================================
// WORKER MANAGER
// ============================================================================
// Manages web workers for heavy computations.

class WorkerManager {
  constructor() {
    this.worker = null;
    this.messageId = 0;
    this.pendingMessages = new Map();
    this.progressCallback = null;
  }

  // Initialize the worker
  init() {
    if (this.worker) return;
    
    try {
      this.worker = new Worker('src/mesh-worker.js');
      
      this.worker.onmessage = (e) => {
        const { id, type, success, result, error, progress } = e.data;
        
        if (type === 'progress') {
          if (this.progressCallback) {
            this.progressCallback(progress);
          }
          return;
        }
        
        const pending = this.pendingMessages.get(id);
        if (pending) {
          this.pendingMessages.delete(id);
          
          if (success) {
            pending.resolve(result);
          } else {
            pending.reject(new Error(error));
          }
        }
      };
      
      this.worker.onerror = (error) => {
        console.error('Worker error:', error);
        // Reject all pending messages
        this.pendingMessages.forEach(pending => {
          pending.reject(new Error('Worker error'));
        });
        this.pendingMessages.clear();
      };
    } catch (error) {
      console.error('Failed to initialize worker:', error);
      throw error;
    }
  }

  // Set progress callback
  onProgress(callback) {
    this.progressCallback = callback;
  }

  // Send a message to the worker
  send(operation, data) {
    this.init();
    
    return new Promise((resolve, reject) => {
      const id = this.messageId++;
      
      this.pendingMessages.set(id, { resolve, reject });
      
      this.worker.postMessage({
        id,
        operation,
        data
      });
    });
  }

  // Terminate the worker
  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.pendingMessages.clear();
    }
  }
}

// Global worker manager instance
const workerManager = new WorkerManager();

// A worker cannot be started from a file:// page, and a blocked CDN would
// break it too. `workerAvailable` is probed once and the app falls back to
// the synchronous implementations when it is false.
let workerAvailable = null;
function probeWorker() {
  if (workerAvailable !== null) return workerAvailable;
  if (typeof Worker === 'undefined' || location.protocol === 'file:') {
    workerAvailable = false;
    return false;
  }
  try {
    const probe = new Worker('src/mesh-worker.js');
    probe.terminate();
    workerAvailable = true;
  } catch (e) {
    workerAvailable = false;
  }
  return workerAvailable;
}

// ---------------------------------------------------------------------------
// Worker Operations
// ---------------------------------------------------------------------------

// Fill holes using the worker
async function fillHolesAsync(geometry, options) {
  if (!probeWorker()) {
    const res = fillHoles(geometry, options);
    return { geometry: res.geometry, filled: res.filled, skipped: res.skipped };
  }
  const geometryData = {
    position: Array.from(geometry.attributes.position.array),
    normal: geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : null,
    index: geometry.index ? Array.from(geometry.index.array) : null
  };
  
  const result = await workerManager.send('fillHoles', {
    geometryData,
    options
  });
  
  return {
    geometry: deserializeGeometry(result.geometry),
    filled: result.filled,
    skipped: result.skipped
  };
}

// Smooth mesh using the worker
async function smoothAsync(geometry, options) {
  if (!probeWorker()) {
    return taubinSmooth(geometry, options);
  }
  const geometryData = {
    position: Array.from(geometry.attributes.position.array),
    normal: geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : null,
    index: geometry.index ? Array.from(geometry.index.array) : null
  };
  
  const result = await workerManager.send('smooth', {
    geometryData,
    options
  });
  
  return deserializeGeometry(result.geometry);
}

// Decimate mesh using the worker
async function decimateAsync(geometry, options) {
  if (!probeWorker()) {
    return decimateQEM(geometry, options);
  }
  const geometryData = {
    position: Array.from(geometry.attributes.position.array),
    normal: geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : null,
    index: geometry.index ? Array.from(geometry.index.array) : null
  };
  
  const result = await workerManager.send('decimate', {
    geometryData,
    options
  });
  
  return deserializeGeometry(result.geometry);
}

// Build shell using the worker
async function buildShellAsync(geometry, mask, options) {
  if (!probeWorker()) {
    return buildShell(geometry, mask, options);
  }
  const geometryData = {
    position: Array.from(geometry.attributes.position.array),
    normal: geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : null,
    index: geometry.index ? Array.from(geometry.index.array) : null
  };
  
  const result = await workerManager.send('buildShell', {
    geometryData,
    mask: Array.from(mask),
    options
  });
  
  return {
    geometry: result.geometry ? deserializeGeometry(result.geometry) : null,
    stats: result.stats
  };
}

// Analyze geometry using the worker
async function analyzeAsync(geometry) {
  const geometryData = {
    position: Array.from(geometry.attributes.position.array),
    normal: geometry.attributes.normal ? Array.from(geometry.attributes.normal.array) : null,
    index: geometry.index ? Array.from(geometry.index.array) : null
  };
  
  return await workerManager.send('analyze', {
    geometryData
  });
}

// Helper function to deserialize geometry
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
