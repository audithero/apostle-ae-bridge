/**
 * Planck.js Loader for MotionAmigo CEP Extension
 * 
 * This script ensures Planck.js is properly loaded and available
 * in the CEP (Common Extensibility Platform) environment.
 * 
 * Load this AFTER planck.min.js but BEFORE physics-engine.js
 */

(function(global) {
  'use strict';

  // CEP extensions sometimes have weird global scope issues
  // This ensures planck is properly accessible
  
  // Check if planck was loaded
  if (typeof global.planck === 'undefined') {
    console.error('[PlanckLoader] Planck.js not found on global scope!');
    
    // Try to find it in other possible locations
    if (typeof planck !== 'undefined') {
      global.planck = planck;
      console.log('[PlanckLoader] Found planck in local scope, promoted to global');
    } else if (typeof window !== 'undefined' && typeof window.planck !== 'undefined') {
      global.planck = window.planck;
      console.log('[PlanckLoader] Found planck on window, promoted to global');
    } else {
      console.error('[PlanckLoader] Could not find Planck.js anywhere!');
      console.error('[PlanckLoader] Make sure planck.min.js is loaded before this script');
      return;
    }
  }

  // Verify planck has the expected API
  var planck = global.planck;
  
  var requiredFunctions = ['World', 'Vec2', 'Box', 'Circle', 'Polygon', 'Edge'];
  var missing = [];
  
  for (var i = 0; i < requiredFunctions.length; i++) {
    if (typeof planck[requiredFunctions[i]] !== 'function') {
      missing.push(requiredFunctions[i]);
    }
  }
  
  if (missing.length > 0) {
    console.error('[PlanckLoader] Planck.js is missing expected functions:', missing.join(', '));
    console.error('[PlanckLoader] The planck.min.js file may be corrupted or incompatible');
    return;
  }

  // Add version detection helper
  planck._motionAmigoVersion = '1.0.0';
  
  // Log successful load
  console.log('[PlanckLoader] Planck.js loaded successfully');
  console.log('[PlanckLoader] Available: World, Vec2, Box, Circle, Polygon, Edge, Chain');

  // Create a simple test to verify physics works
  global.testPlanck = function() {
    try {
      var world = planck.World({ gravity: planck.Vec2(0, 10) });
      var body = world.createBody({
        type: 'dynamic',
        position: planck.Vec2(0, 0)
      });
      body.createFixture(planck.Circle(1), { density: 1 });
      
      // Step the world
      world.step(1/60);
      
      var pos = body.getPosition();
      console.log('[PlanckLoader] Test passed! Body moved to:', pos.x, pos.y);
      
      // Cleanup
      world.destroyBody(body);
      
      return true;
    } catch (e) {
      console.error('[PlanckLoader] Test failed:', e);
      return false;
    }
  };

  // Export planck reference for module-style usage if needed
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = planck;
  }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
