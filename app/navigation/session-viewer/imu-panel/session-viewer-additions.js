// =======================================
// Session Viewer - Additional Features
// File: session-viewer-additions.js
//
// Adds support for:
// - Combined toggle UI (Raw Data/Sensor Fusion + Plots/CSV)
// - Arm angle analysis integration
// - Improved fusion cursor updates
// =======================================

(function() {
  'use strict';

  let delegatedClicksWired = false;

  // Setup combined toggles
  // View/format toggle clicks are handled by imu-panel.js wireViewToggles.
  // The old applyViewMode/applyFormatMode calls have been removed (undefined functions).
  function setupCombinedToggles() {
    delegatedClicksWired = true; // no-op: imu-panel handles these
  }
 
  // Update fusion display at current cursor position
  function updateFusionAtCurrentCursor() {
    if (!window.FusionManager) return;
    
    // Get current IMU from session
    const session = window.MoveSyncSessionStore?.getActiveSession?.() ?? null;
    if (!session) return;
    
    const imus = session.imus || [];
    if (!imus.length) return;
    
    const currentImu = imus[window.currentImuIndex || 0];
    if (!currentImu || !currentImu.fusionData) return;
    
    // Get current cursor time
    const cursorRange = document.getElementById('viewerImuCursorRange');
    if (!cursorRange) return;
    
    const cursorValue = parseFloat(cursorRange.value);
    const timeSeconds = currentImu.fusionData.times;
    if (!timeSeconds || !timeSeconds.length) return;
    
    const maxTime = timeSeconds[timeSeconds.length - 1];
    const cursorTime = cursorValue * maxTime;
    
    // Update fusion display
    window.FusionManager.updateDisplay(currentImu.fusionData, cursorTime);
  }
  
  // Populate arm angle selectors with available IMUs
  function populateArmAngleSelectors() {
    const session = window.MoveSyncSessionStore?.getActiveSession?.() ?? null;
    if (!session) return;
    
    const imus = session.imus || [];
    if (imus.length < 3) return; // Need at least 3 IMUs
    
    if (window.ArmAngleUI && window.ArmAngleUI.populateSelectors) {
      window.ArmAngleUI.populateSelectors(imus);
    }
  }
  
  // Store fusion data globally for arm angle analysis
  function storeFusionDataGlobally(imuIndex, fusionData) {
    if (!window.imuFusionData) {
      window.imuFusionData = {};
    }
    window.imuFusionData[imuIndex] = fusionData;
  }
  
  // Enhanced IMU cursor handler that updates fusion in real-time
  function setupFusionCursorUpdates() {
    const cursorRange = document.getElementById('viewerImuCursorRange');
    if (!cursorRange) return;
    
    let updateTimer = null;
    
    cursorRange.addEventListener('input', () => {
      // Throttle updates to avoid excessive re-renders
      if (updateTimer) clearTimeout(updateTimer);
      
      updateTimer = setTimeout(() => {
        // Only update if fusion view is active
        const fusionView = document.getElementById('viewerFusionView');
        if (fusionView && !fusionView.hasAttribute('hidden')) {
          updateFusionAtCurrentCursor();
        }
      }, 50); // 20 FPS max update rate
    });
  }
  
  // Initialize when page loads
  function init() {
    setupCombinedToggles();
    setupFusionCursorUpdates();
  }
  
  // Expose functions globally for integration
  window.SessionViewerAdditions = {
    init,
    updateFusionAtCurrentCursor,
    populateArmAngleSelectors,
    storeFusionDataGlobally
  };
  
  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  
})();