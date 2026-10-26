// ============================================================================
// 1. GLOBAL BOOTSTRAP - React / THREE globals + viewport sync
// ============================================================================
const { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } = React;
const THREE = window.THREE;
const OrbitControls = THREE.OrbitControls;

// Keeps the CSS viewport height in sync with the mobile visual viewport so
// the 3D canvas never gets clipped by a mobile browser's URL bar.
function initViewportSync() {
  const updateHeight = () => {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', `${h}px`);
  };
  window.addEventListener('resize', updateHeight);
  window.addEventListener('orientationchange', () => setTimeout(updateHeight, 150));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', updateHeight);
    window.visualViewport.addEventListener('scroll', updateHeight);
  }
  updateHeight();
}
initViewportSync();

// Clamps a numeric input to a range without letting NaN through.
function clampNum(value, min, max, fallback = min) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
