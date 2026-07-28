/**
 * MotionAmigo - After Effects Host Script (OPTIMIZED v2.1)
 * 
 * Performance optimizations applied:
 * 1. Cached property references (avoid repeated tree traversal)
 * 2. Optimized loops (reversed while, cached length)
 * 3. Match names for language-independent access
 * 4. Batched MCP command processing (ALL commands in one call)
 * 5. Combined command + history polling
 * 6. Batched connection status check
 * 7. Removed $.sleep() blocking
 * 8. Better JSON error handling
 * 
 * @version 2.1.0 - Optimized with faster communication
 * @author MotionAmigo
 */

// ============================================
// JSON POLYFILL - ExtendScript lacks native JSON in some AE versions
// ============================================
if (typeof JSON === "undefined") {
  JSON = {
    parse: function (s) {
      return eval("(" + s + ")");
    },
    stringify: (function () {
      var escMap = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"};
      var escRE = /[\\"\x00-\x1f]/g;
      var escFunc = function (m) { return escMap[m] || "\\u" + ("0000" + m.charCodeAt(0).toString(16)).slice(-4); };
      return function stringify(value) {
        if (value == null) return "null";
        if (typeof value === "boolean" || typeof value === "number") return "" + value;
        if (typeof value === "string") return '"' + value.replace(escRE, escFunc) + '"';
        if (value instanceof Array) {
          var arrRes = [];
          for (var i = 0; i < value.length; i++) arrRes.push(stringify(value[i]));
          return "[" + arrRes.join(",") + "]";
        }
        if (typeof value === "object") {
          var objRes = [];
          for (var k in value) {
            if (value.hasOwnProperty(k)) objRes.push('"' + k.replace(escRE, escFunc) + '":' + stringify(value[k]));
          }
          return "{" + objRes.join(",") + "}";
        }
        return "null";
      };
    })()
  };
}

// ============================================
// MATCH NAMES - Language-independent property access
// ============================================
var MATCH_NAMES = {
  transform: "ADBE Transform Group",
  position: "ADBE Position",
  anchorPoint: "ADBE Anchor Point",
  scale: "ADBE Scale",
  rotation: "ADBE Rotate Z",
  opacity: "ADBE Opacity",
  contents: "ADBE Root Vectors Group",
  effects: "ADBE Effect Parade"
};

// ============================================
// UTILITY FUNCTIONS (OPTIMIZED)
// ============================================

/**
 * Get the currently active composition (cached check)
 */
function getActiveComp() {
  var item = app.project.activeItem;
  return (item && item instanceof CompItem) ? item : null;
}

/**
 * Get selected layers - returns array directly
 */
function getSelectedLayers() {
  var comp = getActiveComp();
  return comp ? comp.selectedLayers : [];
}

/**
 * Get Transform property group for a layer (cached)
 * Using match name for language independence
 */
function getTransform(layer) {
  return layer.property(MATCH_NAMES.transform);
}

/**
 * Safe JSON stringify with error handling
 */
function safeStringify(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return '{"success":false,"error":"JSON stringify failed: ' + e.toString().replace(/"/g, '\\"') + '"}';
  }
}

/**
 * Safe JSON parse with error handling
 */
function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

/**
 * Create standard error response
 */
function errorResponse(message, extra) {
  var result = { success: false, error: message };
  if (extra) {
    for (var key in extra) {
      if (extra.hasOwnProperty(key)) result[key] = extra[key];
    }
  }
  return safeStringify(result);
}

/**
 * Create standard success response
 */
function successResponse(data) {
  var result = { success: true };
  if (data) {
    for (var key in data) {
      if (data.hasOwnProperty(key)) result[key] = data[key];
    }
  }
  return safeStringify(result);
}

/**
 * Sanitize aeInstanceTag before using it as a filename segment.
 * Mirrors the Node-side rule in questionHandler/presetHandlers/systemHandlers:
 * strip anything outside [A-Za-z0-9_-] so a malformed or hostile tag cannot
 * traverse outside userData/MotionAmigo/. Returns "" when the input is
 * non-string or resolves to empty after stripping.
 */
function __sanitizeAeInstanceTag(raw) {
  if (!raw || typeof raw !== "string") return "";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "");
}

// ============================================
// CONDITIONAL UNDO GROUP
// Prevents nesting when an MCP undo group is already open.
// AE does NOT support nested beginUndoGroup() — nesting causes
// "Undo group mismatch, will attempt to fix" warnings.
// ============================================

/**
 * Conditionally open an undo group only if one is not already open.
 * Returns true if this call opened the group (caller must close it).
 * Sets the coordination flag so nested calls from MCP scripts are prevented.
 */
function beginConditionalUndoGroup(name) {
  if ($.global.__motionamigo_undoGroupOpen) {
    return false;
  }
  app.beginUndoGroup(name);
  $.global.__motionamigo_undoGroupOpen = true;
  return true;
}

/**
 * Close an undo group only if the caller opened it.
 * Clears the flag BEFORE closing so the flag tracks reality even if endUndoGroup throws.
 * @param {boolean} ownGroup - The value returned by beginConditionalUndoGroup
 */
function endConditionalUndoGroup(ownGroup) {
  if (ownGroup) {
    $.global.__motionamigo_undoGroupOpen = false;
    app.endUndoGroup();
  }
}

// ============================================
// ANCHOR POINT - Optimized
// ============================================

function setAnchorPoint(position, compensate) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected", { layersAffected: 0 });
  
  // Pre-define anchor ratios (avoid object creation in loop)
  var anchorX = 0.5, anchorY = 0.5;
  switch (position) {
    case 'top-left': anchorX = 0; anchorY = 0; break;
    case 'top-center': anchorX = 0.5; anchorY = 0; break;
    case 'top-right': anchorX = 1; anchorY = 0; break;
    case 'middle-left': anchorX = 0; anchorY = 0.5; break;
    case 'center': anchorX = 0.5; anchorY = 0.5; break;
    case 'middle-right': anchorX = 1; anchorY = 0.5; break;
    case 'bottom-left': anchorX = 0; anchorY = 1; break;
    case 'bottom-center': anchorX = 0.5; anchorY = 1; break;
    case 'bottom-right': anchorX = 1; anchorY = 1; break;
  }
  
  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Set Anchor Point");

  var count = 0;
  var i = numLayers;

  // Reversed while loop - fastest iteration pattern
  try {
    while (i--) {
      var layer = layers[i];
      try {
        // Cache transform reference
        var transform = getTransform(layer);
        var anchorProp = transform.property(MATCH_NAMES.anchorPoint);
        var posProp = transform.property(MATCH_NAMES.position);

        var width = layer.width;
        var height = layer.height;
        var newAnchorX = width * anchorX;
        var newAnchorY = height * anchorY;
        var oldAnchor = anchorProp.value;

        anchorProp.setValue([newAnchorX, newAnchorY]);

        if (compensate !== false) {
          var deltaX = newAnchorX - oldAnchor[0];
          var deltaY = newAnchorY - oldAnchor[1];
          var pos = posProp.value;
          posProp.setValue([pos[0] + deltaX, pos[1] + deltaY]);
        }

        count++;
      } catch (e) { /* skip problematic layers */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }
  
  return successResponse({ layersAffected: count });
}

// ============================================
// MOVE SELECTED LAYERS - Optimized
// ============================================

function moveSelectedLayers(deltaX, deltaY) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected", { layersAffected: 0 });
  
  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Move Layers");

  var count = 0;
  var i = numLayers;

  try {
    while (i--) {
      var layer = layers[i];
      try {
        var posProp = getTransform(layer).property(MATCH_NAMES.position);
        var pos = posProp.value;
        var newPos = [pos[0] + deltaX, pos[1] + deltaY];
        if (pos.length > 2) newPos[2] = pos[2]; // Keep Z if 3D
        posProp.setValue(newPos);
        count++;
      } catch (e) { /* skip */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }
  
  return successResponse({ layersAffected: count });
}

// ============================================
// FILL COLOR
// ============================================

var MOTIONAMIGO_FILL_EFFECT_NAME = "MotionAmigo Color";

// Returns true if any layer in the project uses `source` that is NOT one of
// the layers in `selectedLayers`. Used to decide whether mutating a solid's
// shared color would bleed into other layers/comps.
function solidSourceHasExternalUsage(source, selectedLayers) {
  var excluded = {};
  for (var k = 0; k < selectedLayers.length; k++) {
    var sl = selectedLayers[k];
    try {
      excluded[String(sl.containingComp.id) + ":" + String(sl.index)] = true;
    } catch (e) { /* skip */ }
  }
  var items = app.project.items;
  for (var i = 1; i <= items.length; i++) {
    var it = items[i];
    if (!(it instanceof CompItem)) continue;
    var n = it.numLayers;
    for (var j = 1; j <= n; j++) {
      var lyr;
      try { lyr = it.layer(j); } catch (e) { continue; }
      try {
        if (lyr.source === source) {
          var marker = String(it.id) + ":" + String(lyr.index);
          if (!excluded[marker]) return true;
        }
      } catch (e) { /* skip */ }
    }
  }
  return false;
}

function _findCompById(compId) {
  var items = app.project.items;
  for (var i = 1; i <= items.length; i++) {
    var it = items[i];
    if (it instanceof CompItem && it.id === compId) return it;
  }
  return null;
}

function _findLayerInCompById(compItem, layerId) {
  if (!compItem || !(compItem instanceof CompItem)) return null;
  var n = compItem.numLayers;
  for (var i = 1; i <= n; i++) {
    var lyr;
    try { lyr = compItem.layer(i); } catch (e) { continue; }
    try { if (lyr.id === layerId) return lyr; } catch (e) { /* skip */ }
  }
  return null;
}

// Create a new solid FootageItem. AE's ExtendScript exposes addSolid only on
// CompItem.layers (it inserts a layer as a side effect), so we add a temp
// layer, capture its source, and remove the layer. The FootageItem persists.
function _createSolidItem(comp, fillColorRGB, name, width, height, pixelAspect, duration) {
  var tempLayer = comp.layers.addSolid(fillColorRGB, name, width, height, pixelAspect, duration);
  var item = tempLayer.source;
  tempLayer.remove();
  return item;
}

// Apply a non-destructive Fill effect to a layer that doesn't have a paint
// property of its own (photo / video / precomp). Reuses our previously-added
// effect if present (matched by name) so repeated clicks don't stack.
// Returns 1 on success, 0 otherwise. Original source is never touched.
function _applyFillEffect(layer, fillColorRGB) {
  try {
    var effects = layer.property(MATCH_NAMES.effects);
    if (!effects) return 0;
    var existing = null;
    for (var i = 1; i <= effects.numProperties; i++) {
      var fx = effects.property(i);
      if (fx && fx.matchName === "ADBE Fill" && fx.name === MOTIONAMIGO_FILL_EFFECT_NAME) {
        existing = fx;
        break;
      }
    }
    if (!existing) {
      existing = effects.addProperty("ADBE Fill");
      try { existing.name = MOTIONAMIGO_FILL_EFFECT_NAME; } catch (e) { /* keep default name */ }
    }
    var colorProp = existing.property("Color");
    if (!colorProp) return 0;
    colorProp.setValue([fillColorRGB[0], fillColorRGB[1], fillColorRGB[2], 1]);
    return 1;
  } catch (e) {
    return 0;
  }
}

function _findPaint(groupContents, matchName) {
  for (var i = 1; i <= groupContents.numProperties; i++) {
    var p = groupContents.property(i);
    if (p && p.matchName === matchName) return p;
  }
  return null;
}

// Apply fill color to a shape layer. Adds a Fill paint to any group that
// doesn't have one (parity with text layers, which always set fillColor).
function _applyShapeFill(layer, colorValue) {
  var c = 0;
  try {
    var contents = layer.property(MATCH_NAMES.contents);
    var numGroups = contents.numProperties;
    for (var j = 1; j <= numGroups; j++) {
      var group = contents.property(j);
      var groupContents = group.property("Contents");
      if (!groupContents) continue;
      var fill = _findPaint(groupContents, "ADBE Vector Graphic - Fill");
      if (!fill) {
        fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
        // Place new Fill before any existing Stroke so the stroke renders on
        // top of the fill (default expected look).
        try {
          var strokeIdx = -1;
          for (var k = 1; k <= groupContents.numProperties; k++) {
            var pp = groupContents.property(k);
            if (pp && pp.matchName === "ADBE Vector Graphic - Stroke") { strokeIdx = k; break; }
          }
          if (strokeIdx > 0 && strokeIdx < fill.propertyIndex) fill.moveTo(strokeIdx);
        } catch (e) { /* leave order as-is */ }
      }
      fill.property("Color").setValue(colorValue);
      c++;
    }
  } catch (e) { /* skip */ }
  return c;
}

function _applyShapeStroke(layer, colorValue) {
  var c = 0;
  try {
    var contents = layer.property(MATCH_NAMES.contents);
    var numGroups = contents.numProperties;
    for (var j = 1; j <= numGroups; j++) {
      var group = contents.property(j);
      var groupContents = group.property("Contents");
      if (!groupContents) continue;
      var stroke = _findPaint(groupContents, "ADBE Vector Graphic - Stroke");
      if (!stroke) {
        stroke = groupContents.addProperty("ADBE Vector Graphic - Stroke");
        // New stroke is appended; this lands after any existing Fill, which
        // is the conventional render order.
      }
      stroke.property("Color").setValue(colorValue);
      c++;
    }
  } catch (e) { /* skip */ }
  return c;
}

function _applyTextFill(layer, fillColorRGB) {
  try {
    var textProp = layer.property("Source Text");
    var textDoc = textProp.value;
    textDoc.fillColor = fillColorRGB;
    textProp.setValue(textDoc);
    return 1;
  } catch (e) { return 0; }
}

function _applyTextStroke(layer, strokeColorRGB) {
  try {
    var textProp = layer.property("Source Text");
    var textDoc = textProp.value;
    textDoc.applyStroke = true;
    textDoc.strokeColor = strokeColorRGB;
    textProp.setValue(textDoc);
    return 1;
  } catch (e) { return 0; }
}

// Apply a color to a group of solid-backed AVLayers sharing the same source.
// Duplicates the source first if any layer outside `groupLayers` uses it.
// Returns the array of layers that were actually updated — callers need
// this to record swatch links only for layers `replaceSource` succeeded on.
function _applySolidColorToGroup(groupLayers, fillColorRGB, fallbackDuration) {
  if (!groupLayers || !groupLayers.length) return [];
  var src = groupLayers[0].source;
  if (!src || !(src.mainSource instanceof SolidSource)) return [];
  if (!solidSourceHasExternalUsage(src, groupLayers)) {
    src.mainSource.color = fillColorRGB;
    return groupLayers.slice();
  }
  var comp = groupLayers[0].containingComp;
  if (!comp) return [];
  var newDuration = src.duration > 0 ? src.duration : fallbackDuration;
  var newSolid = _createSolidItem(
    comp, fillColorRGB, src.name, src.width, src.height, src.pixelAspect, newDuration
  );
  if (src.parentFolder) {
    try { newSolid.parentFolder = src.parentFolder; } catch (e) { /* leave at default */ }
  }
  var updated = [];
  for (var li = 0; li < groupLayers.length; li++) {
    try { groupLayers[li].replaceSource(newSolid, false); updated.push(groupLayers[li]); } catch (e) { /* skip */ }
  }
  return updated;
}

function setFillColor(r, g, b) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected");

  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Set Fill Color");

  var count = 0;
  var links = [];
  var colorValue = [r, g, b, 1];
  var fillColorRGB = [r, g, b];
  var solidGroups = {};
  var solidGroupKeys = [];

  try {
    var i = numLayers;
    while (i--) {
      var layer = layers[i];
      try {
        if (layer instanceof ShapeLayer) {
          var fillsTouched = _applyShapeFill(layer, colorValue);
          if (fillsTouched > 0) {
            count += fillsTouched;
            links.push({ compId: comp.id, layerId: layer.id, kind: "fill" });
          }
        } else if (layer instanceof TextLayer) {
          if (_applyTextFill(layer, fillColorRGB)) {
            count++;
            links.push({ compId: comp.id, layerId: layer.id, kind: "fill" });
          }
        } else if (layer instanceof AVLayer && layer.source && layer.source.mainSource instanceof SolidSource) {
          var src = layer.source;
          var key = String(src.id);
          if (!solidGroups[key]) {
            solidGroups[key] = { source: src, layers: [] };
            solidGroupKeys.push(key);
          }
          solidGroups[key].layers.push(layer);
        } else if (layer instanceof AVLayer && !layer.nullLayer && !layer.adjustmentLayer) {
          // Photo / video / nested comp footage → non-destructive Fill effect.
          if (_applyFillEffect(layer, fillColorRGB)) {
            count++;
            links.push({ compId: comp.id, layerId: layer.id, kind: "effectFill" });
          }
        }
      } catch (e) { /* skip */ }
    }

    // Second pass: handle solid-backed layers per source group with isolation.
    // Only record links for layers actually updated — replaceSource can fail
    // per-layer when duplicating the source, and we don't want the swatch to
    // "own" layers it never recolored.
    for (var gk = 0; gk < solidGroupKeys.length; gk++) {
      var groupInfo = solidGroups[solidGroupKeys[gk]];
      var updatedLayers = _applySolidColorToGroup(groupInfo.layers, fillColorRGB, comp.duration);
      count += updatedLayers.length;
      for (var li = 0; li < updatedLayers.length; li++) {
        links.push({ compId: comp.id, layerId: updatedLayers[li].id, kind: "solid" });
      }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }

  return successResponse({ layersAffected: count, links: links });
}

function setStrokeColor(r, g, b) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected");

  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Set Stroke Color");

  var count = 0;
  var links = [];
  var colorValue = [r, g, b, 1];
  var strokeColorRGB = [r, g, b];

  try {
    var i = numLayers;
    while (i--) {
      var layer = layers[i];
      try {
        if (layer instanceof ShapeLayer) {
          var strokesTouched = _applyShapeStroke(layer, colorValue);
          if (strokesTouched > 0) {
            count += strokesTouched;
            links.push({ compId: comp.id, layerId: layer.id, kind: "stroke" });
          }
        } else if (layer instanceof TextLayer) {
          if (_applyTextStroke(layer, strokeColorRGB)) {
            count++;
            links.push({ compId: comp.id, layerId: layer.id, kind: "stroke" });
          }
        }
      } catch (e) { /* skip */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }

  return successResponse({ layersAffected: count, links: links });
}

// Retint every layer-property a swatch previously owned. Called from the
// panel when the user edits the swatch's hex.
//   linksJson: JSON string of [{ compId, layerId, kind }]
function applySwatchToLinks(linksJson, r, g, b) {
  var links;
  try { links = JSON.parse(linksJson); } catch (e) { return errorResponse("Invalid links payload"); }
  if (!links || !links.length) return successResponse({ layersAffected: 0, deadLinks: [] });

  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Update Linked Color");

  var count = 0;
  var deadLinks = [];
  var colorValue = [r, g, b, 1];
  var fillColorRGB = [r, g, b];
  var solidGroups = {};
  var solidGroupKeys = [];

  try {
    for (var idx = 0; idx < links.length; idx++) {
      var link = links[idx];
      var comp = _findCompById(link.compId);
      var layer = comp ? _findLayerInCompById(comp, link.layerId) : null;
      if (!layer) { deadLinks.push(idx); continue; }

      try {
        if (link.kind === "fill") {
          if (layer instanceof ShapeLayer) {
            if (_applyShapeFill(layer, colorValue) > 0) count++; else deadLinks.push(idx);
          } else if (layer instanceof TextLayer) {
            if (_applyTextFill(layer, fillColorRGB)) count++; else deadLinks.push(idx);
          } else { deadLinks.push(idx); }
        } else if (link.kind === "stroke") {
          if (layer instanceof ShapeLayer) {
            if (_applyShapeStroke(layer, colorValue) > 0) count++; else deadLinks.push(idx);
          } else if (layer instanceof TextLayer) {
            if (_applyTextStroke(layer, fillColorRGB)) count++; else deadLinks.push(idx);
          } else { deadLinks.push(idx); }
        } else if (link.kind === "solid") {
          if (layer instanceof AVLayer && layer.source && layer.source.mainSource instanceof SolidSource) {
            var src = layer.source;
            var gKey = String(comp.id) + ":" + String(src.id);
            if (!solidGroups[gKey]) {
              solidGroups[gKey] = { comp: comp, layers: [] };
              solidGroupKeys.push(gKey);
            }
            solidGroups[gKey].layers.push(layer);
          } else { deadLinks.push(idx); }
        } else if (link.kind === "effectFill") {
          if (layer instanceof AVLayer) {
            if (_applyFillEffect(layer, fillColorRGB)) count++; else deadLinks.push(idx);
          } else { deadLinks.push(idx); }
        }
      } catch (e) { deadLinks.push(idx); }
    }

    for (var gk = 0; gk < solidGroupKeys.length; gk++) {
      var info = solidGroups[solidGroupKeys[gk]];
      count += _applySolidColorToGroup(info.layers, fillColorRGB, info.comp.duration).length;
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }

  return successResponse({ layersAffected: count, deadLinks: deadLinks });
}

// ============================================
// KEYFRAME VELOCITY - Optimized
// ============================================

function setKeyframeVelocity(velIn, velOut, influenceIn, influenceOut) {
  var comp = getActiveComp();
  if (!comp) return successResponse({ keyframesAffected: 0 });

  var layers = comp.selectedLayers;
  if (layers.length === 0) return successResponse({ keyframesAffected: 0 });

  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Set Keyframe Velocity");

  var count = 0;
  var rawInfIn = (influenceIn !== undefined && influenceIn !== null) ? influenceIn : 33.33;
  var rawInfOut = (influenceOut !== undefined && influenceOut !== null) ? influenceOut : 33.33;
  // 0 in the UI = LINEAR keyframe on that side. >0 = BEZIER with that ease.
  // KeyframeEase still requires influence > 0, so we floor at 0.1 for the
  // ease object even when the side is LINEAR (the LINEAR side ignores it).
  var inIsLinear = (rawInfIn <= 0);
  var outIsLinear = (rawInfOut <= 0);
  var infIn = inIsLinear ? 0.1 : rawInfIn;
  var infOut = outIsLinear ? 0.1 : rawInfOut;

  // Collect leaf properties from a property/group (recurses into groups)
  function collectLeafProps(propOrGroup, result) {
    try {
      if (propOrGroup.propertyType === PropertyType.PROPERTY) {
        result.push(propOrGroup);
      } else if (propOrGroup.numProperties) {
        for (var c = 1; c <= propOrGroup.numProperties; c++) {
          collectLeafProps(propOrGroup.property(c), result);
        }
      }
    } catch (e) {}
  }

  // Apply influence to selected keyframes on a leaf property, preserving existing speed.
  // Side with influence === 0 → LINEAR interpolation; > 0 → BEZIER with ease.
  function applyToProperty(prop) {
    try {
      if (!prop || prop.propertyType !== PropertyType.PROPERTY) return 0;
      if (prop.numKeys === 0) return 0;

      var inType = inIsLinear ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER;
      var outType = outIsLinear ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER;

      var applied = 0;
      for (var k = 1; k <= prop.numKeys; k++) {
        if (!prop.keySelected(k)) continue;

        // Read existing ease to preserve speed values
        var curIn = prop.keyInTemporalEase(k);
        var curOut = prop.keyOutTemporalEase(k);
        var dims = curIn.length;

        var easeIn = [];
        var easeOut = [];
        for (var d = 0; d < dims; d++) {
          easeIn.push(new KeyframeEase(curIn[d].speed, infIn));
          easeOut.push(new KeyframeEase(curOut[d].speed, infOut));
        }

        // Order matters — see _maApplyVelocityToKeys.
        prop.setTemporalEaseAtKey(k, easeIn, easeOut);
        prop.setInterpolationTypeAtKey(k, inType, outType);
        applied++;
      }
      return applied;
    } catch (e) { return 0; }
  }

  try {
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];

      // First pass: selectedProperties (flatten groups into leaf properties)
      var leafProps = [];
      var selProps = layer.selectedProperties;
      for (var s = 0; s < selProps.length; s++) {
        collectLeafProps(selProps[s], leafProps);
      }

      // Apply to all leaf properties found via selectedProperties
      for (var p = 0; p < leafProps.length; p++) {
        count += applyToProperty(leafProps[p]);
      }

      // Fallback: if selectedProperties yielded nothing, walk transform properties directly
      if (leafProps.length === 0) {
        try {
          var xform = layer.property("ADBE Transform Group");
          if (xform) {
            for (var t = 1; t <= xform.numProperties; t++) {
              count += applyToProperty(xform.property(t));
            }
          }
        } catch (e) {}
      }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }

  return successResponse({ keyframesAffected: count });
}

// ============================================
// SCALE LAYERS - Optimized
// ============================================

function scaleLayers(fromScale, toScale, frames) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected");
  
  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Scale Layers");

  var duration = frames / comp.frameRate;
  var currentTime = comp.time;
  var endTime = currentTime + duration;
  var fromScaleValue = [fromScale, fromScale, fromScale];
  var toScaleValue = [toScale, toScale, toScale];

  var count = 0;
  var i = numLayers;

  try {
    while (i--) {
      try {
        var scaleProp = getTransform(layers[i]).property(MATCH_NAMES.scale);
        scaleProp.setValueAtTime(currentTime, fromScaleValue);
        scaleProp.setValueAtTime(endTime, toScaleValue);
        count++;
      } catch (e) { /* skip */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }
  
  return successResponse({ layersAffected: count });
}

// ============================================
// ALIGN LAYERS - Optimized
// ============================================

function alignLayers(alignment) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected");
  
  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Align Layers");

  var compWidth = comp.width;
  var compHeight = comp.height;
  var count = 0;
  var i = numLayers;

  try {
    while (i--) {
      var layer = layers[i];
      try {
        var transform = getTransform(layer);
        var posProp = transform.property(MATCH_NAMES.position);
        var anchorProp = transform.property(MATCH_NAMES.anchorPoint);
        var scaleProp = transform.property(MATCH_NAMES.scale);

        var pos = posProp.value;
        var anchor = anchorProp.value;
        var scale = scaleProp.value;

        var scaleX = scale[0] / 100;
        var scaleY = scale[1] / 100;

        var newX = pos[0];
        var newY = pos[1];

        switch (alignment) {
          case 'left':
            newX = anchor[0] * scaleX;
            break;
          case 'center-h':
          case 'center':
            newX = compWidth / 2;
            break;
          case 'right':
            newX = compWidth - (layer.width - anchor[0]) * scaleX;
            break;
          case 'top':
            newY = anchor[1] * scaleY;
            break;
          case 'center-v':
            newY = compHeight / 2;
            break;
          case 'bottom':
            newY = compHeight - (layer.height - anchor[1]) * scaleY;
            break;
          case 'justify':
          case 'distribute':
            newX = compWidth / 2;
            break;
        }

        posProp.setValue([newX, newY, pos.length > 2 ? pos[2] : 0]);
        count++;
      } catch (e) { /* skip */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }
  
  return successResponse({ layersAffected: count });
}

// ============================================
// BOUNCE EXPRESSION - Optimized
// ============================================

function applyBounceExpression(overshoot, stiffness, damping, property) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected");
  
  var freq = 2 + (stiffness * 4);
  var decayRate = 4 + ((1 - damping) * 6);
  
  // Pre-build expression string
  var expression = 
    "// MotionAmigo Bounce\n" +
    "var overshoot = " + overshoot.toFixed(3) + ";\n" +
    "var freq = " + freq.toFixed(2) + ";\n" +
    "var decay = " + decayRate.toFixed(2) + ";\n\n" +
    "var n = 0;\n" +
    "if (numKeys > 0) {\n" +
    "  n = nearestKey(time).index;\n" +
    "  if (key(n).time > time) n--;\n" +
    "}\n\n" +
    "if (n > 0) {\n" +
    "  var t = time - key(n).time;\n" +
    "  var v = velocityAtTime(key(n).time - 0.001);\n" +
    "  value + v * (overshoot / freq) * Math.sin(freq * t * Math.PI * 2) * Math.exp(-decay * t);\n" +
    "} else {\n" +
    "  value;\n" +
    "}";
  
  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Apply Bounce");

  // Map property names to match names
  var propMatchName = MATCH_NAMES.scale; // default
  switch (property) {
    case 'position': propMatchName = MATCH_NAMES.position; break;
    case 'rotation': propMatchName = MATCH_NAMES.rotation; break;
    case 'opacity': propMatchName = MATCH_NAMES.opacity; break;
  }

  var count = 0;
  var i = numLayers;

  try {
    while (i--) {
      try {
        var prop = getTransform(layers[i]).property(propMatchName);
        if (prop) {
          prop.expression = expression;
          count++;
        }
      } catch (e) { /* skip */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }
  
  return successResponse({ layersAffected: count, expression: expression });
}

// ============================================
// INERTIAL BOUNCE - Optimized
// ============================================

function applyInertialBounce(amplitude, frequency, decay) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected");
  
  var expression = 
    "// MotionAmigo Inertial Bounce\n" +
    "// Amplitude: " + amplitude + " | Frequency: " + frequency + " | Decay: " + decay + "\n\n" +
    "var amp = " + amplitude.toFixed(3) + ";\n" +
    "var freq = " + frequency.toFixed(2) + ";\n" +
    "var decay = " + decay.toFixed(2) + ";\n\n" +
    "var n = 0;\n" +
    "var time_max = 4;\n\n" +
    "if (numKeys > 0) {\n" +
    "  n = nearestKey(time).index;\n" +
    "  if (key(n).time > time) n--;\n" +
    "}\n\n" +
    "if (n == 0) {\n" +
    "  var t = 0;\n" +
    "} else {\n" +
    "  var t = time - key(n).time;\n" +
    "}\n\n" +
    "if (n > 0 && t < time_max) {\n" +
    "  var v = velocityAtTime(key(n).time - thisComp.frameDuration/10);\n" +
    "  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);\n" +
    "} else {\n" +
    "  value;\n" +
    "}";
  
  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Apply Inertial Bounce");
  try {
    var count = 0;
    var appliedProps = [];
    var i = numLayers;

    while (i--) {
      var layer = layers[i];
      try {
        var selectedProps = layer.selectedProperties;
        if (selectedProps && selectedProps.length > 0) {
          var numProps = selectedProps.length;
          for (var j = 0; j < numProps; j++) {
            var prop = selectedProps[j];
            if (prop.canSetExpression) {
              prop.expression = expression;
              count++;
              appliedProps.push(prop.name);
            }
          }
        } else {
          var scaleProp = getTransform(layer).property(MATCH_NAMES.scale);
          if (scaleProp) {
            scaleProp.expression = expression;
            count++;
            appliedProps.push("Scale");
          }
        }
      } catch (e) { /* skip */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }

  return successResponse({
    layersAffected: count,
    properties: appliedProps,
    settings: { amplitude: amplitude, frequency: frequency, decay: decay }
  });
}

// ============================================
// ANTICIPATION & OVERSHOOT EXPRESSION
// ============================================

function applyAnticipationExpression(anticPct, anticFrames, overshootAmt, settleFrames) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected");

  // Phased interpolation curve between keyframe pairs:
  // Phase 1 (Anticipation): pullback from start value by anticAmt
  // Phase 2 (Action): main motion from pullback to overshoot
  // Phase 3 (Settle): overshoot settles to target value
  // Phase 4 (Hold): stays at target
  // All phases use smoothstep easing: p*p*(3-2*p)
  // Matches the panel graph visualization exactly.

  var expression =
    "// MotionAmigo Anticipation & Overshoot\n" +
    "var anticAmt = " + ((anticPct || 0) / 100).toFixed(4) + ";\n" +
    "var anticDur = " + (anticFrames || 0).toFixed(1) + ";\n" +
    "var overshoot = " + ((overshootAmt || 0) / 100).toFixed(4) + ";\n" +
    "var settleDur = " + (settleFrames || 0).toFixed(1) + ";\n\n" +
    "var fd = thisComp.frameDuration;\n" +
    "var n = 0;\n" +
    "if (numKeys > 0) {\n" +
    "  n = nearestKey(time).index;\n" +
    "  if (key(n).time > time) n--;\n" +
    "}\n\n" +
    "var result = value;\n\n" +
    "if (n > 0 && n < numKeys) {\n" +
    "  var k1t = key(n).time;\n" +
    "  var k2t = key(n + 1).time;\n" +
    "  var dur = k2t - k1t;\n" +
    "  if (dur > 0) {\n" +
    "    var t = clamp((time - k1t) / dur, 0, 1);\n\n" +
    "    // Phase boundaries (normalized 0-1, matching panel graph)\n" +
    "    var aEnd = (anticAmt > 0 && anticDur > 0) ? Math.min((anticDur * fd) / dur, 0.4) : 0;\n" +
    "    var rem = 1 - aEnd;\n" +
    "    var actDur = Math.max(0.12, rem * 0.35);\n" +
    "    var actEnd = aEnd + actDur;\n" +
    "    var sDurN = (overshoot > 0 && settleDur > 0) ? Math.min((settleDur * fd) / dur, 1 - actEnd) : 0;\n" +
    "    var sEnd = Math.min(1, actEnd + sDurN);\n\n" +
    "    // Curve value (cv): 0 at start, 1 at target\n" +
    "    var cv;\n" +
    "    if (aEnd > 0 && t < aEnd) {\n" +
    "      // Phase 1: Anticipation pullback\n" +
    "      var p = t / aEnd;\n" +
    "      cv = -anticAmt * p * p * (3 - 2 * p);\n" +
    "    } else if (t < actEnd) {\n" +
    "      // Phase 2: Main action\n" +
    "      var p = (t - aEnd) / (actEnd - aEnd);\n" +
    "      cv = -anticAmt + (1 + overshoot + anticAmt) * p * p * (3 - 2 * p);\n" +
    "    } else if (sDurN > 0 && t < sEnd) {\n" +
    "      // Phase 3: Overshoot settle\n" +
    "      var p = (t - actEnd) / (sEnd - actEnd);\n" +
    "      cv = (1 + overshoot) - overshoot * p * p * (3 - 2 * p);\n" +
    "    } else {\n" +
    "      // Phase 4: At target\n" +
    "      cv = 1;\n" +
    "    }\n\n" +
    "    // Interpolate between keyframe values using curve\n" +
    "    var s = key(n).value;\n" +
    "    var e = key(n + 1).value;\n" +
    "    result = s + (e - s) * cv;\n" +
    "  }\n" +
    "}\n\n" +
    "result;";

  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Apply Anticipation & Overshoot");
  try {
    var count = 0;
    var appliedProps = [];
    var i = numLayers;

    while (i--) {
      var layer = layers[i];
      try {
        var selectedProps = layer.selectedProperties;
        if (selectedProps && selectedProps.length > 0) {
          for (var j = 0; j < selectedProps.length; j++) {
            var prop = selectedProps[j];
            if (prop.canSetExpression) {
              prop.expression = expression;
              count++;
              appliedProps.push(prop.name);
            }
          }
        } else {
          // Fallback: apply to Position
          var posProp = getTransform(layer).property(MATCH_NAMES.position);
          if (posProp) {
            posProp.expression = expression;
            count++;
            appliedProps.push("Position");
          }
        }
      } catch (e) { /* skip */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }

  return successResponse({
    layersAffected: count,
    properties: appliedProps,
    settings: { anticPct: anticPct, anticFrames: anticFrames, overshootAmt: overshootAmt, settleFrames: settleFrames }
  });
}

// ============================================
// BASIC TRANSFORM APPLY (per-row Apply button)
// ============================================

// --- Qualifier expression builders ---
// Body matches applyInertialBounce.
function _maBuildBounceExpr(amplitude, frequency, decay) {
  return "// MotionAmigo Inertial Bounce (qualifier)\n" +
    "var amp = " + (amplitude || 0).toFixed(3) + ";\n" +
    "var freq = " + (frequency || 0).toFixed(2) + ";\n" +
    "var decay = " + (decay || 0).toFixed(2) + ";\n" +
    "var n = 0; var time_max = 4;\n" +
    "if (numKeys > 0) {\n" +
    "  n = nearestKey(time).index;\n" +
    "  if (key(n).time > time) n--;\n" +
    "}\n" +
    "if (n == 0) { var t = 0; } else { var t = time - key(n).time; }\n" +
    "if (n > 0 && t < time_max) {\n" +
    "  var v = velocityAtTime(key(n).time - thisComp.frameDuration/10);\n" +
    "  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);\n" +
    "} else { value; }";
}

// Body matches applyAnticipationExpression.
function _maBuildAnticipationExpr(anticPct, anticFrames, overshootAmt, settleFrames) {
  return "// MotionAmigo Anticipation & Overshoot (qualifier)\n" +
    "var anticAmt = " + ((anticPct || 0) / 100).toFixed(4) + ";\n" +
    "var anticDur = " + (anticFrames || 0).toFixed(1) + ";\n" +
    "var overshoot = " + ((overshootAmt || 0) / 100).toFixed(4) + ";\n" +
    "var settleDur = " + (settleFrames || 0).toFixed(1) + ";\n" +
    "var fd = thisComp.frameDuration;\n" +
    "var n = 0;\n" +
    "if (numKeys > 0) {\n" +
    "  n = nearestKey(time).index;\n" +
    "  if (key(n).time > time) n--;\n" +
    "}\n" +
    "var result = value;\n" +
    "if (n > 0 && n < numKeys) {\n" +
    "  var k1t = key(n).time;\n" +
    "  var k2t = key(n + 1).time;\n" +
    "  var dur = k2t - k1t;\n" +
    "  if (dur > 0) {\n" +
    "    var t = clamp((time - k1t) / dur, 0, 1);\n" +
    "    var aEnd = (anticAmt > 0 && anticDur > 0) ? Math.min((anticDur * fd) / dur, 0.4) : 0;\n" +
    "    var rem = 1 - aEnd;\n" +
    "    var actDur = Math.max(0.12, rem * 0.35);\n" +
    "    var actEnd = aEnd + actDur;\n" +
    "    var sDurN = (overshoot > 0 && settleDur > 0) ? Math.min((settleDur * fd) / dur, 1 - actEnd) : 0;\n" +
    "    var sEnd = Math.min(1, actEnd + sDurN);\n" +
    "    var cv;\n" +
    "    if (aEnd > 0 && t < aEnd) {\n" +
    "      var p = t / aEnd;\n" +
    "      cv = -anticAmt * p * p * (3 - 2 * p);\n" +
    "    } else if (t < actEnd) {\n" +
    "      var p = (t - aEnd) / (actEnd - aEnd);\n" +
    "      cv = -anticAmt + (1 + overshoot + anticAmt) * p * p * (3 - 2 * p);\n" +
    "    } else if (sDurN > 0 && t < sEnd) {\n" +
    "      var p = (t - actEnd) / (sEnd - actEnd);\n" +
    "      cv = (1 + overshoot) - overshoot * p * p * (3 - 2 * p);\n" +
    "    } else {\n" +
    "      cv = 1;\n" +
    "    }\n" +
    "    var s = key(n).value;\n" +
    "    var e = key(n + 1).value;\n" +
    "    result = s + (e - s) * cv;\n" +
    "  }\n" +
    "}\n" +
    "result;";
}

// Body matches applySquashStretchExpression.
function _maBuildSquashStretchExpr(maxDev, frequency, decay, preserveVolume) {
  var preserve = (preserveVolume !== false) ? "true" : "false";
  return "// MotionAmigo Squash & Stretch (qualifier)\n" +
    "var maxDev = " + (maxDev || 0).toFixed(1) + ";\n" +
    "var freq = " + (frequency || 0).toFixed(1) + ";\n" +
    "var dec = " + (decay || 0).toFixed(2) + ";\n" +
    "var preserve = " + preserve + ";\n" +
    "var fd = thisComp.frameDuration;\n" +
    "var pos = thisLayer.transform.position;\n" +
    "var triggerTime = -1;\n" +
    "var velFactor = 1;\n" +
    "if (numKeys > 0) {\n" +
    "  var n = nearestKey(time).index;\n" +
    "  if (key(n).time > time) n--;\n" +
    "  if (n > 0) triggerTime = key(n).time;\n" +
    "} else if (pos.numKeys > 0) {\n" +
    "  var pn = pos.nearestKey(time).index;\n" +
    "  if (pos.key(pn).time > time) pn--;\n" +
    "  if (pn > 0) triggerTime = pos.key(pn).time;\n" +
    "}\n" +
    "if (triggerTime >= 0 && pos.numKeys > 0) {\n" +
    "  var inSpeed = length(pos.velocityAtTime(triggerTime - fd));\n" +
    "  var maxSpd = 0;\n" +
    "  for (var i = 1; i <= pos.numKeys; i++) {\n" +
    "    var s = length(pos.velocityAtTime(pos.key(i).time - fd));\n" +
    "    if (s > maxSpd) maxSpd = s;\n" +
    "  }\n" +
    "  velFactor = (maxSpd > 0) ? clamp(inSpeed / maxSpd, 0, 1) : 0;\n" +
    "}\n" +
    "var result = value;\n" +
    "if (triggerTime >= 0 && maxDev > 0 && velFactor > 0.001) {\n" +
    "  var t = time - triggerTime;\n" +
    "  if (t >= 0 && t < 4) {\n" +
    "    var expVal = Math.exp(dec * t);\n" +
    "    if (expVal < 1000) {\n" +
    "      var dev = maxDev * velFactor * Math.sin(freq * t) / expVal;\n" +
    "      var sx = value[0] + dev;\n" +
    "      if (preserve) {\n" +
    "        var area = value[0] * value[1];\n" +
    "        var sy = area / Math.max(sx, 1);\n" +
    "        result = (value.length === 3) ? [sx, sy, value[2]] : [sx, sy];\n" +
    "      } else {\n" +
    "        result = (value.length === 3) ? [sx, value[1], value[2]] : [sx, value[1]];\n" +
    "      }\n" +
    "    }\n" +
    "  }\n" +
    "}\n" +
    "result;";
}

// Apply velocity/influence to specific keyframe indices on a property.
// Preserves the property's existing temporal dimensionality.
//
// Influence semantics:
//   - influence === 0  → side becomes LINEAR (diamond keyframe)
//   - influence > 0    → side stays BEZIER; ease applied with 0.1 floor
//     (AE rejects KeyframeEase with influence 0, so we floor defensively).
function _maApplyVelocityToKeys(prop, keyIndices, velIn, velOut, infIn, infOut) {
  if (!prop || !prop.numKeys) return 0;
  var aeInfIn = (infIn <= 0) ? 0.1 : infIn;
  var aeInfOut = (infOut <= 0) ? 0.1 : infOut;
  var inIsLinear = (infIn <= 0);
  var outIsLinear = (infOut <= 0);
  var applied = 0;
  for (var i = 0; i < keyIndices.length; i++) {
    var idx = keyIndices[i];
    if (idx < 1 || idx > prop.numKeys) continue;
    try {
      var curIn = prop.keyInTemporalEase(idx);
      var dims = curIn.length;
      var easeIn = [], easeOut = [];
      for (var d = 0; d < dims; d++) {
        easeIn.push(new KeyframeEase(velIn, aeInfIn));
        easeOut.push(new KeyframeEase(velOut, aeInfOut));
      }
      // ORDER MATTERS: setTemporalEaseAtKey reverts the side to BEZIER, so
      // we set ease FIRST (stored for if the user later toggles back to
      // BEZIER), then override with the interpolation type.
      var inType = inIsLinear ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER;
      var outType = outIsLinear ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER;
      prop.setTemporalEaseAtKey(idx, easeIn, easeOut);
      prop.setInterpolationTypeAtKey(idx, inType, outType);
      applied++;
    } catch (e) { /* skip */ }
  }
  return applied;
}

// Sets two keyframes on the selected layers' matching transform property,
// driven by a single transform row's configured values. Then walks the
// row's qualifiers and applies each one to the same property (squash &
// stretch always targets Scale). Mirrors the anticipation Apply pattern:
// direct ExtendScript call, no MCP/AI.
function applyBasicTransform(transformJson) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var layers = comp.selectedLayers;
  if (layers.length === 0) return errorResponse("No layers selected");

  var transform = safeParse(transformJson);
  if (!transform) return errorResponse("Invalid transform JSON");

  var type = transform.type;
  var direction = transform.direction || "in";
  var values = transform.values || {};
  var qualifiers = transform.qualifiers || [];
  var fps = comp.frameRate;
  var t0 = comp.time;

  if (type === "position") {
    if (!values.arrow) return errorResponse("Missing arrow direction");
    if (isNaN(parseFloat(values.distance)) || isNaN(parseFloat(values.timing))) {
      return errorResponse("Set distance and timing first");
    }
  } else if (type === "scale" || type === "rotation" || type === "opacity") {
    if (isNaN(parseFloat(values.start)) || isNaN(parseFloat(values.end)) || isNaN(parseFloat(values.timing))) {
      return errorResponse("Set start, end, and timing first");
    }
  } else {
    return errorResponse("Unsupported transform type: " + type);
  }

  var timing = parseFloat(values.timing);
  var t1 = t0 + (timing / fps);
  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Apply " + type);
  var count = 0;
  var qualifiersApplied = [];

  try {
    for (var i = 0; i < layers.length; i++) {
      var layer = layers[i];
      var group = getTransform(layer);
      var prop = null;

      try {
        // ===== Base keyframes =====
        if (type === "position") {
          prop = group.property(MATCH_NAMES.position);
          var anchor = prop.valueAtTime(t0, false);
          var dist = parseFloat(values.distance);
          var dx = 0, dy = 0;
          // Arrow indicates the direction the layer travels. For "in" the
          // layer ends at anchor, so it starts on the opposite side.
          if (values.arrow === "up") dy = dist;        // moves up → starts below
          else if (values.arrow === "down") dy = -dist; // moves down → starts above
          else if (values.arrow === "left") dx = dist;  // moves left → starts right
          else if (values.arrow === "right") dx = -dist; // moves right → starts left

          var offset = anchor.slice(0);
          offset[0] = anchor[0] + dx;
          offset[1] = anchor[1] + dy;

          if (direction === "in") {
            prop.setValueAtTime(t0, offset);
            prop.setValueAtTime(t1, anchor);
          } else {
            prop.setValueAtTime(t0, anchor);
            prop.setValueAtTime(t1, offset);
          }
        } else if (type === "scale") {
          prop = group.property(MATCH_NAMES.scale);
          var cur = prop.valueAtTime(t0, false);
          var sStart = [], sEnd = [];
          for (var k = 0; k < cur.length; k++) {
            sStart.push(parseFloat(values.start));
            sEnd.push(parseFloat(values.end));
          }
          if (direction === "in") {
            prop.setValueAtTime(t0, sStart);
            prop.setValueAtTime(t1, sEnd);
          } else {
            prop.setValueAtTime(t0, sEnd);
            prop.setValueAtTime(t1, sStart);
          }
        } else if (type === "rotation") {
          prop = group.property(MATCH_NAMES.rotation);
          var rs = parseFloat(values.start);
          var re = parseFloat(values.end);
          if (direction === "in") {
            prop.setValueAtTime(t0, rs);
            prop.setValueAtTime(t1, re);
          } else {
            prop.setValueAtTime(t0, re);
            prop.setValueAtTime(t1, rs);
          }
        } else if (type === "opacity") {
          prop = group.property(MATCH_NAMES.opacity);
          var os = parseFloat(values.start);
          var oe = parseFloat(values.end);
          if (direction === "in") {
            prop.setValueAtTime(t0, os);
            prop.setValueAtTime(t1, oe);
          } else {
            prop.setValueAtTime(t0, oe);
            prop.setValueAtTime(t1, os);
          }
        }

        if (!prop) continue;
        count++;

        // ===== Qualifiers =====
        // NOTE: bounce + anticipation both write the property's expression
        // — only the last one wins. squash-stretch targets Scale, so it
        // can coexist with bounce/anticipation on a non-scale transform.
        // keyframe-velocity modifies temporal ease, so it never conflicts.
        for (var q = 0; q < qualifiers.length; q++) {
          var qual = qualifiers[q];
          if (!qual || !qual.id) continue;
          var s = qual.settings || {};

          try {
            if (qual.id === "bounce") {
              if (prop.canSetExpression) {
                prop.expression = _maBuildBounceExpr(s.amplitude, s.frequency, s.decay);
                qualifiersApplied.push("bounce");
              }
            } else if (qual.id === "anticipation") {
              if (prop.canSetExpression) {
                prop.expression = _maBuildAnticipationExpr(s.anticAmount, s.anticDuration, s.overshoot, s.settle);
                qualifiersApplied.push("anticipation");
              }
            } else if (qual.id === "squash-stretch") {
              var sp = group.property(MATCH_NAMES.scale);
              if (sp && sp.canSetExpression) {
                sp.expression = _maBuildSquashStretchExpr(s.maxDev, s.frequency, s.decay, s.preserveVolume);
                qualifiersApplied.push("squash-stretch");
              }
            } else if (qual.id === "keyframe-velocity") {
              var idx0 = prop.nearestKeyIndex(t0);
              var idx1 = prop.nearestKeyIndex(t1);
              var infIn = (s.influenceIn !== undefined && s.influenceIn !== null) ? s.influenceIn : 33;
              var infOut = (s.influenceOut !== undefined && s.influenceOut !== null) ? s.influenceOut : 33;
              _maApplyVelocityToKeys(prop, [idx0, idx1], s.speedIn || 0, s.speedOut || 0, infIn, infOut);
              qualifiersApplied.push("keyframe-velocity");
            }
          } catch (e) { /* skip qualifier on error */ }
        }
      } catch (e) { /* skip layer on error */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }

  return successResponse({
    layersAffected: count,
    type: type,
    direction: direction,
    qualifiers: qualifiersApplied
  });
}


// ============================================
// SQUASH & STRETCH EXPRESSION
// ============================================

function applySquashStretchExpression(maxDev, frequency, decay, preserveVolume) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected");

  // Velocity-modulated squash & stretch.
  //
  // Oscillation shape: dev = maxDev * sin(freq * t) / exp(decay * t)
  // Matches the panel graph visualization exactly (no Math.PI factor).
  //
  // Velocity modulation: amplitude is proportional to incoming speed at
  // the trigger keyframe, normalized against the fastest impact across
  // all Position keyframes. This means:
  //   - Zero velocity at departure keyframes → no squash (natural)
  //   - Maximum velocity at hardest impact → full maxDev amplitude
  //   - Proportional for everything in between
  //
  // Trigger: Scale keyframes first → Position keyframes as fallback.
  // Velocity: Always sampled from Position (where physical motion lives).
  // Output: Matches layer dimensionality — [sx, sy] for 2D, [sx, sy, z] for 3D.

  var preserve = (preserveVolume !== false) ? "true" : "false";

  var expression =
    "// MotionAmigo Squash & Stretch (velocity-modulated)\n" +
    "var maxDev = " + (maxDev || 0).toFixed(1) + ";\n" +
    "var freq = " + (frequency || 0).toFixed(1) + ";\n" +
    "var dec = " + (decay || 0).toFixed(2) + ";\n" +
    "var preserve = " + preserve + ";\n\n" +
    "var fd = thisComp.frameDuration;\n" +
    "var pos = thisLayer.transform.position;\n" +
    "var triggerTime = -1;\n" +
    "var velFactor = 1;\n\n" +
    "// Determine trigger keyframe\n" +
    "if (numKeys > 0) {\n" +
    "  var n = nearestKey(time).index;\n" +
    "  if (key(n).time > time) n--;\n" +
    "  if (n > 0) triggerTime = key(n).time;\n" +
    "} else if (pos.numKeys > 0) {\n" +
    "  var pn = pos.nearestKey(time).index;\n" +
    "  if (pos.key(pn).time > time) pn--;\n" +
    "  if (pn > 0) triggerTime = pos.key(pn).time;\n" +
    "}\n\n" +
    "// Velocity modulation from Position\n" +
    "if (triggerTime >= 0 && pos.numKeys > 0) {\n" +
    "  var inSpeed = length(pos.velocityAtTime(triggerTime - fd));\n" +
    "  var maxSpd = 0;\n" +
    "  for (var i = 1; i <= pos.numKeys; i++) {\n" +
    "    var s = length(pos.velocityAtTime(pos.key(i).time - fd));\n" +
    "    if (s > maxSpd) maxSpd = s;\n" +
    "  }\n" +
    "  velFactor = (maxSpd > 0) ? clamp(inSpeed / maxSpd, 0, 1) : 0;\n" +
    "}\n\n" +
    "var result = value;\n\n" +
    "if (triggerTime >= 0 && maxDev > 0 && velFactor > 0.001) {\n" +
    "  var t = time - triggerTime;\n" +
    "  if (t >= 0 && t < 4) {\n" +
    "    var expVal = Math.exp(dec * t);\n" +
    "    if (expVal < 1000) {\n" +
    "      var dev = maxDev * velFactor * Math.sin(freq * t) / expVal;\n" +
    "      var sx = value[0] + dev;\n" +
    "      if (preserve) {\n" +
    "        var area = value[0] * value[1];\n" +
    "        var sy = area / Math.max(sx, 1);\n" +
    "        result = (value.length === 3) ? [sx, sy, value[2]] : [sx, sy];\n" +
    "      } else {\n" +
    "        result = (value.length === 3) ? [sx, value[1], value[2]] : [sx, value[1]];\n" +
    "      }\n" +
    "    }\n" +
    "  }\n" +
    "}\n\n" +
    "result;";

  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Apply Squash & Stretch");
  try {
    var count = 0;
    var i = numLayers;

    while (i--) {
      var layer = layers[i];
      try {
        // Always apply to Scale since squash-stretch is scale-based
        var scaleProp = getTransform(layer).property(MATCH_NAMES.scale);
        if (scaleProp) {
          scaleProp.expression = expression;
          count++;
        }
      } catch (e) { /* skip */ }
    }
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }

  return successResponse({
    layersAffected: count,
    settings: { maxDev: maxDev, frequency: frequency, decay: decay, preserveVolume: preserveVolume }
  });
}

// ============================================
// CREATE TEXT LAYER - Optimized
// ============================================

function createTextLayer(text, font, weight, size, color, style) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Create Text");
  try {
    var textLayer = comp.layers.addText(text || "Text");
    var textProp = textLayer.property("Source Text");
    var textDoc = textProp.value;

    var fontName = font || "Arial";
    if (weight && weight !== "Regular") {
      fontName = fontName + "-" + weight;
    }

    try {
      textDoc.font = fontName;
    } catch (e) {
      textDoc.font = font || "Arial";
    }

    textDoc.fontSize = size || 72;

    if (color && color.length >= 3) {
      textDoc.fillColor = color;
    }

    textProp.setValue(textDoc);

    // Center in comp
    getTransform(textLayer).property(MATCH_NAMES.position).setValue([comp.width / 2, comp.height / 2]);

    if (style) {
      textLayer.name = style + ": " + (text || "Text").substring(0, 20);
    }

    return successResponse({ layerIndex: textLayer.index, layerName: textLayer.name });
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }
}

// ============================================
// POSITION PICKER - Optimized
// ============================================

var PICKER_LAYER_NAME = "MotionAmigo_Null_Picker";
var PICKER_EFFECT_NAME = "Pick Position";

function getPickerPosition() {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var pickerLayer = null;
  var compCenterX = comp.width / 2;
  var compCenterY = comp.height / 2;
  
  // Find existing picker
  var numLayers = comp.numLayers;
  for (var i = 1; i <= numLayers; i++) {
    if (comp.layer(i).name === PICKER_LAYER_NAME) {
      pickerLayer = comp.layer(i);
      break;
    }
  }
  
  if (!pickerLayer) {
    var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Create Position Picker");
    try {
      pickerLayer = comp.layers.addNull();
      pickerLayer.name = PICKER_LAYER_NAME;
      pickerLayer.guideLayer = true;
      pickerLayer.shy = true;
      pickerLayer.label = 9;

      var pointControl = pickerLayer.property(MATCH_NAMES.effects).addProperty("ADBE Point Control");
      pointControl.name = PICKER_EFFECT_NAME;

      try {
        pointControl.property("Point").setValue([compCenterX, compCenterY]);
      } catch (e1) {
        try {
          pointControl(1).setValue([compCenterX, compCenterY]);
        } catch (e2) {
          pointControl.property(1).setValue([compCenterX, compCenterY]);
        }
      }

      pickerLayer.selected = true;
    } finally {
      endConditionalUndoGroup(__ownGroup__);
    }

    return successResponse({ created: true, x: compCenterX, y: compCenterY });
  }
  
  try {
    var effect = pickerLayer.property(MATCH_NAMES.effects).property(PICKER_EFFECT_NAME);
    if (effect) {
      var pos;
      try {
        pos = effect.property("Point").value;
      } catch (e1) {
        try {
          pos = effect(1).value;
        } catch (e2) {
          pos = effect.property(1).value;
        }
      }
      return successResponse({ created: false, x: pos[0], y: pos[1] });
    }
    return errorResponse("Effect not found on picker layer");
  } catch (e) {
    return errorResponse(e.toString());
  }
}

function resetPickerPosition() {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var numLayers = comp.numLayers;
  for (var i = 1; i <= numLayers; i++) {
    if (comp.layer(i).name === PICKER_LAYER_NAME) {
      var effect = comp.layer(i).property(MATCH_NAMES.effects).property(PICKER_EFFECT_NAME);
      if (effect) {
        var centerPos = [comp.width / 2, comp.height / 2];
        effect(1).setValue(centerPos);
        return successResponse({ x: centerPos[0], y: centerPos[1] });
      }
    }
  }
  return errorResponse("No picker found");
}

function deletePickerLayer() {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var numLayers = comp.numLayers;
  for (var i = 1; i <= numLayers; i++) {
    if (comp.layer(i).name === PICKER_LAYER_NAME) {
      comp.layer(i).remove();
      return successResponse({});
    }
  }
  return errorResponse("No picker found");
}

// ============================================
// COMP & LAYER INFO - Optimized
// ============================================

function getCompInfo() {
  var comp = getActiveComp();
  if (!comp) return safeStringify({ error: "No active composition" });
  
  return safeStringify({
    name: comp.name,
    width: comp.width,
    height: comp.height,
    frameRate: comp.frameRate,
    duration: comp.duration,
    numLayers: comp.numLayers
  });
}

function getSelectedLayersInfo() {
  var layers = getSelectedLayers();
  var numLayers = layers.length;
  if (numLayers === 0) return safeStringify({ count: 0, layers: [] });
  
  var info = [];
  var i = numLayers;
  
  while (i--) {
    var layer = layers[i];
    var layerType = "other";
    if (layer instanceof TextLayer) layerType = "text";
    else if (layer instanceof ShapeLayer) layerType = "shape";
    else if (layer instanceof AVLayer) layerType = "av";
    
    info.unshift({
      index: layer.index,
      name: layer.name,
      type: layerType
    });
  }
  
  return safeStringify({ count: numLayers, layers: info });
}

function hasSelectedLayers() {
  var layers = getSelectedLayers();
  return safeStringify({ hasSelection: layers.length > 0, count: layers.length });
}

// ============================================
// MOTION PATH - Optimized
// ============================================

function applyMotionPathToLayer(pathDataJSON, durationValue, durationUnit, rove) {
  var pathData = (typeof pathDataJSON === "string") ? safeParse(pathDataJSON) : pathDataJSON;
  if (!pathData) return errorResponse("Invalid path data");

  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var layers = comp.selectedLayers;
  if (layers.length === 0) return errorResponse("No layer selected — select a layer first");

  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Apply Motion Path");
  try {
    var layer = layers[0];
    var posProp = getTransform(layer).property(MATCH_NAMES.position);
    var startTime = comp.time;

    var numPoints = pathData.length;
    if (numPoints < 2) {
      return errorResponse("Need at least 2 points");
    }

    var rawValue = (typeof durationValue === "number" && durationValue > 0) ? durationValue : 2;
    var duration = (durationUnit === "frames") ? rawValue / comp.frameRate : rawValue;
    var segmentDuration = duration / (numPoints - 1);
    var is3D = posProp.value.length > 2;
    var zValue = is3D ? posProp.value[2] : 0;

    // Apply replaces the position track — clear any existing keyframes
    // so successive Applies don't stack overlapping paths. Remove from the
    // end so each call is O(1) (removeKey(1) would re-index every
    // remaining key, making a long path O(n²) on clear).
    while (posProp.numKeys > 0) {
      posProp.removeKey(posProp.numKeys);
    }

    // Add all keyframes first
    for (var i = 0; i < numPoints; i++) {
      var point = pathData[i];
      var keyTime = startTime + (i * segmentDuration);
      var posValue = is3D ? [point.x, point.y, zValue] : [point.x, point.y];
      posProp.setValueAtTime(keyTime, posValue);
    }

    // Then set spatial tangents (and roving for inner keyframes if requested)
    var shouldRove = rove !== false;
    for (var i = 0; i < numPoints; i++) {
      var point = pathData[i];
      var keyIndex = posProp.nearestKeyIndex(startTime + (i * segmentDuration));

      var inTangent = is3D ? [point.handleIn.x, point.handleIn.y, 0] : [point.handleIn.x, point.handleIn.y];
      var outTangent = is3D ? [point.handleOut.x, point.handleOut.y, 0] : [point.handleOut.x, point.handleOut.y];

      posProp.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
      posProp.setSpatialTangentsAtKey(keyIndex, inTangent, outTangent);

      // Rove only inner keyframes — AE forbids roving the first/last
      if (shouldRove && i > 0 && i < numPoints - 1) {
        try { posProp.setRovingAtKey(keyIndex, true); } catch (eRove) {}
      }
    }

    return successResponse({
      layerName: layer.name,
      keyframesCreated: numPoints,
      duration: duration
    });

  } catch (e) {
    return errorResponse(e.toString());
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }
}

// ============================================
// SHAPE FROM MOTION PATH
// ============================================

function createShapeFromMotionPath(pathDataJSON) {
  var pathData = (typeof pathDataJSON === "string") ? safeParse(pathDataJSON) : pathDataJSON;
  if (!pathData) return errorResponse("Invalid path data");

  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var numPoints = pathData.length;
  if (numPoints < 2) return errorResponse("Need at least 2 points");

  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Shape from Path");
  try {
    var layer = comp.layers.addShape();
    layer.name = "Motion Path";

    // Shape path coordinates are relative to the layer's anchor point.
    // The layer position defaults to comp center, so offset vertices accordingly.
    var offsetX = comp.width / 2;
    var offsetY = comp.height / 2;

    var contents = layer.property(MATCH_NAMES.contents);
    var group = contents.addProperty("ADBE Vector Group");
    group.name = "Path";
    var groupContents = group.property("Contents");

    // Build the shape path
    var pathProp = groupContents.addProperty("ADBE Vector Shape - Group");
    var shape = new Shape();

    var verts = [], inTans = [], outTans = [];
    for (var i = 0; i < numPoints; i++) {
      var pt = pathData[i];
      verts.push([pt.x - offsetX, pt.y - offsetY]);
      inTans.push([pt.handleIn ? pt.handleIn.x : 0, pt.handleIn ? pt.handleIn.y : 0]);
      outTans.push([pt.handleOut ? pt.handleOut.x : 0, pt.handleOut ? pt.handleOut.y : 0]);
    }

    shape.vertices = verts;
    shape.inTangents = inTans;
    shape.outTangents = outTans;
    shape.closed = false;

    pathProp.property("ADBE Vector Shape").setValue(shape);

    // Add a stroke (white, 2px)
    var stroke = groupContents.addProperty("ADBE Vector Graphic - Stroke");
    stroke.property("ADBE Vector Stroke Color").setValue([1, 1, 1, 1]);
    stroke.property("ADBE Vector Stroke Width").setValue(2);

    return successResponse({ layerName: layer.name, pointCount: numPoints });
  } catch (e) {
    return errorResponse(e.toString());
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }
}

// ============================================
// PHYSICS KEYFRAMES - Optimized
// ============================================

function applyPhysicsKeyframes(keyframeDataJSON) {
  var keyframeData = safeParse(keyframeDataJSON);
  if (!keyframeData) return errorResponse("Invalid JSON data");

  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var bodies = keyframeData.bodies;
  if (!bodies || bodies.length === 0) return errorResponse("No body keyframes to apply");

  var startTime = keyframeData.startTime || comp.time;
  var sampleStep = keyframeData.sampleStep || 1; // apply every Nth keyframe (1 = all)

  var __ownGroup__ = beginConditionalUndoGroup("MotionAmigo: Apply Physics Keyframes");
  try {
    var layersAffected = 0;

    for (var bi = 0; bi < bodies.length; bi++) {
      var bodyData = bodies[bi];
      var layerIndex = bodyData.layerIndex;
      if (!layerIndex) continue; // skip bodies without AE layer mapping

      var layer;
      try { layer = comp.layer(layerIndex); } catch (e) { continue; }
      if (!layer) continue;

      var transform = getTransform(layer);
      var posProp = transform.property(MATCH_NAMES.position);
      var rotProp = transform.property(MATCH_NAMES.rotation);
      var is3D = posProp.value.length > 2;
      var zValue = is3D ? posProp.value[2] : 0;

      // Compute anchor-to-center offset so physics center maps back correctly
      var anchorOffX = 0, anchorOffY = 0;
      var anch = transform.property(MATCH_NAMES.anchorPoint).value;
      var sc = transform.property(MATCH_NAMES.scale).value;
      if (layer.sourceRectAtTime) {
        try {
          var sRect = layer.sourceRectAtTime(0, false);
          var ccX = sRect.left + sRect.width / 2;
          var ccY = sRect.top + sRect.height / 2;
          anchorOffX = (ccX - anch[0]) * (sc[0] / 100);
          anchorOffY = (ccY - anch[1]) * (sc[1] / 100);
        } catch (eRect) {}
      }

      var posKeyframes = bodyData.position || [];
      var rotKeyframes = bodyData.rotation || [];

      // Apply position keyframes (subtract rotated anchor offset to convert physics center → AE position)
      for (var k = 0; k < posKeyframes.length; k += sampleStep) {
        var kf = posKeyframes[k];
        var keyTime = startTime + kf.time;
        // Get rotation at this frame to rotate the anchor offset correctly
        var rotDeg = (rotKeyframes[k] ? rotKeyframes[k].value : 0);
        var rotRad = rotDeg * Math.PI / 180;
        var cosR = Math.cos(rotRad);
        var sinR = Math.sin(rotRad);
        var px = kf.value[0] - (anchorOffX * cosR - anchorOffY * sinR);
        var py = kf.value[1] - (anchorOffX * sinR + anchorOffY * cosR);
        var posValue = is3D ? [px, py, zValue] : [px, py];
        posProp.setValueAtTime(keyTime, posValue);
      }
      // Always include last keyframe if thinning skipped it
      if (sampleStep > 1 && posKeyframes.length > 0) {
        var lastIdx = posKeyframes.length - 1;
        var lastPosKf = posKeyframes[lastIdx];
        var lastRotDeg = (rotKeyframes[lastIdx] ? rotKeyframes[lastIdx].value : 0);
        var lastRotRad = lastRotDeg * Math.PI / 180;
        var lCos = Math.cos(lastRotRad);
        var lSin = Math.sin(lastRotRad);
        var lpx = lastPosKf.value[0] - (anchorOffX * lCos - anchorOffY * lSin);
        var lpy = lastPosKf.value[1] - (anchorOffX * lSin + anchorOffY * lCos);
        posProp.setValueAtTime(startTime + lastPosKf.time, is3D ? [lpx, lpy, zValue] : [lpx, lpy]);
      }

      // Apply rotation keyframes
      for (var r = 0; r < rotKeyframes.length; r += sampleStep) {
        var rkf = rotKeyframes[r];
        rotProp.setValueAtTime(startTime + rkf.time, rkf.value);
      }
      if (sampleStep > 1 && rotKeyframes.length > 0) {
        var lastRotKf = rotKeyframes[rotKeyframes.length - 1];
        rotProp.setValueAtTime(startTime + lastRotKf.time, lastRotKf.value);
      }

      layersAffected++;
    }

    if (layersAffected === 0) return errorResponse("No imported layers matched. Import layers from comp first, then simulate.");

    return successResponse({
      layersAffected: layersAffected,
      duration: keyframeData.duration
    });

  } catch (e) {
    return errorResponse(e.toString());
  } finally {
    endConditionalUndoGroup(__ownGroup__);
  }
}

// ============================================
// PHYSICS BODIES FROM LAYERS - Optimized
// ============================================

function createPhysicsBodiesFromLayers() {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected. Select the layers you want to import.");

  var bodies = [];
  var i = numLayers;

  while (i--) {
    var layer = layers[i];
    try {
      var transform = getTransform(layer);
      var pos = transform.property(MATCH_NAMES.position).value;
      var scale = transform.property(MATCH_NAMES.scale).value;
      var anchor = transform.property(MATCH_NAMES.anchorPoint).value;
      var rotation = transform.property(MATCH_NAMES.rotation).value;

      // Get actual visual bounds using sourceRectAtTime for shape/text layers
      var width, height, offsetX, offsetY;
      offsetX = 0;
      offsetY = 0;

      if (layer.sourceRectAtTime) {
        try {
          var rect = layer.sourceRectAtTime(0, false);
          width = rect.width * (scale[0] / 100);
          height = rect.height * (scale[1] / 100);
          // sourceRect gives bounds relative to layer origin;
          // calculate center of content vs anchor offset
          var contentCenterX = rect.left + rect.width / 2;
          var contentCenterY = rect.top + rect.height / 2;
          offsetX = (contentCenterX - anchor[0]) * (scale[0] / 100);
          offsetY = (contentCenterY - anchor[1]) * (scale[1] / 100);
        } catch (e2) {
          width = layer.width * (scale[0] / 100);
          height = layer.height * (scale[1] / 100);
        }
      } else {
        width = layer.width * (scale[0] / 100);
        height = layer.height * (scale[1] / 100);
      }

      // Rotate anchor offset by layer rotation to get true visual center
      var rotRad = rotation * Math.PI / 180;
      var cosR = Math.cos(rotRad);
      var sinR = Math.sin(rotRad);
      var rotOffX = offsetX * cosR - offsetY * sinR;
      var rotOffY = offsetX * sinR + offsetY * cosR;

      // Position in comp space (accounting for rotated content center offset)
      var compX = pos[0] + rotOffX;
      var compY = pos[1] + rotOffY;

      // Skip very tiny layers (likely null objects or hidden)
      if (width < 2 && height < 2) continue;

      var isCircular = Math.abs(width - height) < Math.min(width, height) * 0.2;

      // Try to extract shape path vertices for polygon import, and detect
      // fill/stroke presence so the physics preview matches the AE layer
      // (solid, outline, or both).
      var vertices = null;
      var hasFreePath = false; // true if shape has freeform paths (letters, custom shapes)
      var hasParametricRect = false; // true if shape is an AE parametric rectangle (keep as rect even when square)
      var hasFill = false;
      var hasStroke = false;
      var fillColorVal = null;   // [r,g,b] 0-1
      var strokeColorVal = null; // [r,g,b] 0-1
      var strokeWidthVal = 0;    // AE pixels (pre-scale)
      var vertMinX = 0, vertMaxX = 0, vertMinY = 0, vertMaxY = 0;
      var vertBoundsValid = false;
      if (layer instanceof ShapeLayer) {
        try {
          var content = layer.property("ADBE Root Vectors Group");
          if (content && content.numProperties > 0) {
            var allVerts = [];

            // Scan root Contents level for fill/stroke — AE can place them
            // outside Vector Groups (common when a shape has a single path).
            for (var rc = 1; rc <= content.numProperties; rc++) {
              var rootChild = content.property(rc);
              if (rootChild.matchName === "ADBE Vector Graphic - Fill" && rootChild.enabled) {
                hasFill = true;
                try { var rfc = rootChild.property("ADBE Vector Fill Color").value; fillColorVal = [rfc[0], rfc[1], rfc[2]]; } catch (eRF) {}
              } else if (rootChild.matchName === "ADBE Vector Graphic - Stroke" && rootChild.enabled) {
                hasStroke = true;
                try {
                  var rsc = rootChild.property("ADBE Vector Stroke Color").value;
                  strokeColorVal = [rsc[0], rsc[1], rsc[2]];
                  strokeWidthVal = rootChild.property("ADBE Vector Stroke Width").value;
                } catch (eRS) {}
              } else if (rootChild.matchName === "ADBE Vector Graphic - G-Fill" && rootChild.enabled) {
                hasFill = true; // gradient fill — treat as fill, no solid color extracted
              } else if (rootChild.matchName === "ADBE Vector Graphic - G-Stroke" && rootChild.enabled) {
                hasStroke = true; // gradient stroke — treat as stroke, no solid color extracted
              }
            }

            for (var g = 1; g <= content.numProperties; g++) {
              var grp = content.property(g);
              if (grp.matchName === "ADBE Vector Group") {
                var vectors = grp.property("ADBE Vectors Group");
                if (vectors) {
                  for (var s = 1; s <= vectors.numProperties; s++) {
                    var sub = vectors.property(s);
                    // Detect fill/stroke presence inside the group (only if enabled —
                    // AE retains disabled entries in the tree)
                    if (sub.matchName === "ADBE Vector Graphic - Fill" && sub.enabled) {
                      hasFill = true;
                      try {
                        var fc = sub.property("ADBE Vector Fill Color").value;
                        fillColorVal = [fc[0], fc[1], fc[2]];
                      } catch (eF) {}
                    } else if (sub.matchName === "ADBE Vector Graphic - Stroke" && sub.enabled) {
                      hasStroke = true;
                      try {
                        var sc = sub.property("ADBE Vector Stroke Color").value;
                        strokeColorVal = [sc[0], sc[1], sc[2]];
                        strokeWidthVal = sub.property("ADBE Vector Stroke Width").value;
                      } catch (eS) {}
                    } else if (sub.matchName === "ADBE Vector Graphic - G-Fill" && sub.enabled) {
                      hasFill = true;
                    } else if (sub.matchName === "ADBE Vector Graphic - G-Stroke" && sub.enabled) {
                      hasStroke = true;
                    } else if (sub.matchName === "ADBE Vector Shape - Group") {
                      hasFreePath = true; // freeform path — NOT an ellipse/rect parametric
                      var pv = sub.property("ADBE Vector Shape").value;
                      for (var vi = 0; vi < pv.vertices.length; vi++) {
                        allVerts.push([pv.vertices[vi][0], pv.vertices[vi][1]]);
                      }
                    } else if (sub.matchName === "ADBE Vector Shape - Rect") {
                      hasParametricRect = true; // a square parametric rect is still a rectangle
                      var rSize = sub.property("ADBE Vector Rect Size").value;
                      var hw = rSize[0] / 2, hh = rSize[1] / 2;
                      allVerts.push([-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]);
                    } else if (sub.matchName === "ADBE Vector Shape - Ellipse") {
                      var eSize = sub.property("ADBE Vector Ellipse Size").value;
                      var rx = eSize[0] / 2, ry = eSize[1] / 2;
                      for (var ei = 0; ei < 8; ei++) {
                        var ang = ei * Math.PI * 2 / 8;
                        allVerts.push([rx * Math.cos(ang), ry * Math.sin(ang)]);
                      }
                    } else if (sub.matchName === "ADBE Vector Shape - Star") {
                      var starType = sub.property("ADBE Vector Star Type").value;
                      var pts = sub.property("ADBE Vector Star Points").value;
                      var outerR = sub.property("ADBE Vector Star Outer Radius").value;
                      if (starType === 2) {
                        for (var pi = 0; pi < pts; pi++) {
                          var pa = pi * Math.PI * 2 / pts - Math.PI / 2;
                          allVerts.push([outerR * Math.cos(pa), outerR * Math.sin(pa)]);
                        }
                      } else {
                        var innerR = sub.property("ADBE Vector Star Inner Radius").value;
                        for (var si = 0; si < pts * 2; si++) {
                          var sa = si * Math.PI / pts - Math.PI / 2;
                          var sr = (si % 2 === 0) ? outerR : innerR;
                          allVerts.push([sr * Math.cos(sa), sr * Math.sin(sa)]);
                        }
                      }
                    }
                  }
                }
              }
            }
            if (allVerts.length >= 3) {
              // Scale vertices by layer scale
              var sx = scale[0] / 100;
              var sy = scale[1] / 100;
              var scaled = [];
              for (var cv = 0; cv < allVerts.length; cv++) {
                scaled.push([allVerts[cv][0] * sx, allVerts[cv][1] * sy]);
              }
              // Center vertices on origin (AE vertices may be offset from [0,0])
              var minX = scaled[0][0], maxX = scaled[0][0];
              var minY = scaled[0][1], maxY = scaled[0][1];
              for (var bv = 1; bv < scaled.length; bv++) {
                if (scaled[bv][0] < minX) minX = scaled[bv][0];
                if (scaled[bv][0] > maxX) maxX = scaled[bv][0];
                if (scaled[bv][1] < minY) minY = scaled[bv][1];
                if (scaled[bv][1] > maxY) maxY = scaled[bv][1];
              }
              var cenX = (minX + maxX) / 2;
              var cenY = (minY + maxY) / 2;
              vertices = [];
              for (var ov = 0; ov < scaled.length; ov++) {
                vertices.push([scaled[ov][0] - cenX, scaled[ov][1] - cenY]);
              }
              vertMinX = minX - cenX;
              vertMaxX = maxX - cenX;
              vertMinY = minY - cenY;
              vertMaxY = maxY - cenY;
              vertBoundsValid = true;
            }
          }
        } catch (e3) { /* vertex extraction failed — fall through to circle/rect */ }
      }

      // Freeform paths (letters, custom shapes) are never circles,
      // even if their bounding box is roughly square (e.g. "C", "A", "O").
      // Parametric rectangles are never circles either — a square is still a
      // rectangle, and Miguel hit this with a near-square "Simulate" rect.
      if (hasFreePath || hasParametricRect) {
        isCircular = false;
      }

      // Don't use polygon vertices for actual circular shapes — keep them as smooth circles
      if (vertices && isCircular) {
        vertices = null;
        vertBoundsValid = false;
      }

      // Freeform-path vertices are bezier anchor points; the rendered curve
      // extends past them. Scale the hull so its bbox matches sourceRectAtTime
      // visible bounds — the visual polygon in the physics preview matches the
      // rendered glyph. However, the physics FIXTURE uses a rectangle bounding
      // box (useBoxPhysics flag) because Planck's 12-vertex convex hull is too
      // lossy for concave letters like "e", "a", "s" — the hull is smaller
      // than the visual, letting letters escape containers.
      if (hasFreePath && vertices && vertices.length >= 3 && vertBoundsValid) {
        var vertW = vertMaxX - vertMinX;
        var vertH = vertMaxY - vertMinY;
        if (vertW > 0 && vertH > 0 && width > 0 && height > 0) {
          var scX = width / vertW;
          var scY = height / vertH;
          for (var sv = 0; sv < vertices.length; sv++) {
            vertices[sv][0] *= scX;
            vertices[sv][1] *= scY;
          }
        }
      }

      // Render mode inferred from AE fill/stroke composition.
      // Stroke-only layers typically represent walls/outlines and are
      // marked static on the panel side so they don't fall under gravity.
      var renderMode = 'fill';
      if (hasStroke && !hasFill) {
        renderMode = 'stroke';
      } else if (hasStroke && hasFill) {
        renderMode = 'both';
      }

      // Extract position keyframes if any (for kinematic import)
      var posKeyframes = null;
      var posProp = transform.property(MATCH_NAMES.position);
      if (posProp.numKeys > 1) {
        posKeyframes = [];
        var rotPropKf = transform.property(MATCH_NAMES.rotation);
        var k = 0;
        while (k < posProp.numKeys) {
          k++;
          var kTime = posProp.keyTime(k);
          var kVal = posProp.keyValue(k);
          // Get rotation at this keyframe time for correct offset
          var kRot = rotPropKf.valueAtTime(kTime, false) * Math.PI / 180;
          var kCos = Math.cos(kRot);
          var kSin = Math.sin(kRot);
          var kOffX = offsetX * kCos - offsetY * kSin;
          var kOffY = offsetX * kSin + offsetY * kCos;
          posKeyframes.push({ time: kTime, x: kVal[0] + kOffX, y: kVal[1] + kOffY });
        }
      }

      // Extract rotation keyframes if any
      var rotKeyframes = null;
      var rotProp = transform.property(MATCH_NAMES.rotation);
      if (rotProp.numKeys > 1) {
        rotKeyframes = [];
        var rk = 0;
        while (rk < rotProp.numKeys) {
          rk++;
          rotKeyframes.push({ time: rotProp.keyTime(rk), value: rotProp.keyValue(rk) });
        }
      }

      bodies.unshift({
        label: layer.name,
        layerIndex: layer.index,
        position: { x: compX, y: compY },
        rotation: rotation,
        shape: (vertices && !isCircular) ? 'polygon' : (isCircular ? 'circle' : 'rectangle'),
        radius: isCircular ? Math.min(width, height) / 2 : 0,
        width: width,
        height: height,
        vertices: vertices,
        isStatic: false,
        posKeyframes: posKeyframes,
        rotKeyframes: rotKeyframes,
        renderMode: renderMode,
        fillColor: fillColorVal,
        strokeColor: strokeColorVal,
        strokeWidth: strokeWidthVal
      });
    } catch (e) { /* skip layers that can't be read */ }
  }

  if (bodies.length === 0) return errorResponse("No importable layers found in selection.");

  return successResponse({
    bodies: bodies,
    compWidth: comp.width,
    compHeight: comp.height,
    frameRate: comp.frameRate
  });
}

// ============================================
// LAYER PROXIES FOR MOTION PATH / STORYBOARD
// ============================================

function getSelectedLayerProxies() {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");

  var layers = comp.selectedLayers;
  var numLayers = layers.length;
  if (numLayers === 0) return errorResponse("No layers selected. Select the layers you want to import.");

  var proxies = [];
  var i = numLayers;

  while (i--) {
    var layer = layers[i];
    try {
      var transform = getTransform(layer);
      var pos = transform.property(MATCH_NAMES.position).value;
      var scale = transform.property(MATCH_NAMES.scale).value;
      var anchor = transform.property(MATCH_NAMES.anchorPoint).value;
      var rotation = transform.property(MATCH_NAMES.rotation).value;

      var width, height2, offsetX = 0, offsetY = 0;

      if (layer.sourceRectAtTime) {
        try {
          var rect = layer.sourceRectAtTime(0, false);
          width = rect.width * (scale[0] / 100);
          height2 = rect.height * (scale[1] / 100);
          var contentCenterX = rect.left + rect.width / 2;
          var contentCenterY = rect.top + rect.height / 2;
          offsetX = (contentCenterX - anchor[0]) * (scale[0] / 100);
          offsetY = (contentCenterY - anchor[1]) * (scale[1] / 100);
        } catch (e2) {
          width = layer.width * (scale[0] / 100);
          height2 = layer.height * (scale[1] / 100);
        }
      } else {
        width = layer.width * (scale[0] / 100);
        height2 = layer.height * (scale[1] / 100);
      }

      var compX = pos[0] + offsetX;
      var compY = pos[1] + offsetY;

      if (width < 2 && height2 < 2) continue;

      var isCircular = Math.abs(width - height2) < Math.min(width, height2) * 0.2;

      proxies.unshift({
        name: layer.name,
        layerIndex: layer.index,
        x: compX,
        y: compY,
        width: width,
        height: height2,
        rotation: rotation,
        shape: isCircular ? 'circle' : 'rectangle'
      });
    } catch (e) { /* skip unreadable layers */ }
  }

  if (proxies.length === 0) return errorResponse("No importable layers found in selection.");

  return successResponse({
    layers: proxies,
    compWidth: comp.width,
    compHeight: comp.height
  });
}

function createPhysicsGround(height) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var groundHeight = height || 50;
  
  return successResponse({
    body: {
      label: 'Ground',
      layerIndex: null,
      position: { x: comp.width / 2, y: comp.height - groundHeight / 2 },
      shape: 'rectangle',
      width: comp.width,
      height: groundHeight,
      mass: 0,
      restitution: 0.3,
      friction: 0.5,
      isStatic: true
    }
  });
}

function createPhysicsWalls(thickness) {
  var comp = getActiveComp();
  if (!comp) return errorResponse("No active composition");
  
  var t = thickness || 50;
  var w = comp.width;
  var h = comp.height;
  
  return successResponse({
    walls: [
      { label: 'Wall_Bottom', layerIndex: null, position: { x: w / 2, y: h + t / 2 }, shape: 'rectangle', width: w + t * 2, height: t, isStatic: true, restitution: 0.3, friction: 0.5 },
      { label: 'Wall_Top', layerIndex: null, position: { x: w / 2, y: -t / 2 }, shape: 'rectangle', width: w + t * 2, height: t, isStatic: true, restitution: 0.3, friction: 0.5 },
      { label: 'Wall_Left', layerIndex: null, position: { x: -t / 2, y: h / 2 }, shape: 'rectangle', width: t, height: h, isStatic: true, restitution: 0.3, friction: 0.5 },
      { label: 'Wall_Right', layerIndex: null, position: { x: w + t / 2, y: h / 2 }, shape: 'rectangle', width: t, height: h, isStatic: true, restitution: 0.3, friction: 0.5 }
    ]
  });
}

// ============================================
// TYPOGRAPHY - Production Quality Font System
// ============================================

// Font cache for performance (persists during AE session)
var _fontCache = null;
var _fontCacheTime = 0;
var _fontCacheMaxAge = 300000; // 5 minutes cache validity

/**
 * Get the weight order index for sorting font styles
 * Lower number = lighter weight, appears first
 */
function getFontWeightOrder(styleName) {
  var style = (styleName || "").toLowerCase();

  // Define weight order (lighter to heavier)
  var weightMap = {
    "hairline": 10,
    "thin": 20,
    "ultralight": 30,
    "ultra light": 30,
    "extralight": 40,
    "extra light": 40,
    "light": 50,
    "book": 60,
    "normal": 70,
    "regular": 70,
    "roman": 70,
    "text": 70,
    "medium": 80,
    "demi": 90,
    "demibold": 90,
    "demi bold": 90,
    "semibold": 100,
    "semi bold": 100,
    "bold": 110,
    "extrabold": 120,
    "extra bold": 120,
    "ultrabold": 130,
    "ultra bold": 130,
    "heavy": 140,
    "black": 150,
    "extrablack": 160,
    "extra black": 160,
    "ultrablack": 170,
    "ultra black": 170
  };

  // Check for italic modifier (adds 5 to keep italic after its upright counterpart)
  var isItalic = style.indexOf("italic") !== -1 || style.indexOf("oblique") !== -1;
  var italicOffset = isItalic ? 5 : 0;

  // Find base weight
  for (var weight in weightMap) {
    if (weightMap.hasOwnProperty(weight) && style.indexOf(weight) !== -1) {
      return weightMap[weight] + italicOffset;
    }
  }

  // Default to regular weight
  return 70 + italicOffset;
}

/**
 * Sort styles array by weight order
 */
function sortFontStyles(styles) {
  return styles.sort(function(a, b) {
    var orderA = getFontWeightOrder(a.style);
    var orderB = getFontWeightOrder(b.style);
    if (orderA !== orderB) return orderA - orderB;
    // Secondary sort alphabetically for same weight
    return (a.style || "").localeCompare(b.style || "");
  });
}

/**
 * Read all fonts using app.fonts.allFonts (AE 24.0+).
 *
 * app.fonts.allFonts returns an Array of Arrays: each top-level element
 * is a family group, and each item within is a FontObject with properties:
 *   familyName, styleName, postScriptName, isSubstitute, etc.
 *
 * Returns { map: {familyName -> {family, styles[], _styleMap}}, count: rawFontCount }
 */
function readFontsFromAPI() {
  var fontMap = {};
  var rawCount = 0;

  try {
    var fontsObj = app.fonts;
    if (!fontsObj || typeof fontsObj.allFonts === "undefined") return { map: fontMap, count: 0 };

    var allFonts = fontsObj.allFonts;
    if (!allFonts || allFonts.length === 0) return { map: fontMap, count: 0 };

    for (var g = 0; g < allFonts.length; g++) {
      var familyGroup = allFonts[g];
      if (!familyGroup || familyGroup.length === 0) continue;

      for (var f = 0; f < familyGroup.length; f++) {
        try {
          var font = familyGroup[f];
          rawCount++;

          var family = font.familyName;
          var style = font.styleName;
          var psName = font.postScriptName;

          // Skip invalid entries
          if (!family || family.length === 0) continue;

          // Skip hidden/system fonts (often start with .)
          if (family.charAt(0) === ".") continue;

          // Skip substitute (missing) fonts — they are placeholders, not real
          if (font.isSubstitute) continue;

          // Create family entry if needed
          if (!fontMap[family]) {
            fontMap[family] = {
              family: family,
              styles: [],
              _styleMap: {}
            };
          }

          // Deduplicate styles within a family
          var styleKey = (style || "Regular") + "|" + (psName || "");
          if (!fontMap[family]._styleMap[styleKey]) {
            fontMap[family]._styleMap[styleKey] = true;
            fontMap[family].styles.push({
              style: style || "Regular",
              postScriptName: psName || family
            });
          }
        } catch (fontErr) {
          // Skip problematic font entries silently
        }
      }
    }
  } catch (e) {
    // API not available or error — caller handles empty result
  }

  return { map: fontMap, count: rawCount };
}

/**
 * Build the sorted fonts array from a fontMap, ready for serialization.
 * Removes internal _styleMap tracking and sorts families alphabetically,
 * styles by weight within each family.
 */
function buildSortedFontsArray(fontMap) {
  var fonts = [];
  for (var fam in fontMap) {
    if (fontMap.hasOwnProperty(fam)) {
      var familyData = fontMap[fam];
      delete familyData._styleMap;
      familyData.styles = sortFontStyles(familyData.styles);
      fonts.push(familyData);
    }
  }
  fonts.sort(function(a, b) {
    return a.family.localeCompare(b.family);
  });
  return fonts;
}

/**
 * Write font data to a temp file for the panel JS to read.
 *
 * evalScript has practical string-size limits that truncate large payloads.
 * With hundreds of font families and multiple styles each, the JSON easily
 * exceeds those limits. Instead we write the full font JSON to a known file
 * path and return only lightweight metadata through evalScript. The panel JS
 * reads the file via Node.js fs (already available in the project).
 *
 * Returns the file path on success, or empty string on failure.
 */
function writeFontsToFile(fonts) {
  try {
    var folder = new Folder(Folder.userData.fsName + "/MotionAmigo");
    if (!folder.exists) folder.create();

    var filePath = folder.fsName + "/system_fonts.json";
    var file = new File(filePath);
    file.encoding = "UTF-8";
    file.open("w");
    file.write(JSON.stringify(fonts));
    file.close();
    return filePath;
  } catch (e) {
    return "";
  }
}

/**
 * Main font retrieval function — Production Quality
 *
 * Uses app.fonts.allFonts (AE 24.0+) which returns a grouped array-of-arrays
 * organized by font family. Each FontObject exposes familyName, styleName,
 * postScriptName, isSubstitute, etc.
 *
 * Strategy:
 * 1. Check in-memory cache first (avoids re-enumeration within 5 minutes)
 * 2. Read via app.fonts.allFonts
 * 3. If empty, fall back to comprehensive hardcoded default list
 *
 * The full font list is written to a temp file to avoid evalScript size limits.
 * Only lightweight metadata (count, method, filePath) is returned via evalScript.
 */
function getSystemFonts(forceRefresh) {
  try {
    var debugInfo = "";
    var method = "unknown";
    var now = new Date().getTime();

    // Check cache unless force refresh requested
    if (!forceRefresh && _fontCache && (now - _fontCacheTime) < _fontCacheMaxAge) {
      // Even for cache hits, write to file — panel may have reloaded
      var cachedPath = writeFontsToFile(_fontCache.fonts);
      return successResponse({
        count: _fontCache.fonts.length,
        rawFontCount: _fontCache.rawCount,
        method: "cache",
        cached: true,
        filePath: cachedPath,
        debug: "cache_hit"
      });
    }

    debugInfo += "cache_miss; ";

    // Read via app.fonts.allFonts
    var result = readFontsFromAPI();
    var fontMap = result.map;
    var rawFontCount = result.count;

    if (rawFontCount > 0) {
      method = "allFonts";
      debugInfo += "allFonts:" + rawFontCount + "; ";
    }

    // Fallback: use comprehensive default list
    if (rawFontCount === 0) {
      method = "fallback_list";
      debugInfo += "using_fallback; ";
      fontMap = getDefaultFontMap();
      rawFontCount = 0;
    }

    // Build sorted array
    var fonts = buildSortedFontsArray(fontMap);

    // Update in-memory cache
    _fontCache = { fonts: fonts, rawCount: rawFontCount };
    _fontCacheTime = now;

    // Write full data to file for panel JS to read
    var filePath = writeFontsToFile(fonts);

    return successResponse({
      count: fonts.length,
      rawFontCount: rawFontCount,
      method: method,
      cached: false,
      filePath: filePath,
      debug: debugInfo
    });

  } catch (e) {
    return errorResponse("Font enumeration failed: " + e.toString());
  }
}

/**
 * Force refresh the font cache.
 * Call when user installs new fonts or fonts seem stale.
 */
function refreshFontCache() {
  _fontCache = null;
  _fontCacheTime = 0;
  return getSystemFonts(true);
}

/**
 * Get comprehensive default font map
 * This list covers fonts commonly available on macOS and Windows
 */
function getDefaultFontMap() {
  var fontMap = {};

  var defaultFonts = [
    { family: "Arial", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "Arial Black", styles: ["Regular"] },
    { family: "Arial Narrow", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "Avenir", styles: ["Book", "Roman", "Light", "Medium", "Heavy", "Black"] },
    { family: "Avenir Next", styles: ["Ultra Light", "Regular", "Medium", "Demi Bold", "Bold", "Heavy"] },
    { family: "Avenir Next Condensed", styles: ["Ultra Light", "Regular", "Medium", "Demi Bold", "Bold", "Heavy"] },
    { family: "Baskerville", styles: ["Regular", "Italic", "SemiBold", "SemiBold Italic", "Bold", "Bold Italic"] },
    { family: "Bodoni 72", styles: ["Book", "Book Italic", "Bold"] },
    { family: "Cambria", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "Century Gothic", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "Cochin", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "Comic Sans MS", styles: ["Regular", "Bold"] },
    { family: "Copperplate", styles: ["Light", "Regular", "Bold"] },
    { family: "Courier", styles: ["Regular", "Bold", "Oblique", "Bold Oblique"] },
    { family: "Courier New", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "DIN Alternate", styles: ["Bold"] },
    { family: "DIN Condensed", styles: ["Bold"] },
    { family: "Didot", styles: ["Regular", "Bold", "Italic"] },
    { family: "Futura", styles: ["Medium", "Medium Italic", "Bold", "Condensed Medium", "Condensed ExtraBold"] },
    { family: "Georgia", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "Gill Sans", styles: ["Light", "Light Italic", "Regular", "Italic", "SemiBold", "SemiBold Italic", "Bold", "Bold Italic", "UltraBold"] },
    { family: "Helvetica", styles: ["Light", "Light Oblique", "Regular", "Oblique", "Bold", "Bold Oblique"] },
    { family: "Helvetica Neue", styles: ["Thin", "Thin Italic", "UltraLight", "UltraLight Italic", "Light", "Light Italic", "Regular", "Italic", "Medium", "Medium Italic", "Bold", "Bold Italic", "Condensed Bold", "Condensed Black"] },
    { family: "Hoefler Text", styles: ["Regular", "Italic", "Black", "Black Italic"] },
    { family: "Impact", styles: ["Regular"] },
    { family: "Inter", styles: ["Thin", "Extra Light", "Light", "Regular", "Medium", "Semi Bold", "Bold", "Extra Bold", "Black"] },
    { family: "Lato", styles: ["Hairline", "Thin", "Light", "Regular", "Medium", "Semibold", "Bold", "Heavy", "Black"] },
    { family: "Lucida Grande", styles: ["Regular", "Bold"] },
    { family: "Menlo", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "Monaco", styles: ["Regular"] },
    { family: "Montserrat", styles: ["Thin", "Extra Light", "Light", "Regular", "Medium", "Semi Bold", "Bold", "Extra Bold", "Black"] },
    { family: "Myriad Pro", styles: ["Light", "Regular", "Italic", "Semibold", "Semibold Italic", "Bold", "Bold Italic", "Condensed", "Bold Condensed"] },
    { family: "Open Sans", styles: ["Light", "Light Italic", "Regular", "Italic", "SemiBold", "SemiBold Italic", "Bold", "Bold Italic", "ExtraBold", "ExtraBold Italic"] },
    { family: "Optima", styles: ["Regular", "Italic", "Bold", "Bold Italic", "ExtraBlack"] },
    { family: "Oswald", styles: ["Extra Light", "Light", "Regular", "Medium", "SemiBold", "Bold"] },
    { family: "Palatino", styles: ["Roman", "Italic", "Bold", "Bold Italic"] },
    { family: "Playfair Display", styles: ["Regular", "Italic", "Medium", "Medium Italic", "SemiBold", "SemiBold Italic", "Bold", "Bold Italic", "ExtraBold", "ExtraBold Italic", "Black", "Black Italic"] },
    { family: "Poppins", styles: ["Thin", "Extra Light", "Light", "Regular", "Medium", "Semi Bold", "Bold", "Extra Bold", "Black"] },
    { family: "Proxima Nova", styles: ["Thin", "Light", "Regular", "Medium", "Semibold", "Bold", "Extrabold", "Black"] },
    { family: "Raleway", styles: ["Thin", "Extra Light", "Light", "Regular", "Medium", "Semi Bold", "Bold", "Extra Bold", "Black"] },
    { family: "Roboto", styles: ["Thin", "Thin Italic", "Light", "Light Italic", "Regular", "Italic", "Medium", "Medium Italic", "Bold", "Bold Italic", "Black", "Black Italic"] },
    { family: "Roboto Condensed", styles: ["Light", "Light Italic", "Regular", "Italic", "Bold", "Bold Italic"] },
    { family: "Rockwell", styles: ["Regular", "Italic", "Bold", "Bold Italic"] },
    { family: "SF Pro", styles: ["Ultralight", "Thin", "Light", "Regular", "Medium", "Semibold", "Bold", "Heavy", "Black"] },
    { family: "SF Pro Display", styles: ["Ultralight", "Thin", "Light", "Regular", "Medium", "Semibold", "Bold", "Heavy", "Black"] },
    { family: "SF Pro Rounded", styles: ["Ultralight", "Thin", "Light", "Regular", "Medium", "Semibold", "Bold", "Heavy", "Black"] },
    { family: "SF Pro Text", styles: ["Light", "Regular", "Medium", "Semibold", "Bold", "Heavy"] },
    { family: "Source Sans Pro", styles: ["ExtraLight", "Light", "Regular", "Semibold", "Bold", "Black"] },
    { family: "Tahoma", styles: ["Regular", "Bold"] },
    { family: "Times New Roman", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "Trebuchet MS", styles: ["Regular", "Bold", "Italic", "Bold Italic"] },
    { family: "Verdana", styles: ["Regular", "Bold", "Italic", "Bold Italic"] }
  ];

  for (var i = 0; i < defaultFonts.length; i++) {
    var df = defaultFonts[i];
    var styles = [];
    for (var j = 0; j < df.styles.length; j++) {
      var styleName = df.styles[j];
      styles.push({
        style: styleName,
        postScriptName: df.family.replace(/ /g, "") + "-" + styleName.replace(/ /g, "")
      });
    }
    fontMap[df.family] = { family: df.family, styles: styles };
  }

  return fontMap;
}

/**
 * Get styles for a specific font family.
 * Uses in-memory cache if available, otherwise queries app.fonts.allFonts.
 */
function getFontStyles(fontFamily) {
  try {
    // Try cache first
    if (_fontCache && _fontCache.fonts) {
      for (var i = 0; i < _fontCache.fonts.length; i++) {
        if (_fontCache.fonts[i].family === fontFamily) {
          return successResponse({
            family: fontFamily,
            styles: _fontCache.fonts[i].styles,
            fromCache: true
          });
        }
      }
    }

    // Query directly from app.fonts.allFonts
    var styles = [];
    var seenStyles = {};

    try {
      var allFonts = app.fonts.allFonts;
      if (allFonts) {
        for (var g = 0; g < allFonts.length; g++) {
          var group = allFonts[g];
          if (!group || group.length === 0) continue;
          // Check first font in group to see if family matches
          if (group[0].familyName !== fontFamily) continue;
          for (var f = 0; f < group.length; f++) {
            try {
              var font = group[f];
              if (font.isSubstitute) continue;
              var styleKey = (font.styleName || "Regular") + "|" + (font.postScriptName || "");
              if (!seenStyles[styleKey]) {
                seenStyles[styleKey] = true;
                styles.push({
                  style: font.styleName || "Regular",
                  postScriptName: font.postScriptName || fontFamily
                });
              }
            } catch (e) { }
          }
          break; // Found the family group, no need to continue
        }
      }
    } catch (e) { }

    styles = sortFontStyles(styles);

    return successResponse({
      family: fontFamily,
      styles: styles,
      fromCache: false
    });
  } catch (e) {
    return errorResponse("Failed to get font styles: " + e.toString());
  }
}

// ============================================
// MCP BRIDGE - OPTIMIZED COMMAND PROCESSING
// ============================================

var MCP_COMMANDS_FOLDER_NAME = "ae-mcp-commands";
var mcpCommandsFolder = null;
var mcpProcessedCommands = {};

/**
 * Check if the MCP server heartbeat file is fresh.
 * Uses ExtendScript File I/O (same proven path as command processing).
 * Returns JSON: { alive: true/false, age: ms }
 */
function checkServerHeartbeat() {
  try {
    var heartbeatFile = new File(Folder.userData.fsName + "/MotionAmigo Engine/ae-mcp-commands/.server-heartbeat");
    if (!heartbeatFile.exists) return '{"alive":false,"reason":"no_file"}';

    heartbeatFile.open("r");
    var content = heartbeatFile.read();
    heartbeatFile.close();

    if (!content) return '{"alive":false,"reason":"empty"}';

    var data = JSON.parse(content);
    var now = new Date().getTime();
    var age = now - data.timestamp;

    return '{"alive":' + (age < 15000) + ',"age":' + age + '}';
  } catch (e) {
    return '{"alive":false,"reason":"' + e.toString().replace(/"/g, '\\"') + '"}';
  }
}

function initializeMCPBridge() {
  try {
    var appSupportFolder = Folder.userData;
    var parentFolder = new Folder(appSupportFolder.fsName + "/MotionAmigo Engine");
    if (!parentFolder.exists) parentFolder.create();
    
    mcpCommandsFolder = new Folder(parentFolder.fsName + "/" + MCP_COMMANDS_FOLDER_NAME);
    if (!mcpCommandsFolder.exists) mcpCommandsFolder.create();
    
    mcpProcessedCommands = {};
    return "success";
  } catch (e) {
    return "Error: " + e.toString();
  }
}

/**
 * OPTIMIZED MCP Command Processor
 * - Processes ALL pending commands in one call
 * - Single undo group for batch
 * - No blocking $.sleep()
 */
function processMCPCommand(debugMode, aeInstanceTag) {
  aeInstanceTag = __sanitizeAeInstanceTag(aeInstanceTag);
  var result = {
    success: true,
    processed: 0,
    errors: 0,
    commands: []
  };

  try {
    if (!mcpCommandsFolder || !mcpCommandsFolder.exists) {
      initializeMCPBridge();
    }

    // Get all command files in one pass
    var allFiles = mcpCommandsFolder.getFiles("*.json");
    var files = [];
    var numFiles = allFiles.length;

    for (var i = 0; i < numFiles; i++) {
      var fileName = allFiles[i].name;
      if (fileName.indexOf(".response") === -1 &&
          fileName.indexOf(".processed") === -1 &&
          !mcpProcessedCommands[fileName]) {
        // Multi-instance routing: only process commands tagged for this AE instance.
        // Command files containing an aeInstanceTag segment (e.g., "_ae25_" or "_ae26_")
        // are routed to the matching AE panel. Un-tagged files are processed by all instances
        // for backward compatibility.
        if (aeInstanceTag && typeof aeInstanceTag === "string" && aeInstanceTag.length > 0) {
          var tagMarker = "_" + aeInstanceTag + "_";
          var hasAnyTag = fileName.match(/_ae\d+_/);
          if (hasAnyTag && fileName.indexOf(tagMarker) === -1) {
            // This command is tagged for a DIFFERENT AE instance — skip it
            continue;
          }
        }
        files.push(allFiles[i]);
      }
    }
    
    // Check for panel update command (UI updates, not AE commands)
    var panelUpdateFileName = "panel_update.json";
    if (aeInstanceTag && typeof aeInstanceTag === "string" && aeInstanceTag.length > 0) {
      panelUpdateFileName = "panel_update_" + aeInstanceTag + ".json";
    }
    var panelUpdateFile = new File(Folder.userData.fsName + "/MotionAmigo/" + panelUpdateFileName);
    if (!panelUpdateFile.exists && panelUpdateFileName !== "panel_update.json") {
      panelUpdateFile = new File(Folder.userData.fsName + "/MotionAmigo/panel_update.json");
    }
    if (panelUpdateFile.exists) {
      try {
        panelUpdateFile.open("r");
        var panelUpdateContent = panelUpdateFile.read();
        panelUpdateFile.close();
        panelUpdateFile.remove();
        result.panelUpdate = safeParse(panelUpdateContent);
        // DEBUG: alert("Panel update found: " + panelUpdateContent);
      } catch (e) { /* ignore */ }
    }

    var numCommands = files.length;
    if (numCommands === 0) {
      return safeStringify(result);
    }

    // FAIL-SAFE: Detect and recover from orphaned undo groups.
    //
    // The coordination flag $.global.__motionamigo_undoGroupOpen can become stuck
    // in the true state if a script crashes before its finally block runs.
    //
    // However, the flag is LEGITIMATELY true when the AI has called begin_undo_group
    // explicitly and end_undo_group hasn't arrived yet (multi-command workflow spanning
    // multiple polling cycles). Closing the group here would destroy the explicit undo
    // group, and the subsequent end_undo_group command would call app.endUndoGroup()
    // with no matching open group → "Undo group mismatch, will attempt to fix."
    //
    // Solution: A companion flag $.global.__motionamigo_explicitUndoGroup distinguishes
    // explicit begin_undo_group calls (which persist across commands by design) from
    // auto-wrapped undo groups (which always clean up in their finally blocks).
    // Only recover when the flag is NOT from an explicit group.
    if ($.global.__motionamigo_undoGroupOpen && !$.global.__motionamigo_explicitUndoGroup) {
      try {
        app.endUndoGroup();
      } catch (e) {
        // Ignore — no undo group was actually open
      }
      $.global.__motionamigo_undoGroupOpen = false;
    }

    // ARCHITECTURE NOTE: No batch undo group here.
    // Each MCP-generated script manages its own undo group via wrapScript() in
    // scriptGenerator.ts, which conditionally wraps modifying operations using
    // the $.global.__motionamigo_undoGroupOpen flag. Adding a batch undo group
    // here would create nested beginUndoGroup() calls — AE does not support
    // nesting and responds with "Undo group mismatch, will attempt to fix".
    //
    // For multi-tool workflows, the AI client calls begin_undo_group / end_undo_group
    // explicitly, which sets the flag so individual tool scripts skip their own wrapping.

    for (var i = 0; i < numCommands; i++) {
      var file = files[i];

      try {
        var commandStartTime = new Date().getTime();

        // Read command
        file.open("r");
        var content = file.read();
        file.close();

        var commandData = safeParse(content);
        if (!commandData) {
          result.errors++;
          continue;
        }

        var commandId = commandData.id;
        var script = commandData.script;

        try {
          var commandResult = eval(script);

          // Write response
          var responseFile = new File(file.fsName + ".response");
          responseFile.encoding = "UTF-8";
          responseFile.open("w");
          responseFile.write(safeStringify({
            id: commandId,
            result: commandResult && typeof commandResult === "object" && commandResult.hasOwnProperty("success")
              ? commandResult
              : { success: true, data: commandResult }
          }));
          responseFile.close();

          result.processed++;

          if (debugMode) {
            result.commands.push({
              file: file.name,
              executionTime: new Date().getTime() - commandStartTime
            });
          } else {
            result.commands.push(file.name);
          }

          mcpProcessedCommands[file.name] = true;
          archiveMCPCommand(file);

        } catch (execError) {
          // Write error response
          var errorFile = new File(file.fsName + ".response");
          errorFile.encoding = "UTF-8";
          errorFile.open("w");
          errorFile.write(safeStringify({
            id: commandId,
            result: { success: false, error: execError.toString() }
          }));
          errorFile.close();

          result.errors++;
          mcpProcessedCommands[file.name] = true;
          archiveMCPCommand(file);
        }

      } catch (fileError) {
        result.errors++;
      }
    }
    
  } catch (e) {
    result.success = false;
    result.error = e.toString();
  }
  
  return safeStringify(result);
}

/**
 * COMBINED command processor + history fetcher
 * Reduces evalScript calls from 2 to 1 per poll cycle
 */
function processMCPCommandWithHistory(aeInstanceTag) {
  var commandResult = safeParse(processMCPCommand(false, aeInstanceTag)) || { processed: 0, errors: 0 };
  var history = [];
  var runningFlag = false;

  try {
    var historyFile = new File(Folder.userData.fsName + "/MotionAmigo/mcp_history.json");
    if (historyFile.exists) {
      historyFile.open("r");
      var content = historyFile.read();
      historyFile.close();
      var data = safeParse(content);
      if (data) {
        history = data.actions || [];
        runningFlag = data.running === true;
      }
    }
  } catch (e) { /* ignore */ }

  commandResult.history = history;
  commandResult.running = runningFlag;
  return safeStringify(commandResult);
}

function archiveMCPCommand(file) {
  try {
    file.rename(file.name + ".processed");
  } catch (e) {
    try { file.remove(); } catch (e2) { /* ignore */ }
  }
}

function openCommandsFolder() {
  try {
    if (!mcpCommandsFolder || !mcpCommandsFolder.exists) {
      initializeMCPBridge();
    }
    
    if ($.os.indexOf("Windows") !== -1) {
      system.callSystem('explorer "' + mcpCommandsFolder.fsName + '"');
    } else {
      system.callSystem('open "' + mcpCommandsFolder.fsName + '"');
    }
    return "success";
  } catch (e) {
    return "Error: " + e.toString();
  }
}

// ============================================
// CONNECTION STATUS - Batched check
// ============================================

/**
 * Combined connection + project check
 * Reduces evalScript calls from 2 to 1
 */
function getConnectionStatus() {
  var projectId = "untitled";
  try {
    if (app.project.file) {
      projectId = app.project.file.fsName;
    } else {
      projectId = "untitled_" + app.project.numItems;
    }
  } catch (e) { /* ignore */ }
  
  return safeStringify({
    connected: typeof app !== "undefined" && app.project !== null,
    projectId: projectId
  });
}

// ============================================
// MCP HISTORY
// ============================================

function getMCPHistory() {
  try {
    var historyFile = new File(Folder.userData.fsName + "/MotionAmigo/mcp_history.json");
    if (historyFile.exists) {
      historyFile.open("r");
      var content = historyFile.read();
      historyFile.close();
      var data = safeParse(content);
      if (data) {
        // Return both actions and the running flag for reliable completion detection
        return safeStringify({ actions: data.actions || [], running: data.running === true });
      }
      return '{"actions":[],"running":false}';
    }
    return '{"actions":[],"running":false}';
  } catch (e) {
    return '{"actions":[],"running":false}';
  }
}

/**
 * Write a question answer file for the MCP server to pick up.
 * Called from panel JS when user responds to a question from Claude.
 * @param {string} answerJson - JSON string with { questionId, answer, skipped?, answeredAt }
 */
function writeQuestionAnswer(answerJson) {
  try {
    var answerFolder = new Folder(Folder.userData.fsName + "/MotionAmigo");
    if (!answerFolder.exists) {
      answerFolder.create();
    }
    var answerFile = new File(answerFolder.fsName + "/question_answer.json");
    answerFile.encoding = "UTF-8";
    answerFile.open("w");
    answerFile.write(answerJson);
    answerFile.close();
    return successResponse({ written: true });
  } catch (e) {
    return errorResponse("Failed to write question answer: " + e.toString());
  }
}

function clearMCPHistory() {
  try {
    var historyFile = new File(Folder.userData.fsName + "/MotionAmigo/mcp_history.json");
    if (historyFile.exists) {
      historyFile.open("w");
      historyFile.write('{"actions":[],"running":false}');
      historyFile.close();
    }
    return successResponse({});
  } catch (e) {
    return errorResponse(e.toString());
  }
}

function clearAllPresets() {
  try {
    var presetsFolder = new Folder(Folder.userData.fsName + "/MotionAmigo Engine/presets");
    if (presetsFolder.exists) {
      // Delete all contents recursively
      var files = presetsFolder.getFiles();
      for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof Folder) {
          // Delete subfolder contents first
          var subFiles = files[i].getFiles();
          for (var j = 0; j < subFiles.length; j++) {
            if (subFiles[j] instanceof Folder) {
              var innerFiles = subFiles[j].getFiles();
              for (var k = 0; k < innerFiles.length; k++) {
                innerFiles[k].remove();
              }
              subFiles[j].remove();
            } else {
              subFiles[j].remove();
            }
          }
          files[i].remove();
        } else {
          files[i].remove();
        }
      }
    }
    return successResponse({ message: "All presets cleared" });
  } catch (e) {
    return errorResponse(e.toString());
  }
}

function undoToPoint(index) {
  try {
    var historyFile = new File(Folder.userData.fsName + "/MotionAmigo/mcp_history.json");
    if (!historyFile.exists) return errorResponse("No history file");
    
    historyFile.open("r");
    var content = historyFile.read();
    historyFile.close();
    
    var data = safeParse(content);
    if (!data) return errorResponse("Invalid history data");
    
    var actions = data.actions || [];
    var actionsToUndo = actions.length - index;
    
    if (actionsToUndo <= 0) return errorResponse("Invalid index");
    
    for (var i = 0; i < actionsToUndo; i++) {
      app.executeCommand(16); // Edit > Undo
    }
    
    // Truncate history
    data.actions = actions.slice(0, index);
    historyFile.open("w");
    historyFile.write(safeStringify(data));
    historyFile.close();
    
    return successResponse({ undoneCount: actionsToUndo, remainingActions: index });
  } catch (e) {
    return errorResponse(e.toString());
  }
}

// ============================================
// PREFERENCES
// ============================================

function savePanelPreferences(prefsJSON, aeInstanceTag) {
  aeInstanceTag = __sanitizeAeInstanceTag(aeInstanceTag);
  try {
    var prefsFolder = new Folder(Folder.userData.fsName + "/MotionAmigo");
    if (!prefsFolder.exists) prefsFolder.create();

    // Write to instance-tagged prefs file (e.g., panel_prefs_ae25.json).
    // Each AE version gets its own prefs file to avoid race conditions
    // when multiple AE instances run simultaneously.
    var prefsFileName = "panel_prefs.json";
    if (aeInstanceTag && typeof aeInstanceTag === "string" && aeInstanceTag.length > 0) {
      prefsFileName = "panel_prefs_" + aeInstanceTag + ".json";
    }
    var prefsFile = new File(prefsFolder.fsName + "/" + prefsFileName);
    prefsFile.encoding = "UTF-8";
    prefsFile.open("w");
    prefsFile.write(prefsJSON);
    prefsFile.close();

    // Also refresh the shared panel_prefs.json as a fallback for MCP
    // server startup before it knows the instance tag, and so a newly
    // opened panel on a different AE version can inherit the most recent
    // setup when its own tagged file doesn't exist yet (loadPanelPreferences
    // falls back to the shared file).
    //
    // Only refresh periodically: every debounced save would otherwise
    // double the per-save I/O (and for large prefs, double the CEP IPC
    // string cost), which contributes to typing lag during rapid edits.
    // A 5s throttle keeps inheritance snappy enough — a new panel opened
    // seconds after the last save still inherits — while collapsing
    // bursts of saves into a single shared write.
    if (prefsFileName !== "panel_prefs.json") {
      var nowMs = new Date().getTime();
      var lastMs = $.global.__mogoSharedPrefsWrittenAt || 0;
      var lastTag = $.global.__mogoSharedPrefsWrittenTag || "";
      var SHARED_WRITE_THROTTLE_MS = 5000;
      if (lastTag !== aeInstanceTag || (nowMs - lastMs) > SHARED_WRITE_THROTTLE_MS) {
        var sharedFile = new File(prefsFolder.fsName + "/panel_prefs.json");
        sharedFile.encoding = "UTF-8";
        sharedFile.open("w");
        sharedFile.write(prefsJSON);
        sharedFile.close();
        $.global.__mogoSharedPrefsWrittenAt = nowMs;
        $.global.__mogoSharedPrefsWrittenTag = aeInstanceTag;
      }
    }

    return successResponse({});
  } catch (e) {
    return errorResponse(e.toString());
  }
}

function loadPanelPreferences(aeInstanceTag) {
  aeInstanceTag = __sanitizeAeInstanceTag(aeInstanceTag);
  try {
    // Prefer tagged prefs file; fall back to shared file.
    var prefsFileName = "panel_prefs.json";
    if (aeInstanceTag && typeof aeInstanceTag === "string" && aeInstanceTag.length > 0) {
      prefsFileName = "panel_prefs_" + aeInstanceTag + ".json";
    }
    var prefsFile = new File(Folder.userData.fsName + "/MotionAmigo/" + prefsFileName);
    if (!prefsFile.exists && prefsFileName !== "panel_prefs.json") {
      // Tagged file doesn't exist yet — fall back to shared file
      prefsFile = new File(Folder.userData.fsName + "/MotionAmigo/panel_prefs.json");
    }
    if (prefsFile.exists) {
      prefsFile.open("r");
      var content = prefsFile.read();
      prefsFile.close();
      return content;
    }
    return "{}";
  } catch (e) {
    return "{}";
  }
}

// Check for panel update commands from MCP
function checkPanelUpdateCommand(aeInstanceTag) {
  aeInstanceTag = __sanitizeAeInstanceTag(aeInstanceTag);
  try {
    var updateFileName = "panel_update.json";
    if (aeInstanceTag && typeof aeInstanceTag === "string" && aeInstanceTag.length > 0) {
      updateFileName = "panel_update_" + aeInstanceTag + ".json";
    }
    var updateFile = new File(Folder.userData.fsName + "/MotionAmigo/" + updateFileName);
    if (!updateFile.exists && updateFileName !== "panel_update.json") {
      updateFile = new File(Folder.userData.fsName + "/MotionAmigo/panel_update.json");
    }
    if (updateFile.exists) {
      updateFile.open("r");
      var content = updateFile.read();
      updateFile.close();

      // Delete the file after reading (one-time command)
      updateFile.remove();

      return content;
    }
    return "none";
  } catch (e) {
    return "none";
  }
}

// ============================================================================
// FILE MANAGEMENT — Working Files & Presets
// ============================================================================

/**
 * Copy a file to the working_files directory for a given component instance.
 * Returns the destination file path on success, or empty string on failure.
 */
function copyFileToWorkingDir(sourcePath, instanceId, fileName) {
  try {
    var destFolder = new Folder(Folder.userData.fsName + "/MotionAmigo/working_files/" + instanceId);
    if (!destFolder.exists) destFolder.create();
    var sourceFile = new File(sourcePath);
    if (!sourceFile.exists) return "";
    var destFile = new File(destFolder.fsName + "/" + fileName);
    sourceFile.copy(destFile);
    return destFile.fsName;
  } catch (e) {
    return "";
  }
}

/**
 * Start a working session — create working_files dir and session lock.
 */
function startWorkingSession() {
  try {
    var workDir = new Folder(Folder.userData.fsName + "/MotionAmigo/working_files");
    if (!workDir.exists) workDir.create();
    var lockFile = new File(workDir.fsName + "/.session_lock");
    lockFile.open("w");
    lockFile.write(new Date().toISOString());
    lockFile.close();
    return workDir.fsName;
  } catch (e) {
    return "";
  }
}

/**
 * Recursively delete a directory and all its contents.
 */
function deleteDirectoryRecursive(folder) {
  if (!folder.exists) return;
  var files = folder.getFiles();
  for (var i = 0; i < files.length; i++) {
    if (files[i] instanceof Folder) {
      deleteDirectoryRecursive(files[i]);
    } else {
      files[i].remove();
    }
  }
  folder.remove();
}

/**
 * End working session — delete the working_files directory.
 */
function cleanupWorkingFiles() {
  try {
    var workDir = new Folder(Folder.userData.fsName + "/MotionAmigo/working_files");
    if (workDir.exists) {
      deleteDirectoryRecursive(workDir);
    }
    return "cleaned";
  } catch (e) {
    return "error: " + e.toString();
  }
}

/**
 * Save a preset to the filesystem.
 * Creates presets/{presetId}/ directory structure under the engine folder.
 */
function savePresetToFilesystem(presetId, prefsJSON) {
  try {
    var presetsDir = new Folder(Folder.userData.fsName + "/MotionAmigo Engine/presets/" + presetId);
    if (!presetsDir.exists) presetsDir.create();
    var filesDir = new Folder(presetsDir.fsName + "/files");
    if (!filesDir.exists) filesDir.create();

    // Parse prefs to copy referenced files
    var prefs = safeParse(prefsJSON);
    if (prefs && prefs.componentData) {
      for (var key in prefs.componentData) {
        if (!prefs.componentData.hasOwnProperty(key)) continue;
        var compData = prefs.componentData[key];
        if (!compData) continue;

        // Copy image-instruction files
        if (compData.images && compData.images.length) {
          for (var i = 0; i < compData.images.length; i++) {
            var img = compData.images[i];
            if (img.filePath) {
              var srcFile = new File(img.filePath);
              if (srcFile.exists) {
                // Use displayName (actual filesystem name) instead of .name
                // which can URI-encode/decode and mangle filenames with
                // spaces or parentheses across save cycles.
                var safeName = srcFile.displayName || srcFile.fsName.replace(/^.*[\/\\]/, '');
                var destFile = new File(filesDir.fsName + "/" + safeName);
                srcFile.copy(destFile);
                img.filePath = destFile.fsName;
              }
            }
            // Strip base64 content to keep preset lean
            if (img.content && img.content.indexOf("data:") === 0) {
              delete img.content;
            }
          }
        }

        // Copy code-references files
        if (compData.files && compData.files.length) {
          for (var j = 0; j < compData.files.length; j++) {
            var codeFile = compData.files[j];
            if (codeFile.filePath) {
              var srcCode = new File(codeFile.filePath);
              if (srcCode.exists) {
                var safeCodeName = srcCode.displayName || srcCode.fsName.replace(/^.*[\/\\]/, '');
                var destCode = new File(filesDir.fsName + "/" + safeCodeName);
                srcCode.copy(destCode);
                codeFile.filePath = destCode.fsName;
              }
            }
          }
        }
      }
    }

    // Write preset.json
    var presetFile = new File(presetsDir.fsName + "/preset.json");
    presetFile.encoding = "UTF-8";
    presetFile.open("w");
    presetFile.write(JSON.stringify(prefs));
    presetFile.close();

    return presetsDir.fsName;
  } catch (e) {
    return "error: " + e.toString();
  }
}

/**
 * Load a preset from the filesystem.
 * Returns the preset JSON string or empty string if not found.
 */
function loadPresetFromFilesystem(presetId) {
  try {
    var presetFile = new File(Folder.userData.fsName + "/MotionAmigo Engine/presets/" + presetId + "/preset.json");
    if (!presetFile.exists) return "";
    presetFile.encoding = "UTF-8";
    presetFile.open("r");
    var content = presetFile.read();
    presetFile.close();
    return content;
  } catch (e) {
    return "";
  }
}

/**
 * Delete a preset from the filesystem — removes the entire preset directory.
 */
function deletePresetFromFilesystem(presetId) {
  try {
    var presetDir = new Folder(Folder.userData.fsName + "/MotionAmigo Engine/presets/" + presetId);
    if (presetDir.exists) {
      deleteDirectoryRecursive(presetDir);
    }
    return "deleted";
  } catch (e) {
    return "error: " + e.toString();
  }
}

/**
 * Rename a preset by updating the _preset.name in its preset.json.
 * Returns "renamed" on success or "error: ..." on failure.
 */
function renamePresetOnFilesystem(presetId, newName) {
  try {
    var presetFile = new File(Folder.userData.fsName + "/MotionAmigo Engine/presets/" + presetId + "/preset.json");
    if (!presetFile.exists) return "error: preset not found";

    presetFile.encoding = "UTF-8";
    presetFile.open("r");
    var content = presetFile.read();
    presetFile.close();

    var prefs = safeParse(content);
    if (!prefs) return "error: invalid preset JSON";
    if (!prefs._preset) prefs._preset = {};
    prefs._preset.name = newName;

    presetFile.open("w");
    presetFile.write(JSON.stringify(prefs));
    presetFile.close();

    return "renamed";
  } catch (e) {
    return "error: " + e.toString();
  }
}

/**
 * List all presets from the filesystem.
 * Returns a JSON string array of preset metadata objects.
 */
function listPresetsFromFilesystem() {
  try {
    var presetsDir = new Folder(Folder.userData.fsName + "/MotionAmigo Engine/presets");
    if (!presetsDir.exists) {
      presetsDir.create();
      return "[]";
    }

    var folders = presetsDir.getFiles(function(f) { return f instanceof Folder; });
    var presets = [];
    for (var i = 0; i < folders.length; i++) {
      var presetFile = new File(folders[i].fsName + "/preset.json");
      if (!presetFile.exists) continue;
      presetFile.encoding = "UTF-8";
      presetFile.open("r");
      var content = presetFile.read();
      presetFile.close();
      try {
        var prefs = safeParse(content);
        if (!prefs) continue;
        var meta = prefs._preset || {};
        var componentCount = prefs.activeComponents ? prefs.activeComponents.length : 0;
        presets.push({
          id: meta.id || folders[i].name,
          name: meta.name || folders[i].name,
          description: meta.description || "",
          category: meta.category || "",
          createdAt: meta.createdAt || "",
          components: componentCount
        });
      } catch (parseErr) {
        // Skip invalid preset files
      }
    }

    return JSON.stringify(presets);
  } catch (e) {
    return "[]";
  }
}

/**
 * Seed presets shipped in the extension (panel/presets/) into the user's
 * presets folder on first run. A marker file (presets/.bundled-seeded.json)
 * records which IDs have been seeded so deletions stick across launches.
 * Returns JSON {seeded:[...], skipped:[...]}.
 */
function seedBundledPresets(extDirPath) {
  try {
    // extDirPath comes from the panel's csInterface.getSystemPath('extension');
    // we don't read $.fileName here because evalScript() runs in a context
    // where $.fileName resolves to the eval string, not the hostscript file.
    if (typeof extDirPath !== "string" || !extDirPath) {
      return JSON.stringify({ seeded: [], skipped: [], error: "extDirPath missing" });
    }
    var bundledDir = new Folder(extDirPath + "/presets");
    if (!bundledDir.exists) {
      return JSON.stringify({ seeded: [], skipped: [], note: "no bundled presets dir" });
    }

    var userPresetsDir = new Folder(Folder.userData.fsName + "/MotionAmigo Engine/presets");
    if (!userPresetsDir.exists) userPresetsDir.create();

    var markerFile = new File(userPresetsDir.fsName + "/.bundled-seeded.json");
    var marker = {};
    if (markerFile.exists) {
      markerFile.encoding = "UTF-8";
      markerFile.open("r");
      var raw = markerFile.read();
      markerFile.close();
      var parsed = safeParse(raw);
      if (parsed && typeof parsed === "object") marker = parsed;
    }

    var seeded = [];
    var skipped = [];
    var failed = [];
    var folders = bundledDir.getFiles(function(f) { return f instanceof Folder; });
    for (var i = 0; i < folders.length; i++) {
      var folder = folders[i];
      var presetId = folder.name;
      if (marker[presetId]) { skipped.push(presetId); continue; }

      var srcFile = new File(folder.fsName + "/preset.json");
      if (!srcFile.exists) { skipped.push(presetId); continue; }

      var destDir = new Folder(userPresetsDir.fsName + "/" + presetId);
      if (!destDir.exists) destDir.create();
      var destFile = new File(destDir.fsName + "/preset.json");

      // Respect a user-customized preset that already lives at this id —
      // don't clobber it. Mark seeded so we stop re-checking on every launch.
      if (destFile.exists) {
        marker[presetId] = "v1";
        skipped.push(presetId);
        continue;
      }

      // File.copy returns false on failure (perms, disk full, etc.). Only
      // record seeded when the copy actually landed; otherwise leave the
      // marker untouched so the next launch retries.
      if (srcFile.copy(destFile)) {
        marker[presetId] = "v1";
        seeded.push(presetId);
      } else {
        failed.push(presetId);
      }
    }

    markerFile.encoding = "UTF-8";
    markerFile.open("w");
    markerFile.write(JSON.stringify(marker));
    markerFile.close();

    return JSON.stringify({ seeded: seeded, skipped: skipped, failed: failed });
  } catch (e) {
    return JSON.stringify({ seeded: [], skipped: [], failed: [], error: e.toString() });
  }
}

/**
 * Import a preset from an external JSON file path.
 * Copies the file into the presets directory structure.
 * Returns JSON string with {id, name} on success, or "error: ..." on failure.
 */
function importPresetFromFile(filePath) {
  try {
    var srcFile = new File(filePath);
    if (!srcFile.exists) return "error: File not found";

    srcFile.encoding = "UTF-8";
    srcFile.open("r");
    var content = srcFile.read();
    srcFile.close();

    if (!content) return "error: File is empty";

    var prefs;
    try {
      // ExtendScript ES3 — standard JSON parse pattern (no native JSON.parse)
      prefs = eval("(" + content + ")");
    } catch (parseErr) {
      return "error: Invalid JSON - " + parseErr.toString();
    }

    // Validate basic structure
    if (!prefs.activeComponents || !prefs.componentData) {
      return "error: Not a valid preset file (missing activeComponents or componentData)";
    }

    // Determine preset ID and name
    var meta = prefs._preset || {};
    var presetName = meta.name || srcFile.name.replace(/\.json$/i, "");
    var presetId = meta.id || presetName.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!presetId) presetId = "imported-preset";

    // Avoid overwriting — append counter if ID already exists
    var baseId = presetId;
    var counter = 1;
    var presetsRoot = new Folder(Folder.userData.fsName + "/MotionAmigo Engine/presets");
    if (!presetsRoot.exists) presetsRoot.create();
    while (new Folder(presetsRoot.fsName + "/" + presetId).exists) {
      counter++;
      presetId = baseId + "-" + counter;
    }

    // Update preset metadata
    if (!prefs._preset) prefs._preset = {};
    prefs._preset.id = presetId;
    prefs._preset.name = presetName;
    if (!prefs._preset.createdAt) prefs._preset.createdAt = new Date().toISOString();

    // Create preset directory
    var presetDir = new Folder(presetsRoot.fsName + "/" + presetId);
    presetDir.create();
    var filesDir = new Folder(presetDir.fsName + "/files");
    filesDir.create();

    // Copy any referenced files that exist next to the source file
    var srcDir = srcFile.parent;
    if (prefs.componentData) {
      for (var key in prefs.componentData) {
        if (!prefs.componentData.hasOwnProperty(key)) continue;
        var compData = prefs.componentData[key];
        if (!compData) continue;

        // Copy image files
        if (compData.images && compData.images.length) {
          for (var i = 0; i < compData.images.length; i++) {
            var img = compData.images[i];
            if (img.filePath) {
              var imgFile = new File(img.filePath);
              if (!imgFile.exists && srcDir) {
                imgFile = new File(srcDir.fsName + "/" + new File(img.filePath).name);
              }
              if (imgFile.exists) {
                var destImg = new File(filesDir.fsName + "/" + imgFile.name);
                imgFile.copy(destImg);
                img.filePath = destImg.fsName;
              }
            }
          }
        }

        // Copy code reference files
        if (compData.files && compData.files.length) {
          for (var j = 0; j < compData.files.length; j++) {
            var codeFile = compData.files[j];
            if (codeFile.filePath) {
              var codeF = new File(codeFile.filePath);
              if (!codeF.exists && srcDir) {
                codeF = new File(srcDir.fsName + "/" + new File(codeFile.filePath).name);
              }
              if (codeF.exists) {
                var destCode = new File(filesDir.fsName + "/" + codeF.name);
                codeF.copy(destCode);
                codeFile.filePath = destCode.fsName;
              }
            }
          }
        }
      }
    }

    // Write preset.json
    var presetFile = new File(presetDir.fsName + "/preset.json");
    presetFile.encoding = "UTF-8";
    presetFile.open("w");
    presetFile.write(JSON.stringify(prefs));
    presetFile.close();

    return JSON.stringify({ id: presetId, name: presetName });
  } catch (e) {
    return "error: " + e.toString();
  }
}

/**
 * Export the active composition as a full JSON snapshot.
 * Gathers comp info, all layers (type, transform values, effects, masks),
 * keyframes for animated properties, and expressions.
 * Returns a JSON string ready for upload.
 */
function exportActiveCompForWeb() {
  try {
    var comp = getActiveComp();
    if (!comp) return JSON.stringify({ error: "No active composition" });

    var visitedComps = {};  // Track visited comp IDs to avoid cycles
    var compData = _exportComp(comp, visitedComps, 0);

    return JSON.stringify(compData);
  } catch (e) {
    return JSON.stringify({ error: e.toString() });
  }
}

/**
 * Recursively export a composition and all nested precomps.
 * maxDepth prevents infinite recursion on circular references.
 */
function _exportComp(comp, visitedComps, depth) {
  var MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) return null;
  if (visitedComps[comp.id]) return { _ref: comp.id, name: comp.name };
  visitedComps[comp.id] = true;

  var compData = {
    name: comp.name,
    id: comp.id,
    width: comp.width,
    height: comp.height,
    pixelAspect: comp.pixelAspect,
    frameRate: comp.frameRate,
    duration: comp.duration,
    numLayers: comp.numLayers,
    backgroundColor: [comp.bgColor[0], comp.bgColor[1], comp.bgColor[2]],
    layers: []
  };

  for (var i = 1; i <= comp.numLayers; i++) {
    var layer = comp.layer(i);
    var layerData = _exportLayer(layer, comp.frameRate);

    // Recurse into precomps
    if (layerData.type === "precomp" && layer.source && layer.source instanceof CompItem) {
      layerData.precomp = _exportComp(layer.source, visitedComps, depth + 1);
    }

    compData.layers.push(layerData);
  }

  return compData;
}

function _exportLayer(layer, frameRate) {
  var type = "other";
  if (layer instanceof TextLayer) type = "text";
  else if (layer instanceof ShapeLayer) type = "shape";
  else if (layer instanceof CameraLayer) type = "camera";
  else if (layer instanceof LightLayer) type = "light";
  else if (layer instanceof AVLayer) {
    if (layer.adjustmentLayer) type = "adjustment";
    else if (layer.nullLayer) type = "null";
    else if (layer.source instanceof CompItem) type = "precomp";
    else type = "av";
  }

  var data = {
    index: layer.index,
    name: layer.name,
    type: type,
    enabled: layer.enabled,
    solo: layer.solo,
    shy: layer.shy,
    locked: layer.locked,
    inPoint: layer.inPoint,
    outPoint: layer.outPoint,
    startTime: layer.startTime,
    stretch: layer.stretch,
    label: layer.label,
    is3D: layer.threeDLayer,
    parentIndex: layer.parent ? layer.parent.index : null,
    blendMode: _blendModeToString(layer.blendingMode),
    transform: {}
  };

  // Transform properties
  var xf = layer.property("ADBE Transform Group");
  if (xf) {
    var props = ["ADBE Anchor Point", "ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Opacity"];
    var names = ["anchorPoint", "position", "scale", "rotation", "opacity"];
    if (layer.threeDLayer) {
      props.push("ADBE Rotate X", "ADBE Rotate Y", "ADBE Orientation");
      names.push("xRotation", "yRotation", "orientation");
    }
    for (var p = 0; p < props.length; p++) {
      var prop = xf.property(props[p]);
      if (prop) {
        data.transform[names[p]] = _exportProperty(prop);
      }
    }
  }

  // Text content
  if (type === "text") {
    try {
      var srcText = layer.property("ADBE Text Properties").property("ADBE Text Document");
      if (srcText) {
        var doc = srcText.value;
        data.text = {
          content: doc.text,
          font: doc.font,
          fontSize: doc.fontSize,
          fillColor: doc.fillColor ? [doc.fillColor[0], doc.fillColor[1], doc.fillColor[2]] : null,
          justification: doc.justification ? doc.justification.toString() : null,
          tracking: doc.tracking
        };
      }
    } catch (te) {}
  }

  // Shape content (full shape data — paths, fills, strokes, transforms)
  if (type === "shape") {
    try {
      var contents = layer.property("ADBE Root Vectors Group");
      if (contents) {
        data.shapeGroups = [];
        for (var g = 1; g <= contents.numProperties; g++) {
          var grp = contents.property(g);
          var groupData = { name: grp.name, shapes: [], fills: [], strokes: [] };

          // Shape primitives and paint are inside Contents (ADBE Vectors Group)
          var innerContents = grp.property("Contents");
          if (innerContents) {
            for (var sg = 1; sg <= innerContents.numProperties; sg++) {
              var sub = innerContents.property(sg);
              var smn = sub.matchName;

              if (smn === "ADBE Vector Shape - Rect") {
                var rsz = sub.property("ADBE Vector Rect Size").value;
                var rrn = sub.property("ADBE Vector Rect Roundness").value;
                var rps = sub.property("ADBE Vector Rect Position").value;
                groupData.shapes.push({ type: "rect", width: rsz[0], height: rsz[1], roundness: rrn, position: [rps[0], rps[1]] });
              } else if (smn === "ADBE Vector Shape - Ellipse") {
                var esz = sub.property("ADBE Vector Ellipse Size").value;
                var eps = sub.property("ADBE Vector Ellipse Position").value;
                groupData.shapes.push({ type: "ellipse", width: esz[0], height: esz[1], position: [eps[0], eps[1]] });
              } else if (smn === "ADBE Vector Shape - Group") {
                var pv = sub.property("ADBE Vector Shape").value;
                var verts = [], inTan = [], outTan = [];
                for (var vi = 0; vi < pv.vertices.length; vi++) {
                  verts.push([pv.vertices[vi][0], pv.vertices[vi][1]]);
                  inTan.push([pv.inTangents[vi][0], pv.inTangents[vi][1]]);
                  outTan.push([pv.outTangents[vi][0], pv.outTangents[vi][1]]);
                }
                groupData.shapes.push({ type: "path", vertices: verts, inTangents: inTan, outTangents: outTan, closed: pv.closed });
              } else if (smn === "ADBE Vector Shape - Star") {
                try {
                  var starType = sub.property("ADBE Vector Star Type").value; // 1=star, 2=polygon
                  var starPts = sub.property("ADBE Vector Star Points").value;
                  var starOR = sub.property("ADBE Vector Star Outer Radius").value;
                  var starRnd = sub.property("ADBE Vector Star Outer Roundness").value;
                  if (starType === 1) {
                    var starIR = sub.property("ADBE Vector Star Inner Radius").value;
                    groupData.shapes.push({ type: "star", points: starPts, outerRadius: starOR, innerRadius: starIR, roundness: starRnd });
                  } else {
                    groupData.shapes.push({ type: "polygon", sides: starPts, radius: starOR, roundness: starRnd });
                  }
                } catch (starErr) {
                  groupData.shapes.push({ type: "star" });
                }
              } else if (smn === "ADBE Vector Graphic - Fill") {
                var fillC = sub.property("ADBE Vector Fill Color").value;
                var fillO = sub.property("ADBE Vector Fill Opacity").value;
                groupData.fills.push({ color: [fillC[0], fillC[1], fillC[2]], opacity: fillO });
              } else if (smn === "ADBE Vector Graphic - Stroke") {
                var strokeC = sub.property("ADBE Vector Stroke Color").value;
                var strokeW = sub.property("ADBE Vector Stroke Width").value;
                var strokeO = sub.property("ADBE Vector Stroke Opacity").value;
                groupData.strokes.push({ color: [strokeC[0], strokeC[1], strokeC[2]], width: strokeW, opacity: strokeO });
              } else if (smn === "ADBE Vector Graphic - G-Fill") {
                groupData.fills.push({ type: "gradient" });
              } else if (smn === "ADBE Vector Graphic - G-Stroke") {
                groupData.strokes.push({ type: "gradient" });
              }
            }
          }

          // Group-level transform
          var grpXf = grp.property("Transform");
          if (grpXf) {
            groupData.transform = {
              anchorPoint: [grpXf.property("Anchor Point").value[0], grpXf.property("Anchor Point").value[1]],
              position: [grpXf.property("Position").value[0], grpXf.property("Position").value[1]],
              scale: [grpXf.property("Scale").value[0], grpXf.property("Scale").value[1]],
              rotation: grpXf.property("Rotation").value,
              opacity: grpXf.property("Opacity").value
            };
          }

          data.shapeGroups.push(groupData);
        }
      }
    } catch (se) {}
  }

  // Solid color
  if (type === "av" && layer.source && layer.source.mainSource && layer.source.mainSource.color) {
    var sc = layer.source.mainSource.color;
    data.solidColor = [sc[0], sc[1], sc[2]];
  }

  // Masks
  try {
    var maskGroup = layer.property("ADBE Mask Parade");
    if (maskGroup && maskGroup.numProperties > 0) {
      data.masks = [];
      for (var m = 1; m <= maskGroup.numProperties; m++) {
        var mask = maskGroup.property(m);
        var maskPath = mask.property("ADBE Mask Shape").value;
        data.masks.push({
          name: mask.name,
          mode: mask.maskMode.toString(),
          inverted: mask.inverted,
          vertices: maskPath.vertices,
          inTangents: maskPath.inTangents,
          outTangents: maskPath.outTangents,
          closed: maskPath.closed
        });
      }
    }
  } catch (me) {}

  // Effects (names only for now)
  try {
    var fx = layer.property("ADBE Effect Parade");
    if (fx && fx.numProperties > 0) {
      data.effects = [];
      for (var e = 1; e <= fx.numProperties; e++) {
        data.effects.push({
          name: fx.property(e).name,
          matchName: fx.property(e).matchName,
          enabled: fx.property(e).enabled
        });
      }
    }
  } catch (ee) {}

  return data;
}

function _exportProperty(prop) {
  var result = { value: prop.value };
  // Expression
  if (prop.expressionEnabled && prop.expression) {
    result.expression = prop.expression;
  }
  // Keyframes
  if (prop.numKeys > 0) {
    result.keyframes = [];
    for (var k = 1; k <= prop.numKeys; k++) {
      var kf = {
        time: prop.keyTime(k),
        value: prop.keyValue(k)
      };
      try {
        kf.inInterp = prop.keyInInterpolationType(k).toString();
        kf.outInterp = prop.keyOutInterpolationType(k).toString();
      } catch (ie) {}
      result.keyframes.push(kf);
    }
  }
  return result;
}

function _blendModeToString(mode) {
  var map = {};
  map[BlendingMode.NORMAL] = "normal";
  map[BlendingMode.MULTIPLY] = "multiply";
  map[BlendingMode.SCREEN] = "screen";
  map[BlendingMode.OVERLAY] = "overlay";
  map[BlendingMode.ADD] = "add";
  map[BlendingMode.DARKEN] = "darken";
  map[BlendingMode.LIGHTEN] = "lighten";
  map[BlendingMode.COLOR_DODGE] = "colorDodge";
  map[BlendingMode.COLOR_BURN] = "colorBurn";
  map[BlendingMode.HARD_LIGHT] = "hardLight";
  map[BlendingMode.SOFT_LIGHT] = "softLight";
  map[BlendingMode.DIFFERENCE] = "difference";
  map[BlendingMode.EXCLUSION] = "exclusion";
  return map[mode] || "normal";
}

/**
 * Get the path to the working_files directory for a given instance.
 * Creates the directory if it doesn't exist.
 * Returns the folder path.
 */
function getWorkingFilesPath(instanceId) {
  try {
    var destFolder = new Folder(Folder.userData.fsName + "/MotionAmigo/working_files/" + instanceId);
    if (!destFolder.exists) destFolder.create();
    return destFolder.fsName;
  } catch (e) {
    return "";
  }
}
