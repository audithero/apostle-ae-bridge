/**
 * xterm.js Loader for MotionAmigo CEP Extension
 *
 * This script ensures xterm.js and the FitAddon are properly loaded
 * and available in the CEP (Common Extensibility Platform) environment.
 *
 * Load this AFTER xterm.js and xterm-addon-fit.js but BEFORE main.js
 */

(function(global) {
  'use strict';

  // --- Stage 1: Locate Terminal constructor ---
  var Terminal = null;

  if (typeof global.Terminal === 'function') {
    Terminal = global.Terminal;
  } else if (typeof self !== 'undefined' && typeof self.Terminal === 'function') {
    Terminal = self.Terminal;
  } else if (typeof window !== 'undefined' && typeof window.Terminal === 'function') {
    Terminal = window.Terminal;
  }

  if (!Terminal) {
    console.error('[XtermLoader] xterm.js Terminal not found on any scope!');
    console.error('[XtermLoader] Make sure xterm.js is loaded before this script');
    return;
  }

  // --- Stage 2: Locate FitAddon ---
  var FitAddonModule = null;

  if (typeof global.FitAddon === 'object' && global.FitAddon) {
    FitAddonModule = global.FitAddon;
  } else if (typeof self !== 'undefined' && typeof self.FitAddon === 'object' && self.FitAddon) {
    FitAddonModule = self.FitAddon;
  } else if (typeof window !== 'undefined' && typeof window.FitAddon === 'object' && window.FitAddon) {
    FitAddonModule = window.FitAddon;
  }

  if (!FitAddonModule || typeof FitAddonModule.FitAddon !== 'function') {
    console.error('[XtermLoader] FitAddon not found or missing FitAddon constructor!');
    console.error('[XtermLoader] Make sure xterm-addon-fit.js is loaded before this script');
    return;
  }

  // --- Stage 3: Validate API surface ---
  var testTerm = null;
  try {
    testTerm = new Terminal({ cols: 10, rows: 2 });
    if (typeof testTerm.write !== 'function' ||
        typeof testTerm.open !== 'function' ||
        typeof testTerm.dispose !== 'function' ||
        typeof testTerm.loadAddon !== 'function' ||
        typeof testTerm.reset !== 'function' ||
        typeof testTerm.clear !== 'function') {
      console.error('[XtermLoader] Terminal instance missing expected methods (write, open, dispose, loadAddon)');
      return;
    }

    var testFit = new FitAddonModule.FitAddon();
    if (typeof testFit.fit !== 'function' || typeof testFit.dispose !== 'function') {
      console.error('[XtermLoader] FitAddon instance missing expected methods (fit, dispose)');
      return;
    }
    testFit.dispose();
  } catch (e) {
    console.error('[XtermLoader] API validation failed:', e);
    return;
  } finally {
    if (testTerm) {
      try { testTerm.dispose(); } catch (e) { /* ignore */ }
    }
  }

  // --- Stage 4: Export normalized references ---
  global.XTerm = {
    Terminal: Terminal,
    FitAddon: FitAddonModule.FitAddon
  };

  console.log('[XtermLoader] xterm.js loaded successfully');
  console.log('[XtermLoader] Available: Terminal, FitAddon');

  // Export for module-style usage if needed
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.XTerm;
  }

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
