/**
 * MotionAmigo Physics Engine
 * 
 * Robust physics simulation powered by Planck.js (Box2D port)
 * Provides real-time physics preview and keyframe export for After Effects
 * 
 * @requires planck.min.js loaded before this file
 */

(function(global) {
  'use strict';

  // ============================================
  // PLANCK.JS DETECTION & INITIALIZATION
  // ============================================
  
  // Planck.js uses UMD and should expose itself as window.planck
  var planck = global.planck;
  
  if (!planck) {
    console.error('[PhysicsEngine] Planck.js not found! Make sure planck.min.js is loaded before physics-engine.js');
    // Expose a stub so the code doesn't break
    global.PhysicsEngine = function() {
      console.error('[PhysicsEngine] Cannot initialize - Planck.js not loaded');
      return null;
    };
    return;
  }

  console.log('[PhysicsEngine] Planck.js v' + (planck.internal ? planck.internal.version : '0.3.x') + ' detected');

  // Planck.js shortcuts
  var Vec2 = planck.Vec2;
  var World = planck.World;
  var Box = planck.Box;
  var Circle = planck.Circle;
  var Polygon = planck.Polygon;
  var Edge = planck.Edge;

  // ============================================
  // CONSTANTS
  // ============================================

  var PIXELS_PER_METER = 50;  // Scale factor for display
  var DEFAULT_TIMESTEP = 1 / 60;  // 60 FPS physics
  var VELOCITY_ITERATIONS = 8;
  var POSITION_ITERATIONS = 3;

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  function pixelsToMeters(px) {
    return px / PIXELS_PER_METER;
  }

  function metersToPixels(m) {
    return m * PIXELS_PER_METER;
  }

  function degreesToRadians(deg) {
    return deg * Math.PI / 180;
  }

  function radiansToDegrees(rad) {
    return rad * 180 / Math.PI;
  }

  function hexToRgb(hex) {
    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16) / 255,
      g: parseInt(result[2], 16) / 255,
      b: parseInt(result[3], 16) / 255
    } : { r: 0.8, g: 0.77, b: 0.69 };
  }

  // ============================================
  // BODY WRAPPER CLASS
  // ============================================
  
  /**
   * Wrapper around Planck body with metadata and recording
   */
  function PhysicsBody(engine, planckBody, options) {
    this.engine = engine;
    this.body = planckBody;
    this.id = options.id || 'body_' + Math.random().toString(36).substr(2, 9);
    this.name = options.name || this.id;
    this.shapeType = options.shapeType || 'circle';
    this.color = options.color || '#CEC5B1';
    this.width = options.width || 30;
    this.height = options.height || 30;
    this.radius = options.radius || 15;
    this.vertices = options.vertices || null; // Original pixel-space vertices for polygon rendering
    this.layerIndex = options.layerIndex || null; // AE layer index for imported bodies
    this.bodyType = options.bodyType || (planckBody.getType() === 'static' ? 'static' : 'dynamic'); // 'dynamic', 'static', 'kinematic'

    // Render mode: matches AE shape layer fill/stroke composition.
    //   'fill'   - solid fill only (default); physics uses Circle/Box/Polygon
    //   'stroke' - outline only; physics is a hollow rim built from thin
    //              wall fixtures along the perimeter, so other bodies can
    //              sit inside and bounce off the rim from either side
    //   'both'   - fill + outline; physics uses the solid primitive and the
    //              stroke is visual-only
    this.renderMode = options.renderMode || 'fill';
    this.strokeColor = options.strokeColor || null; // hex; null = derive from color
    this.strokeWidth = options.strokeWidth !== undefined ? options.strokeWidth : 2;

    // Stashed so the engine can rebuild fixtures on render-mode toggles
    // without losing the original physics properties.
    var defaultParams = engine.params || {};
    this.fixtureParams = options.fixtureParams || {
      density: options.density || defaultParams.density || 1,
      friction: options.friction !== undefined ? options.friction : (defaultParams.friction !== undefined ? defaultParams.friction : 0.3),
      restitution: options.restitution !== undefined ? options.restitution : (defaultParams.bounce !== undefined ? defaultParams.bounce : 0.3)
    };

    // Attractor properties
    this.isAttractor = options.isAttractor || false;
    this.attractorStrength = options.attractorStrength !== undefined ? options.attractorStrength : 50; // negative = repel
    this.attractorRadius = options.attractorRadius !== undefined ? options.attractorRadius : 200; // pixels
    this.attractorFalloff = options.attractorFalloff || 'inverseSquare'; // 'linear' or 'inverseSquare'

    // Keyframe data for kinematic playback (imported from AE)
    this.keyframes = options.keyframes || null; // Array of {time, x, y, rotation}

    // Recording for keyframe export
    this.recording = [];
    this.isRecording = false;

    // Store initial state for reset
    var pos = this.body.getPosition();
    this.initialState = {
      x: pos.x,
      y: pos.y,
      angle: this.body.getAngle(),
      vx: 0,
      vy: 0,
      angularVelocity: 0
    };
  }

  PhysicsBody.prototype.getPosition = function() {
    var pos = this.body.getPosition();
    return {
      x: metersToPixels(pos.x),
      y: metersToPixels(pos.y)
    };
  };

  /**
   * Returns the bounding-circle radius of this body in pixel space.
   * Used by _drawBody for body-type, hover, and selection rings so every
   * shape gets a ring that actually wraps its geometry — previously polygons
   * fell back to a hard-coded 20 which drew a tiny ring at the body center
   * regardless of the polygon's true size.
   */
  PhysicsBody.prototype.getBoundingRadius = function() {
    if (this.shapeType === 'circle') return this.radius;
    if (this.shapeType === 'rectangle') {
      // Half-diagonal — the same conservative envelope hit-testing uses
      return Math.sqrt(this.width * this.width + this.height * this.height) / 2;
    }
    // Polygon — furthest vertex from the body's local origin (center of mass)
    if (this.vertices && this.vertices.length > 0) {
      var maxSq = 0;
      for (var i = 0; i < this.vertices.length; i++) {
        var v = this.vertices[i];
        var vx = v.x !== undefined ? v.x : v[0];
        var vy = v.y !== undefined ? v.y : v[1];
        var dSq = vx * vx + vy * vy;
        if (dSq > maxSq) maxSq = dSq;
      }
      return Math.sqrt(maxSq);
    }
    return this.radius || 20;
  };

  PhysicsBody.prototype.getAngle = function() {
    return radiansToDegrees(this.body.getAngle());
  };

  PhysicsBody.prototype.getLinearVelocity = function() {
    var vel = this.body.getLinearVelocity();
    return {
      x: metersToPixels(vel.x),
      y: metersToPixels(vel.y)
    };
  };

  PhysicsBody.prototype.setPosition = function(x, y) {
    this.body.setPosition(Vec2(pixelsToMeters(x), pixelsToMeters(y)));
  };

  PhysicsBody.prototype.setAngle = function(degrees) {
    this.body.setAngle(degreesToRadians(degrees));
  };

  PhysicsBody.prototype.setLinearVelocity = function(vx, vy) {
    this.body.setLinearVelocity(Vec2(pixelsToMeters(vx), pixelsToMeters(vy)));
  };

  PhysicsBody.prototype.applyForce = function(fx, fy, worldPoint) {
    var force = Vec2(fx, fy);
    var point = worldPoint ? 
      Vec2(pixelsToMeters(worldPoint.x), pixelsToMeters(worldPoint.y)) : 
      this.body.getWorldCenter();
    this.body.applyForce(force, point, true);
  };

  PhysicsBody.prototype.applyImpulse = function(ix, iy, worldPoint) {
    var impulse = Vec2(ix, iy);
    var point = worldPoint ? 
      Vec2(pixelsToMeters(worldPoint.x), pixelsToMeters(worldPoint.y)) : 
      this.body.getWorldCenter();
    this.body.applyLinearImpulse(impulse, point, true);
  };

  PhysicsBody.prototype.reset = function() {
    this.body.setPosition(Vec2(this.initialState.x, this.initialState.y));
    this.body.setAngle(this.initialState.angle);
    this.body.setLinearVelocity(Vec2(this.initialState.vx, this.initialState.vy));
    this.body.setAngularVelocity(this.initialState.angularVelocity);
    this.body.setAwake(true);
    // Note: recording is NOT cleared here — it's cleared in startRecording()
    // so that replay can work after stop/reset.
  };

  PhysicsBody.prototype.recordFrame = function(time) {
    if (!this.isRecording) return;
    
    var pos = this.getPosition();
    var angle = this.getAngle();
    
    this.recording.push({
      time: time,
      x: pos.x,
      y: pos.y,
      rotation: angle
    });
  };

  PhysicsBody.prototype.getKeyframes = function() {
    return this.recording.slice();
  };

  PhysicsBody.prototype.startRecording = function() {
    this.recording = [];
    this.isRecording = true;
  };

  PhysicsBody.prototype.stopRecording = function() {
    this.isRecording = false;
  };

  PhysicsBody.prototype.setBodyType = function(type) {
    if (type !== 'dynamic' && type !== 'static' && type !== 'kinematic') return;
    this.bodyType = type;
    this.body.setType(type);
    if (type === 'static' || type === 'kinematic') {
      this.body.setLinearVelocity(Vec2(0, 0));
      this.body.setAngularVelocity(0);
    }
    this.body.setAwake(true);
  };

  /**
   * For kinematic bodies: interpolate position from keyframe data at a given time
   */
  PhysicsBody.prototype.updateKinematic = function(time) {
    if (this.bodyType !== 'kinematic' || !this.keyframes || this.keyframes.length < 2) return;
    var kf = this.keyframes;

    // Clamp to keyframe range
    if (time <= kf[0].time) {
      this.body.setPosition(Vec2(pixelsToMeters(kf[0].x), pixelsToMeters(kf[0].y)));
      if (kf[0].rotation !== undefined) this.body.setAngle(degreesToRadians(kf[0].rotation));
      return;
    }
    if (time >= kf[kf.length - 1].time) {
      var last = kf[kf.length - 1];
      this.body.setPosition(Vec2(pixelsToMeters(last.x), pixelsToMeters(last.y)));
      if (last.rotation !== undefined) this.body.setAngle(degreesToRadians(last.rotation));
      return;
    }

    // Find surrounding keyframes and lerp
    for (var i = 0; i < kf.length - 1; i++) {
      if (time >= kf[i].time && time <= kf[i + 1].time) {
        var t = (time - kf[i].time) / (kf[i + 1].time - kf[i].time);
        var x = kf[i].x + (kf[i + 1].x - kf[i].x) * t;
        var y = kf[i].y + (kf[i + 1].y - kf[i].y) * t;
        this.body.setPosition(Vec2(pixelsToMeters(x), pixelsToMeters(y)));
        if (kf[i].rotation !== undefined && kf[i + 1].rotation !== undefined) {
          var rot = kf[i].rotation + (kf[i + 1].rotation - kf[i].rotation) * t;
          this.body.setAngle(degreesToRadians(rot));
        }
        // Set velocity so dynamic bodies react properly to the kinematic push
        var dt = kf[i + 1].time - kf[i].time;
        if (dt > 0) {
          var vx = pixelsToMeters(kf[i + 1].x - kf[i].x) / dt;
          var vy = pixelsToMeters(kf[i + 1].y - kf[i].y) / dt;
          this.body.setLinearVelocity(Vec2(vx, vy));
        }
        return;
      }
    }
  };

  // ============================================
  // PHYSICS ENGINE CLASS
  // ============================================

  /**
   * Main physics engine wrapper around Planck.js
   */
  function PhysicsEngine(canvas, options) {
    options = options || {};
    
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    // Handle HiDPI/Retina displays
    this.dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    this.width = rect.width || canvas.width;
    this.height = rect.height || canvas.height;
    
    // Scale canvas for HiDPI
    canvas.width = this.width * this.dpr;
    canvas.height = this.height * this.dpr;
    canvas.style.width = this.width + 'px';
    canvas.style.height = this.height + 'px';
    this.ctx.scale(this.dpr, this.dpr);
    
    // Physics parameters
    this.params = {
      gravity: options.gravity !== undefined ? options.gravity : 9.8,
      gravityAngle: options.gravityAngle || 90,
      bounce: options.bounce !== undefined ? options.bounce : 0.7,
      friction: options.friction !== undefined ? options.friction : 0.3,
      density: options.density !== undefined ? options.density : 1.0,
      airResistance: options.airResistance !== undefined ? options.airResistance : 0.01,
      angularDrag: options.angularDrag !== undefined ? options.angularDrag : 0.05
    };
    
    // World bounds in pixels (thin uniform edges)
    this.bounds = {
      left: 2,
      right: this.width - 2,
      top: 2,
      bottom: this.height - 2
    };
    
    // Wall toggle (default: on)
    this.wallsEnabled = true;

    // Viewport transform (for showing off-comp shapes when walls are off)
    this._viewportScale = 1.0;    // 1.0 = normal, <1.0 = zoomed out
    this._viewportOffsetX = 0;     // canvas-space offset to center the zoomed view
    this._viewportOffsetY = 0;
    this._userZoom = 1.0;          // manual zoom via Cmd+scroll (persists across wall toggles)

    // Create Planck world
    this._createWorld();

    // Body tracking
    this.bodies = [];
    this.bodyMap = {};  // id -> PhysicsBody
    
    // Animation state
    this.isRunning = false;
    this.animationId = null;
    this.lastTime = 0;
    this.simulationTime = 0;

    // Playback state
    this.isPlayingBack = false;
    this._playbackAnimId = null;
    this.playbackTime = 0;
    this.playbackDuration = 0;
    this.frameRate = 60;
    
    // Recording state
    this.isRecording = false;
    this.recordingStartTime = 0;
    this.maxRecordingDuration = 10;  // seconds

    // Gravity indicator interaction state
    this._gravityIndicator = {
      cx: this.width - 28,
      cy: 28,
      radius: 18,
      isHovering: false,
      isDragging: false
    };

    // Body drag interaction state
    this._bodyDrag = {
      activeBody: null,      // PhysicsBody being dragged
      hoverBody: null,       // PhysicsBody being hovered
      offsetX: 0,
      offsetY: 0
    };

    // Multi-selection state. Primary value: right-click on a stack of
    // overlapping bodies shows a picker so you can grab the one underneath
    // instead of being stuck with the topmost. Shift+click and drag-marquee
    // build selections for batch actions in the multi-body context menu.
    this._selectedBodies = []; // Array of PhysicsBody wrappers
    this._marquee = {
      active: false,
      startX: 0,
      startY: 0,
      endX: 0,
      endY: 0
    };

    // ID counter for user-added shapes
    this._shapeCounter = 0;

    // Comp-to-canvas scale factor (set by host via resize)
    this.compScale = 1;

    // Wall drawing mode state
    this._wallDraw = {
      active: false,
      startPoint: null,
      previewEnd: null,
      wallThickness: 4
    };

    this._initCanvasInteraction();

    // Create default bodies and walls
    this._createWalls();
    this._createDefaultBodies();
    this._draw();
  }

  // ============================================
  // WORLD MANAGEMENT
  // ============================================

  PhysicsEngine.prototype._createWorld = function() {
    // Calculate gravity vector from magnitude and angle
    var gravAngleRad = degreesToRadians(this.params.gravityAngle);
    var gx = Math.cos(gravAngleRad) * this.params.gravity;
    var gy = Math.sin(gravAngleRad) * this.params.gravity;
    
    this.world = World({
      gravity: Vec2(gx, gy)
    });
    
    // Contact listener for collision events
    var self = this;
    this.world.on('begin-contact', function(contact) {
      if (self.onCollision) {
        self.onCollision(contact);
      }
    });
  };

  PhysicsEngine.prototype._createWalls = function() {
    if (!this.wallsEnabled) return;
    // Convert bounds to meters
    var left = pixelsToMeters(this.bounds.left);
    var right = pixelsToMeters(this.bounds.right);
    var top = pixelsToMeters(this.bounds.top);
    var bottom = pixelsToMeters(this.bounds.bottom);
    var thickness = pixelsToMeters(10);
    
    // Ground
    var groundBody = this.world.createBody({
      type: 'static',
      position: Vec2((left + right) / 2, bottom + thickness / 2)
    });
    groundBody.createFixture({
      shape: Box((right - left) / 2, thickness / 2),
      friction: this.params.friction,
      restitution: this.params.bounce
    });
    this.groundBody = groundBody;
    
    // Left wall
    var leftWall = this.world.createBody({
      type: 'static',
      position: Vec2(left - thickness / 2, (top + bottom) / 2)
    });
    leftWall.createFixture({
      shape: Box(thickness / 2, (bottom - top) / 2),
      friction: this.params.friction,
      restitution: this.params.bounce
    });
    this.leftWall = leftWall;
    
    // Right wall
    var rightWall = this.world.createBody({
      type: 'static',
      position: Vec2(right + thickness / 2, (top + bottom) / 2)
    });
    rightWall.createFixture({
      shape: Box(thickness / 2, (bottom - top) / 2),
      friction: this.params.friction,
      restitution: this.params.bounce
    });
    this.rightWall = rightWall;
    
    // Ceiling
    var ceiling = this.world.createBody({
      type: 'static',
      position: Vec2((left + right) / 2, top - thickness / 2)
    });
    ceiling.createFixture({
      shape: Box((right - left) / 2, thickness / 2),
      friction: this.params.friction,
      restitution: this.params.bounce
    });
    this.ceiling = ceiling;
  };

  PhysicsEngine.prototype._destroyWalls = function() {
    if (this.groundBody) this.world.destroyBody(this.groundBody);
    if (this.leftWall) this.world.destroyBody(this.leftWall);
    if (this.rightWall) this.world.destroyBody(this.rightWall);
    if (this.ceiling) this.world.destroyBody(this.ceiling);
    this.groundBody = null;
    this.leftWall = null;
    this.rightWall = null;
    this.ceiling = null;
  };

  PhysicsEngine.prototype.setWallsEnabled = function(enabled) {
    if (this.wallsEnabled === enabled) return;
    this.wallsEnabled = enabled;

    if (enabled) {
      this._createWalls();
    } else {
      this._destroyWalls();
    }

    this._updateViewport();
    if (!this.isRunning) this._draw();
  };

  PhysicsEngine.prototype._updateViewport = function() {
    if (this.wallsEnabled) {
      this._viewportScale = 1.0;
      this._viewportOffsetX = 0;
      this._viewportOffsetY = 0;
      this._userZoom = 1.0;  // reset manual zoom when walls go on
    } else {
      // Use panel width as viewport — no forced zoom
      // User can Cmd+scroll to zoom in/out from here
      var zoom = this._userZoom || 1.0;
      this._viewportScale = zoom;
      this._viewportOffsetX = this.width * (1 - zoom) / 2;
      this._viewportOffsetY = this.height * (1 - zoom) / 2;
    }
  };

  PhysicsEngine.prototype.updateGravity = function() {
    var gravAngleRad = degreesToRadians(this.params.gravityAngle);
    var gx = Math.cos(gravAngleRad) * this.params.gravity;
    var gy = Math.sin(gravAngleRad) * this.params.gravity;
    this.world.setGravity(Vec2(gx, gy));
  };

  // ============================================
  // BODY CREATION
  // ============================================

  PhysicsEngine.prototype._createDefaultBodies = function() {
    // Start with a clean canvas — no default shapes.
    // The user imports bodies from AE via the Import button.
    this.clearBodies();
  };

  PhysicsEngine.prototype._resolveBodyType = function(options) {
    if (options.bodyType) return options.bodyType;
    return options.isStatic ? 'static' : 'dynamic';
  };

  // Destroy any fixtures currently on the body.
  // Used by _attachFixturesForMode when re-building after a renderMode toggle.
  function _destroyAllFixtures(body) {
    var fx = body.getFixtureList();
    while (fx) {
      var next = fx.getNext();
      body.destroyFixture(fx);
      fx = next;
    }
  }

  // Planck (Box2D) caps a single convex polygon fixture at this many vertices.
  // Freeform-path imports like letters can produce more hull points than this —
  // Planck would silently drop the overflow, leaving the physics body smaller
  // than the visible glyph. We avoid that by triangulating the hull across
  // multiple fixtures when it exceeds the limit.
  var MAX_POLYGON_VERTICES = 12;

  // Number of segments used to tessellate a circle's perimeter when it's
  // rendered as a hollow container. 48 keeps bounces smooth without adding
  // noticeable cost at the body counts this panel handles.
  var CIRCLE_CONTAINER_SEGMENTS = 48;

  // Compute the convex hull of a set of {x,y} points using Andrew's monotone
  // chain algorithm (O(n log n)). Returns hull vertices in counter-clockwise
  // order. Duplicate and collinear points are discarded naturally.
  function _convexHull(points) {
    if (points.length < 3) return points.slice();
    var sorted = points.slice().sort(function(a, b) {
      return a.x === b.x ? a.y - b.y : a.x - b.x;
    });
    function cross(o, a, b) {
      return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    }
    var lower = [];
    for (var i = 0; i < sorted.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], sorted[i]) <= 0) {
        lower.pop();
      }
      lower.push(sorted[i]);
    }
    var upper = [];
    for (var j = sorted.length - 1; j >= 0; j--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], sorted[j]) <= 0) {
        upper.pop();
      }
      upper.push(sorted[j]);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  // Arithmetic mean of a point set. Used as a triangulation pivot for convex
  // polygons — guaranteed to lie strictly inside the hull.
  function _centroid(points) {
    var sumX = 0, sumY = 0;
    for (var i = 0; i < points.length; i++) {
      sumX += points[i].x;
      sumY += points[i].y;
    }
    return { x: sumX / points.length, y: sumY / points.length };
  }

  // Read wrapper.vertices as plain {x,y} pixel-space points. Handles both
  // {x,y} and [x,y] vertex storage formats that appear in the codebase.
  function _wrapperPolygonPixelPoints(wrapper) {
    var out = [];
    if (!wrapper.vertices) return out;
    for (var i = 0; i < wrapper.vertices.length; i++) {
      var v = wrapper.vertices[i];
      out.push({
        x: v.x !== undefined ? v.x : v[0],
        y: v.y !== undefined ? v.y : v[1]
      });
    }
    return out;
  }

  // Attach polygon fixtures on a body covering the convex hull of the given
  // pixel-space points. If the hull fits within Planck's per-polygon vertex
  // limit, a single fixture is created; otherwise the hull is fan-triangulated
  // from its centroid and each triangle becomes its own fixture. The union of
  // triangles exactly equals the hull, so no vertex is lost.
  function _attachHullFixtures(body, hullPoints, params) {
    function toVec2(p) { return Vec2(pixelsToMeters(p.x), pixelsToMeters(p.y)); }
    if (hullPoints.length <= MAX_POLYGON_VERTICES) {
      body.createFixture({
        shape: Polygon(hullPoints.map(toVec2)),
        density: params.density,
        friction: params.friction,
        restitution: params.restitution
      });
      return;
    }
    var center = _centroid(hullPoints);
    var centerVec = Vec2(pixelsToMeters(center.x), pixelsToMeters(center.y));
    for (var i = 0; i < hullPoints.length; i++) {
      var v0 = hullPoints[i];
      var v1 = hullPoints[(i + 1) % hullPoints.length];
      body.createFixture({
        shape: Polygon([centerVec, toVec2(v0), toVec2(v1)]),
        density: params.density,
        friction: params.friction,
        restitution: params.restitution
      });
    }
  }

  // Reorient a closed Vec2 loop so its winding is clockwise in Y-down world
  // coordinates. _attachWallFixtures assumes this winding when computing
  // the inward perpendicular for each edge; without it, wall offsets would
  // point outward for arbitrary imported paths. Uses the signed shoelace
  // area to detect the current winding: positive = CW in Y-down, negative
  // = CCW.
  function _orientClockwise(verts) {
    if (!verts || verts.length < 3) return verts;
    var signedArea = 0;
    for (var i = 0; i < verts.length; i++) {
      var a = verts[i];
      var b = verts[(i + 1) % verts.length];
      signedArea += (b.x - a.x) * (b.y + a.y);
    }
    if (signedArea < 0) return verts.slice().reverse();
    return verts;
  }

  // Convert a wrapper's stored pixel-space vertices into a Vec2 array in
  // meters, handling both {x,y} and [x,y] vertex forms. Shared by the solid
  // polygon fixture path and the hollow container path so vertex normalization
  // lives in one place.
  function _wrapperPolygonVerts(wrapper) {
    var out = [];
    if (!wrapper.vertices) return out;
    for (var i = 0; i < wrapper.vertices.length; i++) {
      var v = wrapper.vertices[i];
      var x = v.x !== undefined ? v.x : v[0];
      var y = v.y !== undefined ? v.y : v[1];
      out.push(Vec2(pixelsToMeters(x), pixelsToMeters(y)));
    }
    return out;
  }

  // Physics thickness of a hollow body's wall, in pixels. Small enough that
  // the wall still reads as "just the outline", large enough that bouncing
  // bodies don't tunnel through at the default time-step and body counts
  // this panel works with.
  var HOLLOW_WALL_THICKNESS_PIXELS = 4;

  // Build thin solid Polygon wall fixtures along each edge of a perimeter
  // loop. The union of the fixtures forms a hollow rim: bodies on both the
  // outside and inside collide with the walls, so the loop behaves as a
  // container. Works for static, dynamic, and kinematic bodies alike (unlike
  // Box2D Chain shapes, which are only defined for static bodies).
  //
  // Adjacent edges overlap at their shared vertex by half the wall
  // thickness, so corners are sealed without gaps.
  function _attachWallFixtures(body, loop, params) {
    var half = pixelsToMeters(HOLLOW_WALL_THICKNESS_PIXELS) / 2;
    for (var i = 0; i < loop.length; i++) {
      var a = loop[i];
      var b = loop[(i + 1) % loop.length];
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) continue; // skip degenerate edges
      // Unit direction and inward-pointing perpendicular (derived from the
      // loop's CW winding; see _orientClockwise for the winding guarantee).
      var ux = dx / len, uy = dy / len;
      var px = -uy, py = ux;
      // Extend each endpoint by `half` along the edge direction so adjacent
      // walls overlap at the shared vertex and the corner is watertight.
      var ax = a.x - ux * half, ay = a.y - uy * half;
      var bx = b.x + ux * half, by = b.y + uy * half;
      // Thin rectangle straddling the edge line (half-thickness each side).
      // Vertices emitted CCW so Box2D accepts the polygon.
      body.createFixture({
        shape: Polygon([
          Vec2(ax + px * half, ay + py * half),
          Vec2(bx + px * half, by + py * half),
          Vec2(bx - px * half, by - py * half),
          Vec2(ax - px * half, ay - py * half)
        ]),
        density: params.density,
        friction: params.friction,
        restitution: params.restitution
      });
    }
  }

  // Build body-local perimeter vertices (meters) for a hollow fixture.
  // Vertices are emitted in clockwise order under the panel's Y-down world
  // coordinates; _attachWallFixtures relies on that winding to place its
  // inward-pointing wall offsets correctly.
  //
  // Generic across shape types — a circle tessellates into segments,
  // a rectangle uses its 4 corners, a polygon reuses its stored vertices.
  PhysicsEngine.prototype._buildPerimeterLoop = function(wrapper) {
    if (wrapper.shapeType === 'circle') {
      var verts = [];
      var r = pixelsToMeters(wrapper.radius);
      // Clockwise winding (angle decreasing) for inward-facing normals
      for (var i = 0; i < CIRCLE_CONTAINER_SEGMENTS; i++) {
        var a = -i * Math.PI * 2 / CIRCLE_CONTAINER_SEGMENTS;
        verts.push(Vec2(Math.cos(a) * r, Math.sin(a) * r));
      }
      return verts;
    }
    if (wrapper.shapeType === 'rectangle') {
      var hw = pixelsToMeters(wrapper.width / 2);
      var hh = pixelsToMeters(wrapper.height / 2);
      // Clockwise in Y-down space: TL → BL → BR → TR
      return [Vec2(-hw, -hh), Vec2(-hw, hh), Vec2(hw, hh), Vec2(hw, -hh)];
    }
    // Polygon vertices come from AE paths whose winding we can't assume.
    // Normalize to CW (Y-down) so _attachWallFixtures lays walls on the
    // inside of the loop regardless of the source path's orientation.
    return _orientClockwise(_wrapperPolygonVerts(wrapper));
  };

  /**
   * (Re)attach fixtures on a wrapper's body. Fixture geometry is derived
   * from the render mode:
   *
   *   stroke            → thin solid walls along the perimeter (hollow
   *                       container: other bodies sit inside and bounce off
   *                       the rim from either side). Works for any body
   *                       type — static, dynamic, or kinematic.
   *   fill / both       → solid primitive (Circle, Box, or convex Polygon).
   *
   * Safe to call multiple times; destroys existing fixtures first. Fixture
   * params (density, friction, restitution) come from wrapper.fixtureParams
   * so rebuilds on mode or body-type toggles preserve the original physics.
   */
  PhysicsEngine.prototype._attachFixturesForMode = function(wrapper) {
    var body = wrapper.body;
    var params = wrapper.fixtureParams || { density: 1, friction: 0.3, restitution: 0.3 };

    _destroyAllFixtures(body);

    if (wrapper.renderMode === 'stroke') {
      var loop = this._buildPerimeterLoop(wrapper);
      if (loop && loop.length >= 3) {
        _attachWallFixtures(body, loop, params);
        return;
      }
      // Degenerate geometry — fall through to a solid fixture so the body
      // still collides with something rather than being intangible.
    }

    if (wrapper.shapeType === 'circle') {
      body.createFixture({
        shape: Circle(pixelsToMeters(wrapper.radius)),
        density: params.density,
        friction: params.friction,
        restitution: params.restitution
      });
    } else if (wrapper.shapeType === 'rectangle') {
      body.createFixture({
        shape: Box(pixelsToMeters(wrapper.width / 2), pixelsToMeters(wrapper.height / 2)),
        density: params.density,
        friction: params.friction,
        restitution: params.restitution
      });
    } else if (wrapper.shapeType === 'polygon') {
      // Pre-compute the convex hull ourselves and fan-triangulate it across
      // multiple fixtures when it exceeds Planck's per-polygon vertex cap.
      // This is what lets freeform-path shapes (letters, custom bezier) cover
      // their full visible extent — without it, Planck silently drops hull
      // points past the limit and the physics body ends up smaller than the
      // glyph, leaving a visible gap when bodies rest against walls.
      var pixelPoints = _wrapperPolygonPixelPoints(wrapper);
      if (pixelPoints.length >= 3) {
        var hull = _convexHull(pixelPoints);
        if (hull.length >= 3) {
          _attachHullFixtures(body, hull, params);
        }
      }
    }
  };

  PhysicsEngine.prototype.addCircle = function(options) {
    var x = pixelsToMeters(options.x || this.width / 2);
    var y = pixelsToMeters(options.y || 50);
    var bodyType = this._resolveBodyType(options);

    var body = this.world.createBody({
      type: bodyType,
      position: Vec2(x, y),
      angle: degreesToRadians(options.angle || 0),
      linearDamping: this.params.airResistance * 10,
      angularDamping: this.params.angularDrag * 10
    });

    var wrapper = new PhysicsBody(this, body, {
      id: options.id,
      name: options.name,
      shapeType: 'circle',
      radius: options.radius || 15,
      color: options.color || '#CEC5B1',
      layerIndex: options.layerIndex || null,
      bodyType: bodyType,
      keyframes: options.keyframes || null,
      renderMode: options.renderMode,
      strokeColor: options.strokeColor,
      strokeWidth: options.strokeWidth,
      density: options.density,
      friction: options.friction,
      restitution: options.restitution
    });

    this._attachFixturesForMode(wrapper);

    this.bodies.push(wrapper);
    this.bodyMap[wrapper.id] = wrapper;

    return wrapper;
  };

  PhysicsEngine.prototype.addRectangle = function(options) {
    var x = pixelsToMeters(options.x || this.width / 2);
    var y = pixelsToMeters(options.y || 50);
    var bodyType = this._resolveBodyType(options);

    var body = this.world.createBody({
      type: bodyType,
      position: Vec2(x, y),
      angle: degreesToRadians(options.angle || 0),
      linearDamping: this.params.airResistance * 10,
      angularDamping: this.params.angularDrag * 10
    });

    var wrapper = new PhysicsBody(this, body, {
      id: options.id,
      name: options.name,
      shapeType: 'rectangle',
      width: options.width || 30,
      height: options.height || 30,
      color: options.color || '#CEC5B1',
      layerIndex: options.layerIndex || null,
      bodyType: bodyType,
      keyframes: options.keyframes || null,
      renderMode: options.renderMode,
      strokeColor: options.strokeColor,
      strokeWidth: options.strokeWidth,
      density: options.density,
      friction: options.friction,
      restitution: options.restitution
    });

    this._attachFixturesForMode(wrapper);

    this.bodies.push(wrapper);
    this.bodyMap[wrapper.id] = wrapper;

    return wrapper;
  };

  PhysicsEngine.prototype.addPolygon = function(options) {
    var x = pixelsToMeters(options.x || this.width / 2);
    var y = pixelsToMeters(options.y || 50);

    // Resolve pixel-space vertices. If none supplied, build a regular polygon
    // from sides+radius so the wrapper has real vertices to render and
    // rebuild fixtures from on render-mode toggles.
    var pixelVerts;
    if (options.vertices && options.vertices.length >= 3) {
      pixelVerts = [];
      for (var i = 0; i < options.vertices.length; i++) {
        var v = options.vertices[i];
        pixelVerts.push({
          x: v.x !== undefined ? v.x : v[0],
          y: v.y !== undefined ? v.y : v[1]
        });
      }
    } else {
      pixelVerts = [];
      var sides = options.sides || 5;
      var rpx = options.radius || 20;
      for (var si = 0; si < sides; si++) {
        var ang = (si / sides) * Math.PI * 2 - Math.PI / 2;
        pixelVerts.push({
          x: Math.cos(ang) * rpx,
          y: Math.sin(ang) * rpx
        });
      }
    }

    var bodyType = this._resolveBodyType(options);

    var body = this.world.createBody({
      type: bodyType,
      position: Vec2(x, y),
      angle: degreesToRadians(options.angle || 0),
      linearDamping: this.params.airResistance * 10,
      angularDamping: this.params.angularDrag * 10
    });

    var wrapper = new PhysicsBody(this, body, {
      id: options.id,
      name: options.name,
      shapeType: 'polygon',
      vertices: pixelVerts,
      radius: options.radius || 20,
      color: options.color || '#CEC5B1',
      layerIndex: options.layerIndex || null,
      bodyType: bodyType,
      keyframes: options.keyframes || null,
      renderMode: options.renderMode,
      strokeColor: options.strokeColor,
      strokeWidth: options.strokeWidth,
      density: options.density,
      friction: options.friction,
      restitution: options.restitution
    });

    this._attachFixturesForMode(wrapper);

    this.bodies.push(wrapper);
    this.bodyMap[wrapper.id] = wrapper;

    return wrapper;
  };

  PhysicsEngine.prototype.addAttractor = function(options) {
    var x = pixelsToMeters(options.x || this.width / 2);
    var y = pixelsToMeters(options.y || this.height / 2);
    var visualRadius = pixelsToMeters(options.visualRadius || 8);

    var body = this.world.createBody({
      type: 'static',
      position: Vec2(x, y)
    });

    body.createFixture({
      shape: Circle(visualRadius),
      isSensor: true  // no collision, force field only
    });

    var wrapper = new PhysicsBody(this, body, {
      id: options.id,
      name: options.name,
      shapeType: 'attractor',
      radius: options.visualRadius || 8,
      color: options.color || '#22AAE1',
      bodyType: 'static',
      isAttractor: true,
      attractorStrength: options.strength !== undefined ? options.strength : 50,
      attractorRadius: options.attractorRadius !== undefined ? options.attractorRadius : 200,
      attractorFalloff: options.falloff || 'inverseSquare',
      layerIndex: options.layerIndex || null
    });

    this.bodies.push(wrapper);
    this.bodyMap[wrapper.id] = wrapper;
    return wrapper;
  };

  PhysicsEngine.prototype.removeBody = function(idOrBody) {
    var wrapper = typeof idOrBody === 'string' ? this.bodyMap[idOrBody] : idOrBody;
    if (!wrapper) return;

    this.world.destroyBody(wrapper.body);

    var idx = this.bodies.indexOf(wrapper);
    if (idx !== -1) {
      this.bodies.splice(idx, 1);
    }
    // Drop from multi-selection so the selection ring doesn't linger on a
    // destroyed body (and batch actions don't target it).
    if (this._selectedBodies) {
      var sidx = this._selectedBodies.indexOf(wrapper);
      if (sidx !== -1) this._selectedBodies.splice(sidx, 1);
    }
    delete this.bodyMap[wrapper.id];
  };

  PhysicsEngine.prototype.clearBodies = function() {
    for (var i = this.bodies.length - 1; i >= 0; i--) {
      this.world.destroyBody(this.bodies[i].body);
    }
    this.bodies = [];
    this.bodyMap = {};
    if (this._selectedBodies) this._selectedBodies = [];
  };

  PhysicsEngine.prototype.getBody = function(id) {
    return this.bodyMap[id];
  };

  /**
   * Check if any bodies have a layerIndex (i.e. were imported from comp)
   */
  PhysicsEngine.prototype.hasImportedBodies = function() {
    for (var i = 0; i < this.bodies.length; i++) {
      if (this.bodies[i].layerIndex) return true;
    }
    return false;
  };

  /**
   * Check if any bodies have recorded keyframes
   */
  PhysicsEngine.prototype.hasRecordedKeyframes = function() {
    for (var i = 0; i < this.bodies.length; i++) {
      if (this.bodies[i].recording.length > 0) return true;
    }
    return false;
  };

  // ============================================
  // PARAMETER SETTERS
  // ============================================

  PhysicsEngine.prototype.setGravity = function(value) {
    this.params.gravity = parseFloat(value) || 0;
    this.updateGravity();
  };

  PhysicsEngine.prototype.setGravityAngle = function(degrees) {
    this.params.gravityAngle = parseFloat(degrees) || 90;
    this.updateGravity();
  };

  PhysicsEngine.prototype.setBounce = function(value) {
    this.params.bounce = Math.max(0, Math.min(1, parseFloat(value) || 0));
    this._updateAllFixtures('restitution', this.params.bounce);
  };

  PhysicsEngine.prototype.setFriction = function(value) {
    this.params.friction = Math.max(0, Math.min(1, parseFloat(value) || 0));
    this._updateAllFixtures('friction', this.params.friction);
  };

  PhysicsEngine.prototype.setAirResistance = function(value) {
    this.params.airResistance = Math.max(0, Math.min(1, parseFloat(value) || 0));
    for (var i = 0; i < this.bodies.length; i++) {
      this.bodies[i].body.setLinearDamping(this.params.airResistance * 10);
    }
  };

  PhysicsEngine.prototype.setAngularDrag = function(value) {
    this.params.angularDrag = Math.max(0, Math.min(1, parseFloat(value) || 0));
    for (var i = 0; i < this.bodies.length; i++) {
      this.bodies[i].body.setAngularDamping(this.params.angularDrag * 10);
    }
  };

  PhysicsEngine.prototype._updateAllFixtures = function(property, value) {
    for (var i = 0; i < this.bodies.length; i++) {
      var body = this.bodies[i].body;
      for (var fixture = body.getFixtureList(); fixture; fixture = fixture.getNext()) {
        if (property === 'restitution') {
          fixture.setRestitution(value);
        } else if (property === 'friction') {
          fixture.setFriction(value);
        } else if (property === 'density') {
          fixture.setDensity(value);
          body.resetMassData();
        }
      }
    }
  };

  // ============================================
  // PRESETS
  // ============================================

  PhysicsEngine.GRAVITY_PRESETS = {
    earth: { gravity: 9.8, label: 'Earth', icon: 'ÃƒÂ°Ã…Â¸Ã…â€™Ã‚Â' },
    moon: { gravity: 1.62, label: 'Moon', icon: 'ÃƒÂ°Ã…Â¸Ã…â€™Ã¢â€žÂ¢' },
    mars: { gravity: 3.72, label: 'Mars', icon: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â´' },
    jupiter: { gravity: 24.79, label: 'Jupiter', icon: 'ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â¤' },
    space: { gravity: 0, label: 'Space', icon: 'ÃƒÂ°Ã…Â¸Ã…Â¡Ã¢â€šÂ¬' }
  };

  PhysicsEngine.MATERIAL_PRESETS = {
    rubber: { bounce: 0.9, friction: 0.8, label: 'Rubber', icon: 'ÃƒÂ°Ã…Â¸Ã¢â‚¬ÂÃ‚Â´' },
    tennis: { bounce: 0.75, friction: 0.6, label: 'Tennis', icon: 'ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â¾' },
    bowling: { bounce: 0.3, friction: 0.4, label: 'Bowling', icon: 'ÃƒÂ°Ã…Â¸Ã…Â½Ã‚Â³' },
    steel: { bounce: 0.6, friction: 0.2, label: 'Steel', icon: 'ÃƒÂ¢Ã…Â¡Ã‚Âª' },
    dead: { bounce: 0.1, friction: 0.9, label: 'Dead', icon: 'ÃƒÂ°Ã…Â¸Ã…Â¸Ã‚Â¤' }
  };

  PhysicsEngine.prototype.applyGravityPreset = function(presetName) {
    var preset = PhysicsEngine.GRAVITY_PRESETS[presetName];
    if (preset) {
      this.setGravity(preset.gravity);
      return preset;
    }
    return null;
  };

  PhysicsEngine.prototype.applyMaterialPreset = function(presetName) {
    var preset = PhysicsEngine.MATERIAL_PRESETS[presetName];
    if (preset) {
      this.setBounce(preset.bounce);
      this.setFriction(preset.friction);
      return preset;
    }
    return null;
  };

  // ============================================
  // SIMULATION CONTROL
  // ============================================

  PhysicsEngine.prototype.step = function(dt) {
    dt = dt || DEFAULT_TIMESTEP;

    // Clamp dt to prevent instability
    dt = Math.min(dt, 1/30);

    // Drive kinematic bodies from their keyframes before physics step
    for (var k = 0; k < this.bodies.length; k++) {
      this.bodies[k].updateKinematic(this.simulationTime);
    }

    // Apply attractor/repeller forces to dynamic bodies
    for (var a = 0; a < this.bodies.length; a++) {
      var att = this.bodies[a];
      if (!att.isAttractor) continue;

      var attPos = att.body.getPosition();
      var radiusM = pixelsToMeters(att.attractorRadius);
      var strength = att.attractorStrength;

      for (var d = 0; d < this.bodies.length; d++) {
        var dyn = this.bodies[d];
        if (dyn.bodyType !== 'dynamic') continue;

        var dynPos = dyn.body.getPosition();
        var dx = attPos.x - dynPos.x;
        var dy = attPos.y - dynPos.y;
        var distSq = dx * dx + dy * dy;
        var dist = Math.sqrt(distSq);

        if (dist < 0.001 || dist > radiusM) continue;

        // Normalize direction
        var nx = dx / dist;
        var ny = dy / dist;

        // Calculate force magnitude based on falloff
        var forceMag;
        if (att.attractorFalloff === 'linear') {
          forceMag = strength * (1 - dist / radiusM);
        } else { // inverseSquare
          forceMag = strength / (distSq + 0.01);
          forceMag = Math.min(forceMag, Math.abs(strength) * 50);
        }

        // Explicitly wake sleeping bodies so force takes effect
        if (!dyn.body.isAwake()) dyn.body.setAwake(true);
        dyn.body.applyForce(
          Vec2(nx * forceMag, ny * forceMag),
          dyn.body.getWorldCenter()
        );
      }
    }

    this.world.step(dt, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    this.simulationTime += dt;
    
    // Record frames if recording
    if (this.isRecording) {
      for (var i = 0; i < this.bodies.length; i++) {
        this.bodies[i].recordFrame(this.simulationTime);
      }
      
      // Stop recording if max duration reached
      if (this.simulationTime - this.recordingStartTime >= this.maxRecordingDuration) {
        this.stopRecording();
      }
    }
  };

  PhysicsEngine.prototype.drop = function() {
    // Stop playback if active
    if (this.isPlayingBack) this.stopPlayback();

    // Reset all bodies to initial positions
    for (var i = 0; i < this.bodies.length; i++) {
      this.bodies[i].reset();
    }
    this.simulationTime = 0;

    // Wake up all bodies
    for (var body = this.world.getBodyList(); body; body = body.getNext()) {
      body.setAwake(true);
    }

    // Auto-record so keyframes are always available for export
    this.startRecording({ maxDuration: this.maxRecordingDuration });

    if (!this.isRunning) {
      this.start();
    }
  };

  PhysicsEngine.prototype.reset = function() {
    this.stop();
    if (this.isPlayingBack) this.stopPlayback();
    this.simulationTime = 0;
    // Reset all bodies to their initial positions (preserves imported shapes)
    for (var i = 0; i < this.bodies.length; i++) {
      this.bodies[i].reset();
    }
    this._draw();
  };

  /**
   * Hard reset: clear everything and recreate default bodies.
   * Used by the explicit "Reset" button, not by Stop.
   */
  PhysicsEngine.prototype.hardReset = function() {
    this.stop();
    if (this.isPlayingBack) this.stopPlayback();
    this.simulationTime = 0;
    this._createDefaultBodies();
    this._draw();
  };

  PhysicsEngine.prototype.start = function() {
    if (this.isRunning) return;

    // Auto-record if not already recording
    if (!this.isRecording) {
      this.startRecording({ maxDuration: this.maxRecordingDuration });
    }

    this.isRunning = true;
    this.lastTime = performance.now();
    this._loop();
  };

  PhysicsEngine.prototype.stop = function() {
    this.isRunning = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  };

  PhysicsEngine.prototype._loop = function() {
    if (!this.isRunning) return;
    
    var self = this;
    this.animationId = requestAnimationFrame(function(time) {
      var dt = (time - self.lastTime) / 1000;
      self.lastTime = time;
      
      self.step(dt);
      self._draw();
      self._loop();
    });
  };

  // ============================================
  // RECORDING & EXPORT
  // ============================================

  PhysicsEngine.prototype.startRecording = function(options) {
    options = options || {};
    
    this.isRecording = true;
    this.recordingStartTime = this.simulationTime;
    this.maxRecordingDuration = options.maxDuration || 10;
    
    for (var i = 0; i < this.bodies.length; i++) {
      this.bodies[i].startRecording();
    }
  };

  PhysicsEngine.prototype.stopRecording = function() {
    this.isRecording = false;

    for (var i = 0; i < this.bodies.length; i++) {
      this.bodies[i].stopRecording();
    }
  };

  // ============================================
  // PLAYBACK (replay recorded keyframes visually)
  // ============================================

  PhysicsEngine.prototype.startPlayback = function() {
    if (!this.hasRecordedKeyframes()) return false;

    // Stop any running simulation
    if (this.isRunning) this.stop();

    this.isPlayingBack = true;
    this.playbackTime = 0;
    this.playbackDuration = this._getRecordingDuration();
    this.lastTime = performance.now();
    this._playbackLoop();
    return true;
  };

  PhysicsEngine.prototype.stopPlayback = function() {
    this.isPlayingBack = false;
    if (this._playbackAnimId) {
      cancelAnimationFrame(this._playbackAnimId);
      this._playbackAnimId = null;
    }
  };

  PhysicsEngine.prototype._getRecordingDuration = function() {
    var maxDuration = 0;
    for (var i = 0; i < this.bodies.length; i++) {
      var kf = this.bodies[i].recording;
      if (kf.length > 0 && kf[kf.length - 1].time > maxDuration) {
        maxDuration = kf[kf.length - 1].time;
      }
    }
    return maxDuration;
  };

  PhysicsEngine.prototype._playbackLoop = function() {
    if (!this.isPlayingBack) return;

    var self = this;
    this._playbackAnimId = requestAnimationFrame(function(time) {
      var dt = (time - self.lastTime) / 1000;
      self.lastTime = time;
      self.playbackTime += dt;

      // Loop playback
      if (self.playbackTime >= self.playbackDuration) {
        self.playbackTime = 0;
      }

      // Set each body to its recorded position at playbackTime
      self._applyPlaybackFrame(self.playbackTime);
      self._draw();

      // Draw playback indicator
      self._drawPlaybackIndicator();

      self._playbackLoop();
    });
  };

  PhysicsEngine.prototype._applyPlaybackFrame = function(time) {
    for (var i = 0; i < this.bodies.length; i++) {
      var wrapper = this.bodies[i];
      var kf = wrapper.recording;
      if (kf.length === 0) continue;

      // Binary search for the right keyframe interval
      var lo = 0, hi = kf.length - 1;
      if (time <= kf[0].time) {
        this._setBodyTransform(wrapper, kf[0].x, kf[0].y, kf[0].rotation);
        continue;
      }
      if (time >= kf[hi].time) {
        this._setBodyTransform(wrapper, kf[hi].x, kf[hi].y, kf[hi].rotation);
        continue;
      }

      // Find bracketing keyframes
      while (hi - lo > 1) {
        var mid = (lo + hi) >> 1;
        if (kf[mid].time <= time) lo = mid;
        else hi = mid;
      }

      // Lerp between lo and hi
      var t = (time - kf[lo].time) / (kf[hi].time - kf[lo].time);
      var x = kf[lo].x + (kf[hi].x - kf[lo].x) * t;
      var y = kf[lo].y + (kf[hi].y - kf[lo].y) * t;
      var rot = kf[lo].rotation + (kf[hi].rotation - kf[lo].rotation) * t;
      this._setBodyTransform(wrapper, x, y, rot);
    }
  };

  PhysicsEngine.prototype._setBodyTransform = function(wrapper, x, y, angleDeg) {
    var angleRad = angleDeg * (Math.PI / 180);
    wrapper.body.setPosition(Vec2(pixelsToMeters(x), pixelsToMeters(y)));
    wrapper.body.setAngle(angleRad);
    wrapper.body.setLinearVelocity(Vec2(0, 0));
    wrapper.body.setAngularVelocity(0);
  };

  PhysicsEngine.prototype._drawPlaybackIndicator = function() {
    var ctx = this.ctx;
    var w = this.width;

    // Progress bar at bottom
    var barY = this.height - 6;
    var barH = 3;
    var progress = this.playbackDuration > 0 ? this.playbackTime / this.playbackDuration : 0;

    // Background track
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(8, barY, w - 16, barH);

    // Progress fill
    ctx.fillStyle = 'rgba(128, 19, 54, 0.9)';
    ctx.fillRect(8, barY, (w - 16) * progress, barH);

    // Playback label
    var x = this.width - 42;
    var y = this.height - 18;
    ctx.fillStyle = 'rgba(128, 19, 54, 0.9)';
    ctx.beginPath();
    // Play triangle icon
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.lineTo(x + 7, y);
    ctx.closePath();
    ctx.fill();

    ctx.font = '600 9px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(this.playbackTime.toFixed(1) + 's', x + 10, y + 3);
  };

  PhysicsEngine.prototype.exportKeyframes = function(options) {
    options = options || {};
    var frameRate = options.frameRate || this.frameRate;
    var compWidth = options.compWidth || 1920;
    var compHeight = options.compHeight || 1080;
    
    // Scale factors to map preview canvas to composition
    var scaleX = compWidth / this.width;
    var scaleY = compHeight / this.height;
    
    var result = {
      frameRate: frameRate,
      duration: 0,
      bodies: []
    };
    
    for (var i = 0; i < this.bodies.length; i++) {
      var wrapper = this.bodies[i];

      // Skip kinematic bodies and attractors — they don't produce movement keyframes
      if (wrapper.bodyType === 'kinematic' || wrapper.isAttractor) continue;

      var keyframes = wrapper.getKeyframes();

      if (keyframes.length === 0) continue;
      
      // Calculate duration
      var maxTime = keyframes[keyframes.length - 1].time;
      if (maxTime > result.duration) {
        result.duration = maxTime;
      }
      
      // Convert keyframes to After Effects format
      var positionKeyframes = [];
      var rotationKeyframes = [];
      
      for (var j = 0; j < keyframes.length; j++) {
        var kf = keyframes[j];
        
        positionKeyframes.push({
          time: kf.time,
          value: [kf.x * scaleX, kf.y * scaleY]
        });
        
        rotationKeyframes.push({
          time: kf.time,
          value: kf.rotation
        });
      }
      
      result.bodies.push({
        id: wrapper.id,
        name: wrapper.name,
        layerIndex: wrapper.layerIndex,
        shapeType: wrapper.shapeType,
        color: wrapper.color,
        width: wrapper.width * scaleX,
        height: wrapper.height * scaleY,
        radius: wrapper.radius * Math.min(scaleX, scaleY),
        position: positionKeyframes,
        rotation: rotationKeyframes
      });
    }
    
    return result;
  };

  /**
   * Run simulation for specified duration and export keyframes
   * This can be called without visual preview for batch processing
   */
  PhysicsEngine.prototype.simulateAndExport = function(duration, options) {
    options = options || {};
    var frameRate = options.frameRate || 60;
    var dt = 1 / frameRate;
    
    // Reset simulation
    for (var i = 0; i < this.bodies.length; i++) {
      this.bodies[i].reset();
    }
    this.simulationTime = 0;
    
    // Start recording
    this.startRecording({ maxDuration: duration + 1 });
    
    // Run simulation
    var totalFrames = Math.ceil(duration * frameRate);
    for (var f = 0; f <= totalFrames; f++) {
      this.step(dt);
    }
    
    // Stop recording and export
    this.stopRecording();
    return this.exportKeyframes(options);
  };

  // ============================================
  // RENDERING
  // ============================================

  PhysicsEngine.prototype._draw = function() {
    var ctx = this.ctx;
    var w = this.width;
    var h = this.height;
    
    // Clear with dark background
    ctx.fillStyle = '#232323';
    ctx.fillRect(0, 0, w, h);

    // --- Begin world-space rendering (affected by viewport zoom) ---
    ctx.save();
    ctx.translate(this._viewportOffsetX, this._viewportOffsetY);
    ctx.scale(this._viewportScale, this._viewportScale);

    // Center cross (full width/height like motion path)
    var cx = w / 2;
    var cy = h / 2;
    ctx.strokeStyle = '#3a3a40';
    ctx.lineWidth = 1 / this._viewportScale; // keep 1px visual width

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();

    // Boundary lines (thin, uniform) — dashed when walls are off
    ctx.strokeStyle = this.wallsEnabled ? '#3a3a3a' : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1 / this._viewportScale;
    if (!this.wallsEnabled) ctx.setLineDash([6, 6]);
    ctx.strokeRect(this.bounds.left, this.bounds.top, this.bounds.right - this.bounds.left, this.bounds.bottom - this.bounds.top);
    if (!this.wallsEnabled) ctx.setLineDash([]);

    // Bodies
    for (var i = 0; i < this.bodies.length; i++) {
      this._drawBody(this.bodies[i]);
    }

    // Wall drawing preview
    if (this._wallDraw.active && this._wallDraw.startPoint && this._wallDraw.previewEnd) {
      var sp = this._wallDraw.startPoint;
      var ep = this._wallDraw.previewEnd;
      ctx.strokeStyle = 'rgba(128, 19, 54, 0.7)';
      ctx.lineWidth = this._wallDraw.wallThickness;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(ep.x, ep.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Endpoint dots
      ctx.fillStyle = '#C72C41';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ep.x, ep.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Marquee selection rectangle (rubber band). Drawn in world space so it
    // stays anchored to the bodies while the user pans/zooms mid-drag.
    if (this._marquee.active) {
      var mx = Math.min(this._marquee.startX, this._marquee.endX);
      var my = Math.min(this._marquee.startY, this._marquee.endY);
      var mw = Math.abs(this._marquee.endX - this._marquee.startX);
      var mh = Math.abs(this._marquee.endY - this._marquee.startY);
      ctx.fillStyle = 'rgba(128, 19, 54, 0.12)';
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = 'rgba(128, 19, 54, 0.5)';
      // Compensate for viewport zoom so the outline stays 1px visually
      ctx.lineWidth = 1 / (this._viewportScale || 1);
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.setLineDash([]);
    }

    // --- End world-space rendering ---
    ctx.restore();

    // Gravity indicator (canvas-space, unaffected by viewport zoom)
    this._drawGravityIndicator();
    
    // Parameter overlay
    this._drawOverlay();
    
    // Recording indicator
    if (this.isRecording) {
      this._drawRecordingIndicator();
    }
  };

  PhysicsEngine.prototype._drawBody = function(wrapper) {
    var ctx = this.ctx;
    var pos = wrapper.getPosition();
    var angle = degreesToRadians(wrapper.getAngle());
    var isHovered = (wrapper === this._bodyDrag.hoverBody);
    var isDragged = (wrapper === this._bodyDrag.activeBody);
    var bt = wrapper.bodyType;

    // Render mode: 'fill' (default), 'stroke' (outline only), 'both' (fill + outline).
    // Dragged bodies always render filled in the drag color so the drag is visible
    // even on stroke-only bodies (e.g. imported walls).
    var renderMode = wrapper.renderMode || 'fill';
    var doFill = isDragged || renderMode !== 'stroke';
    var doStroke = !isDragged && (renderMode === 'stroke' || renderMode === 'both');
    var fillColor = isDragged ? '#a01a46' : wrapper.color;
    var bodyStrokeColor = wrapper.strokeColor || wrapper.color;
    var bodyStrokeWidth = wrapper.strokeWidth || 2;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);

    ctx.fillStyle = fillColor;
    if (doStroke) {
      ctx.strokeStyle = bodyStrokeColor;
      ctx.lineWidth = bodyStrokeWidth;
    }

    if (wrapper.shapeType === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, wrapper.radius, 0, Math.PI * 2);
      if (doFill) ctx.fill();
      if (doStroke) ctx.stroke();

      // Rotation indicator
      ctx.strokeStyle = doStroke ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(wrapper.radius * 0.7, 0);
      ctx.stroke();
    } else if (wrapper.shapeType === 'rectangle') {
      var hw = wrapper.width / 2;
      var hh = wrapper.height / 2;
      if (doFill) ctx.fillRect(-hw, -hh, wrapper.width, wrapper.height);
      if (doStroke) ctx.strokeRect(-hw, -hh, wrapper.width, wrapper.height);

      // Rotation indicator
      ctx.strokeStyle = doStroke ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(hw * 0.7, 0);
      ctx.stroke();
    } else if (wrapper.shapeType === 'polygon') {
      // Use original vertices for visual fidelity if available,
      // otherwise fall back to Planck's convex hull vertices
      var renderVerts;
      if (wrapper.vertices && wrapper.vertices.length > 0) {
        renderVerts = [];
        for (var ov = 0; ov < wrapper.vertices.length; ov++) {
          var origV = wrapper.vertices[ov];
          renderVerts.push({
            x: origV.x !== undefined ? origV.x : origV[0],
            y: origV.y !== undefined ? origV.y : origV[1]
          });
        }
      } else {
        var body = wrapper.body;
        var fixture = body.getFixtureList();
        if (fixture) {
          var shape = fixture.getShape();
          renderVerts = [];
          for (var pv = 0; pv < shape.m_count; pv++) {
            var v = shape.m_vertices[pv];
            renderVerts.push({
              x: metersToPixels(v.x),
              y: metersToPixels(v.y)
            });
          }
        }
      }

      if (renderVerts && renderVerts.length > 0) {
        ctx.beginPath();
        ctx.moveTo(renderVerts[0].x, renderVerts[0].y);
        for (var rv = 1; rv < renderVerts.length; rv++) {
          ctx.lineTo(renderVerts[rv].x, renderVerts[rv].y);
        }
        ctx.closePath();
        if (doFill) ctx.fill();
        if (doStroke) ctx.stroke();
      }
    }

    // Attractor overlay — drawn on top of any shape when isAttractor is true
    if (wrapper.isAttractor) {
      var attracting = wrapper.attractorStrength >= 0;
      var attColor = attracting ? '#22AAE1' : '#EE4540';

      // Influence radius fill
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = attColor;
      ctx.beginPath();
      ctx.arc(0, 0, wrapper.attractorRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Influence radius ring (dashed)
      ctx.strokeStyle = attColor;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, wrapper.attractorRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Kinematic bodies get a double-dashed ring to signal they're being
    // driven by imported keyframes rather than the physics solver.
    // Dynamic and static bodies have no ring — dynamic bodies are the
    // default and don't need one, static bodies tend to be walls or
    // containers whose shape alone already conveys the role.
    var boundingR = wrapper.getBoundingRadius();
    if (bt === 'kinematic') {
      ctx.strokeStyle = 'rgba(34, 170, 225, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.arc(0, 0, boundingR + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, boundingR + 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Hover / drag / selection ring (drawn in local rotated space).
    // Selection uses a solid ring so it's visually distinct from the dashed
    // hover hint — once you've selected something, you want to see it.
    var isSelected = this._selectedBodies.indexOf(wrapper) >= 0;
    if ((isHovered || isDragged || isSelected) && !this.isRunning) {
      ctx.rotate(-angle); // undo rotation for a clean ring
      ctx.beginPath();
      ctx.arc(0, 0, boundingR + 4, 0, Math.PI * 2);
      ctx.strokeStyle = isDragged ? 'rgba(160, 26, 70, 0.8)' :
                        isSelected ? 'rgba(128, 19, 54, 0.7)' :
                        'rgba(128, 19, 54, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash(isSelected ? [] : [3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  };

  // Gravity indicator removed — gravity direction is controlled via the
  // knobs below the canvas. The draw function is a no-op.
  PhysicsEngine.prototype._drawGravityIndicator = function() {};

  // ============================================
  // CANVAS INTERACTION (gravity indicator + body drag)
  // ============================================

  PhysicsEngine.prototype._initCanvasInteraction = function() {
    var self = this;
    var gi = this._gravityIndicator;
    var bd = this._bodyDrag;
    var canvas = this.canvas;

    function getCanvasPos(e) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left),
        y: (e.clientY - rect.top)
      };
    }

    // Convert canvas-space position to world-space (inverse viewport transform)
    function canvasToWorld(canvasPos) {
      return {
        x: (canvasPos.x - self._viewportOffsetX) / self._viewportScale,
        y: (canvasPos.y - self._viewportOffsetY) / self._viewportScale
      };
    }

    // --- Gravity indicator helpers ---
    // Gravity indicator removed — gravity direction is controlled via the
    // knobs below the canvas. The hit-test always returns false so the
    // dead zone doesn't swallow clicks.
    function isInsideIndicator() {
      return false;
    }

    function angleFromCenter(pos) {
      var dx = pos.x - gi.cx;
      var dy = pos.y - gi.cy;
      var rad = Math.atan2(dy, dx);
      var deg = rad * (180 / Math.PI);
      if (deg < 0) deg += 360;
      return deg;
    }

    function snapAngle(deg) {
      var snaps = [0, 90, 180, 270, 360];
      for (var i = 0; i < snaps.length; i++) {
        if (Math.abs(deg - snaps[i]) < 8) return snaps[i] % 360;
      }
      return deg;
    }

    // --- Body hit-testing ---
    // Bounding-circle point-in-body test. Shared by bodyAtPos, allBodiesAtPos,
    // and the mousedown/contextmenu handlers so hit behavior stays consistent.
    function _hitTestBody(w, pos) {
      var bp = w.getPosition();
      var dx = pos.x - bp.x;
      var dy = pos.y - bp.y;
      var distSq = dx * dx + dy * dy;
      if (w.shapeType === 'circle') {
        return distSq <= w.radius * w.radius;
      } else if (w.shapeType === 'rectangle') {
        // Rough AABB-ignoring diagonal — matches previous behavior
        var r = Math.max(w.width, w.height) / 2 * 1.42;
        return distSq <= r * r;
      } else {
        var pr = (w.radius || 20) * 1.1;
        return distSq <= pr * pr;
      }
    }

    function bodyAtPos(pos) {
      // Two passes: prefer non-attractors (attractors often cover a large area
      // so they'd otherwise swallow clicks on bodies sitting inside them).
      var fallbackAttractor = null;
      for (var i = self.bodies.length - 1; i >= 0; i--) {
        var w = self.bodies[i];
        if (_hitTestBody(w, pos)) {
          if (!w.isAttractor) return w;
          if (!fallbackAttractor) fallbackAttractor = w;
        }
      }
      return fallbackAttractor;
    }

    // Return ALL bodies under the cursor, topmost-first. Used by the right-click
    // picker menu so you can grab a body buried underneath other overlapping ones.
    function allBodiesAtPos(pos) {
      var hits = [];
      for (var i = self.bodies.length - 1; i >= 0; i--) {
        if (_hitTestBody(self.bodies[i], pos)) {
          hits.push(self.bodies[i]);
        }
      }
      return hits;
    }

    // Bodies whose center falls inside an axis-aligned rect. Used by marquee drag.
    function bodiesInRect(x1, y1, x2, y2) {
      var minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
      var minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
      var result = [];
      for (var i = 0; i < self.bodies.length; i++) {
        var bp = self.bodies[i].getPosition();
        if (bp.x >= minX && bp.x <= maxX && bp.y >= minY && bp.y <= maxY) {
          result.push(self.bodies[i]);
        }
      }
      return result;
    }

    // --- Pan state (Cmd+drag hand tool) ---
    var pan = { active: false, startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 };

    // --- Cursor management ---
    function updateCursor() {
      if (pan.active) { canvas.style.cursor = 'grabbing'; return; }
      if (self._wallDraw.active) { canvas.style.cursor = 'crosshair'; return; }
      if (gi.isDragging) { canvas.style.cursor = 'grab'; return; }
      if (bd.activeBody) { canvas.style.cursor = 'grabbing'; return; }
      if (gi.isHovering) { canvas.style.cursor = 'grab'; return; }
      if (bd.hoverBody) { canvas.style.cursor = 'grab'; return; }
      canvas.style.cursor = '';
    }

    // === MOUSEDOWN ===
    canvas.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      var pos = getCanvasPos(e);
      var worldPos = canvasToWorld(pos);

      // Priority -1: Cmd/Ctrl+drag pan (hand tool, only when walls off)
      if ((e.metaKey || e.ctrlKey) && !self.wallsEnabled) {
        e.preventDefault();
        e.stopPropagation();
        pan.active = true;
        pan.startX = pos.x;
        pan.startY = pos.y;
        pan.startOffsetX = self._viewportOffsetX;
        pan.startOffsetY = self._viewportOffsetY;
        updateCursor();
        return;
      }

      // Priority 0: wall drawing mode (world space)
      if (self._wallDraw.active && !self.isRunning) {
        e.preventDefault();
        e.stopPropagation();
        if (!self._wallDraw.startPoint) {
          self._wallDraw.startPoint = { x: worldPos.x, y: worldPos.y };
          self._wallDraw.previewEnd = { x: worldPos.x, y: worldPos.y };
        } else {
          var wsp = self._wallDraw.startPoint;
          self.addWall(wsp.x, wsp.y, worldPos.x, worldPos.y);
          self._wallDraw.startPoint = null;
          self._wallDraw.previewEnd = null;
          if (self.onBodiesChanged) self.onBodiesChanged();
        }
        self._draw();
        return;
      }

      // Priority 1: gravity indicator (canvas space — UI overlay)
      if (isInsideIndicator(pos)) {
        e.preventDefault();
        e.stopPropagation();
        gi.isDragging = true;
        self.setGravityAngle(snapAngle(angleFromCenter(pos)));
        if (!self.isRunning) self._draw();
        updateCursor();
        return;
      }

      // Priority 2: select / drag a body, or start a marquee selection
      // (world space, only when simulation is stopped)
      if (!self.isRunning) {
        var hit = bodyAtPos(worldPos);
        if (hit) {
          e.preventDefault();
          e.stopPropagation();

          // Shift+click toggles membership in the selection without starting a drag
          if (e.shiftKey) {
            var idx = self._selectedBodies.indexOf(hit);
            if (idx >= 0) {
              self._selectedBodies.splice(idx, 1);
            } else {
              self._selectedBodies.push(hit);
            }
            self._draw();
            return;
          }

          // Plain click: start dragging. If the click target isn't already part
          // of the selection, collapse the selection to just this body so the
          // drag feels like a direct manipulation of the clicked shape.
          var bp = hit.getPosition();
          bd.activeBody = hit;
          bd.offsetX = worldPos.x - bp.x;
          bd.offsetY = worldPos.y - bp.y;
          if (self._selectedBodies.indexOf(hit) < 0) {
            self._selectedBodies = [hit];
          }
          updateCursor();
          self._draw();
          return;
        }

        // Empty space — start a marquee drag. Shift preserves existing
        // selection so marquee adds to it; plain drag replaces it.
        e.preventDefault();
        self._marquee.active = true;
        self._marquee.startX = worldPos.x;
        self._marquee.startY = worldPos.y;
        self._marquee.endX = worldPos.x;
        self._marquee.endY = worldPos.y;
        if (!e.shiftKey && self._selectedBodies.length > 0) {
          self._selectedBodies = [];
          self._draw();
        }
      }
    });

    // === MOUSEMOVE ===
    canvas.addEventListener('mousemove', function(e) {
      var pos = getCanvasPos(e);
      var worldPos = canvasToWorld(pos);

      // Pan drag (canvas space)
      if (pan.active) {
        e.preventDefault();
        self._viewportOffsetX = pan.startOffsetX + (pos.x - pan.startX);
        self._viewportOffsetY = pan.startOffsetY + (pos.y - pan.startY);
        self._draw();
        return;
      }

      // Wall drawing preview (world space)
      if (self._wallDraw.active && self._wallDraw.startPoint) {
        self._wallDraw.previewEnd = worldPos;
        if (!self.isRunning) self._draw();
        return;
      }

      // Marquee drag (world space) — rubber-band rectangle
      if (self._marquee.active) {
        e.preventDefault();
        self._marquee.endX = worldPos.x;
        self._marquee.endY = worldPos.y;
        self._draw();
        return;
      }

      // Active gravity drag (canvas space — UI overlay)
      if (gi.isDragging) {
        e.preventDefault();
        self.setGravityAngle(snapAngle(angleFromCenter(pos)));
        if (!self.isRunning) self._draw();
        return;
      }

      // Active body drag (world space)
      if (bd.activeBody) {
        e.preventDefault();
        var nx = worldPos.x - bd.offsetX;
        var ny = worldPos.y - bd.offsetY;
        // Clamp within bounds (only when walls are enabled)
        if (self.wallsEnabled) {
          nx = Math.max(self.bounds.left + 5, Math.min(self.bounds.right - 5, nx));
          ny = Math.max(self.bounds.top + 5, Math.min(self.bounds.bottom - 5, ny));
        }
        bd.activeBody.setPosition(nx, ny);
        bd.activeBody.setLinearVelocity(0, 0);
        // Update initial state so reset puts the body here
        var mPos = bd.activeBody.body.getPosition();
        bd.activeBody.initialState.x = mPos.x;
        bd.activeBody.initialState.y = mPos.y;
        bd.activeBody.initialState.vx = 0;
        bd.activeBody.initialState.vy = 0;
        self._draw();
        return;
      }

      // Hover detection — gravity indicator in canvas space, bodies in world space
      var wasGiHover = gi.isHovering;
      var wasBodyHover = bd.hoverBody;

      gi.isHovering = isInsideIndicator(pos);
      bd.hoverBody = (!gi.isHovering && !self.isRunning) ? bodyAtPos(worldPos) : null;

      if (gi.isHovering !== wasGiHover || bd.hoverBody !== wasBodyHover) {
        updateCursor();
        if (!self.isRunning) self._draw();
      }
    });

    // === MOUSEUP ===
    function onMouseUp(e) {
      var needRedraw = false;

      // Finalize marquee selection. Only treat it as a real marquee if the
      // user dragged more than a tiny threshold — otherwise a plain click on
      // empty space would be interpreted as a zero-size box.
      if (self._marquee.active) {
        self._marquee.active = false;
        var mx1 = self._marquee.startX, my1 = self._marquee.startY;
        var mx2 = self._marquee.endX, my2 = self._marquee.endY;
        var mdx = mx2 - mx1, mdy = my2 - my1;
        if (mdx * mdx + mdy * mdy > 25) {
          var hits = bodiesInRect(mx1, my1, mx2, my2);
          if (e && e.shiftKey) {
            // Shift+marquee adds to existing selection without de-duping pain
            for (var h = 0; h < hits.length; h++) {
              if (self._selectedBodies.indexOf(hits[h]) < 0) {
                self._selectedBodies.push(hits[h]);
              }
            }
          } else {
            self._selectedBodies = hits;
          }
        }
        needRedraw = true;
      }

      if (pan.active) {
        pan.active = false;
        needRedraw = true;
      }

      if (gi.isDragging) {
        gi.isDragging = false;
        needRedraw = true;
        if (self.onGravityAngleChange) {
          self.onGravityAngleChange(self.params.gravityAngle);
        }
      }

      if (bd.activeBody) {
        bd.activeBody = null;
        needRedraw = true;
        // Notify host that bodies changed position
        if (self.onBodiesChanged) self.onBodiesChanged();
      }

      if (needRedraw) {
        updateCursor();
        if (!self.isRunning) self._draw();
      }
    }

    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', function() {
      gi.isHovering = false;
      bd.hoverBody = null;
      if (gi.isDragging || bd.activeBody || self._marquee.active) {
        onMouseUp(null);
      } else {
        canvas.style.cursor = '';
        if (!self.isRunning) self._draw();
      }
    });

    // === RIGHT-CLICK context menu ===
    // Three cases:
    //   - click on a stack of overlapping bodies: show picker so the user can
    //     grab the one underneath instead of defaulting to the topmost
    //   - click on a body that's part of a multi-selection: show multi-body menu
    //   - click on a single body: show single-body menu
    //   - click on empty space: show canvas menu
    canvas.addEventListener('contextmenu', function(e) {
      if (self.isRunning) return;
      var pos = getCanvasPos(e);
      var worldPos = canvasToWorld(pos);
      if (isInsideIndicator(pos)) return;
      e.preventDefault();

      var allHits = allBodiesAtPos(worldPos);

      if (allHits.length > 1) {
        // Overlapping bodies — let the user pick which one to operate on
        self._showBodyPickerMenu(e, allHits);
      } else if (allHits.length === 1) {
        var hit = allHits[0];
        var sel = self._selectedBodies;
        if (sel.length > 1 && sel.indexOf(hit) >= 0) {
          // Right-clicked inside an existing multi-selection — batch menu
          self._showMultiBodyContextMenu(e, sel.slice());
        } else {
          self._showBodyContextMenu(e, hit);
        }
      } else {
        self._showCanvasContextMenu(e);
      }
    });

    // === CMD+SCROLL ZOOM ===
    canvas.addEventListener('wheel', function(e) {
      // Only zoom when Cmd (Mac) or Ctrl (Win) is held
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();

      // Only allow zoom when walls are off
      if (self.wallsEnabled) return;

      var pos = getCanvasPos(e);
      // World position under cursor before zoom
      var worldX = (pos.x - self._viewportOffsetX) / self._viewportScale;
      var worldY = (pos.y - self._viewportOffsetY) / self._viewportScale;

      // Zoom factor: scroll up = zoom in, scroll down = zoom out
      var zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
      var newZoom = (self._userZoom || 1.0) * zoomDelta;

      // Clamp zoom to reasonable range
      newZoom = Math.max(0.15, Math.min(3.0, newZoom));
      self._userZoom = newZoom;

      // Update viewport keeping cursor position stable
      self._viewportScale = newZoom;
      self._viewportOffsetX = pos.x - worldX * newZoom;
      self._viewportOffsetY = pos.y - worldY * newZoom;

      self._draw();
    }, { passive: false });
  };

  // ============================================
  // BODY CONTEXT MENU
  // ============================================

  PhysicsEngine.prototype._showBodyContextMenu = function(e, wrapper) {
    var self = this;
    // Remove any existing menu
    this._dismissContextMenu();

    var menu = document.createElement('div');
    menu.className = 'context-menu physics-body-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    // Title
    var title = document.createElement('div');
    title.className = 'context-menu-title';
    title.textContent = wrapper.name;
    menu.appendChild(title);

    // Body type options
    var types = [
      { id: 'dynamic', label: 'Dynamic' },
      { id: 'static', label: 'Static' },
      { id: 'kinematic', label: 'Kinematic' }
    ];

    for (var i = 0; i < types.length; i++) {
      (function(type) {
        var item = document.createElement('button');
        item.className = 'context-menu-item';
        var check = document.createTextNode(wrapper.bodyType === type.id ? '\u2713  ' : '    ');
        var label = document.createTextNode(type.label);
        item.appendChild(check);
        item.appendChild(label);
        if (wrapper.bodyType === type.id) {
          item.style.color = 'var(--accent-primary)';
        }
        item.addEventListener('click', function() {
          wrapper.setBodyType(type.id);
          self._dismissContextMenu();
          self._draw();
          if (self.onBodiesChanged) self.onBodiesChanged();
        });
        menu.appendChild(item);
      })(types[i]);
    }

    // Separator before attractor section
    var sepAtt = document.createElement('div');
    sepAtt.style.borderBottom = '1px solid var(--border-color)';
    sepAtt.style.margin = '4px 0';
    menu.appendChild(sepAtt);

    // Attractor on/off toggle (available for all bodies)
    var attToggle = document.createElement('button');
    attToggle.className = 'context-menu-item';
    attToggle.textContent = (wrapper.isAttractor ? '\u2713  ' : '    ') + 'Attractor';
    if (wrapper.isAttractor) attToggle.style.color = 'var(--accent-primary)';
    attToggle.addEventListener('click', function() {
      wrapper.isAttractor = !wrapper.isAttractor;
      // When turning on, make body static so the attractor stays put
      if (wrapper.isAttractor && wrapper.bodyType === 'dynamic') {
        wrapper.setBodyType('static');
      }
      self._dismissContextMenu();
      self._draw();
      if (self.onBodiesChanged) self.onBodiesChanged();
    });
    menu.appendChild(attToggle);

    // Attractor sub-options (only shown when attractor is enabled)
    if (wrapper.isAttractor) {
      // Attract / Repel toggle
      var attracting = wrapper.attractorStrength >= 0;
      var modeItem = document.createElement('button');
      modeItem.className = 'context-menu-item';
      modeItem.style.paddingLeft = '20px';
      modeItem.textContent = attracting ? '\u2713  Attract' : '    Attract';
      if (attracting) modeItem.style.color = 'var(--accent-primary)';
      modeItem.addEventListener('click', function() {
        if (wrapper.attractorStrength >= 0) {
          wrapper.attractorStrength = -Math.abs(wrapper.attractorStrength);
        }
        self._dismissContextMenu();
        self._draw();
        if (self.onBodiesChanged) self.onBodiesChanged();
      });
      menu.appendChild(modeItem);

      var repelItem = document.createElement('button');
      repelItem.className = 'context-menu-item';
      repelItem.style.paddingLeft = '20px';
      repelItem.textContent = !attracting ? '\u2713  Repel' : '    Repel';
      if (!attracting) repelItem.style.color = 'var(--accent-primary)';
      repelItem.addEventListener('click', function() {
        if (wrapper.attractorStrength <= 0) {
          wrapper.attractorStrength = Math.abs(wrapper.attractorStrength) || 5;
        }
        self._dismissContextMenu();
        self._draw();
        if (self.onBodiesChanged) self.onBodiesChanged();
      });
      menu.appendChild(repelItem);

      // Strength input
      var strengthRow = document.createElement('div');
      strengthRow.className = 'context-menu-item';
      strengthRow.style.display = 'flex';
      strengthRow.style.alignItems = 'center';
      strengthRow.style.justifyContent = 'space-between';
      strengthRow.style.paddingLeft = '20px';
      strengthRow.style.cursor = 'default';
      var strengthLabel = document.createElement('span');
      strengthLabel.textContent = 'Strength';
      strengthLabel.style.marginRight = '8px';
      var strengthInput = document.createElement('input');
      strengthInput.type = 'number';
      strengthInput.value = Math.abs(wrapper.attractorStrength);
      strengthInput.min = '0.1';
      strengthInput.step = '0.5';
      strengthInput.style.width = '56px';
      strengthInput.style.background = 'var(--bg-secondary)';
      strengthInput.style.border = '1px solid var(--border-color)';
      strengthInput.style.color = 'var(--text-primary)';
      strengthInput.style.borderRadius = '3px';
      strengthInput.style.padding = '2px 4px';
      strengthInput.style.fontSize = '11px';
      strengthInput.addEventListener('change', function() {
        var val = parseFloat(this.value) || 5;
        var sign = wrapper.attractorStrength >= 0 ? 1 : -1;
        wrapper.attractorStrength = sign * Math.abs(val);
        self._draw();
        if (self.onBodiesChanged) self.onBodiesChanged();
      });
      strengthInput.addEventListener('click', function(ev) { ev.stopPropagation(); });
      strengthRow.appendChild(strengthLabel);
      strengthRow.appendChild(strengthInput);
      menu.appendChild(strengthRow);

      // Radius input
      var radiusRow = document.createElement('div');
      radiusRow.className = 'context-menu-item';
      radiusRow.style.display = 'flex';
      radiusRow.style.alignItems = 'center';
      radiusRow.style.justifyContent = 'space-between';
      radiusRow.style.paddingLeft = '20px';
      radiusRow.style.cursor = 'default';
      var radiusLabel = document.createElement('span');
      radiusLabel.textContent = 'Radius';
      radiusLabel.style.marginRight = '8px';
      var radiusInput = document.createElement('input');
      radiusInput.type = 'number';
      radiusInput.value = Math.round(wrapper.attractorRadius);
      radiusInput.min = '10';
      radiusInput.step = '10';
      radiusInput.style.width = '56px';
      radiusInput.style.background = 'var(--bg-secondary)';
      radiusInput.style.border = '1px solid var(--border-color)';
      radiusInput.style.color = 'var(--text-primary)';
      radiusInput.style.borderRadius = '3px';
      radiusInput.style.padding = '2px 4px';
      radiusInput.style.fontSize = '11px';
      radiusInput.addEventListener('change', function() {
        wrapper.attractorRadius = Math.max(10, parseFloat(this.value) || 100);
        self._draw();
        if (self.onBodiesChanged) self.onBodiesChanged();
      });
      radiusInput.addEventListener('click', function(ev) { ev.stopPropagation(); });
      radiusRow.appendChild(radiusLabel);
      radiusRow.appendChild(radiusInput);
      menu.appendChild(radiusRow);

      // Falloff toggle
      var falloffTypes = [
        { id: 'inverseSquare', label: 'Inverse Square' },
        { id: 'linear', label: 'Linear' }
      ];
      for (var f = 0; f < falloffTypes.length; f++) {
        (function(fo) {
          var foItem = document.createElement('button');
          foItem.className = 'context-menu-item';
          foItem.style.paddingLeft = '20px';
          var isActive = wrapper.attractorFalloff === fo.id;
          foItem.textContent = (isActive ? '\u2713  ' : '    ') + fo.label;
          if (isActive) foItem.style.color = 'var(--accent-primary)';
          foItem.addEventListener('click', function() {
            wrapper.attractorFalloff = fo.id;
            self._dismissContextMenu();
            self._draw();
            if (self.onBodiesChanged) self.onBodiesChanged();
          });
          menu.appendChild(foItem);
        })(falloffTypes[f]);
      }
    }

    // Separator before render mode
    var sepRender = document.createElement('div');
    sepRender.style.borderBottom = '1px solid var(--border-color)';
    sepRender.style.margin = '4px 0';
    menu.appendChild(sepRender);

    // Render mode options (Fill / Stroke Only / Fill + Stroke)
    var renderModes = [
      { id: 'fill', label: 'Fill' },
      { id: 'stroke', label: 'Stroke Only' },
      { id: 'both', label: 'Fill + Stroke' }
    ];
    for (var rm = 0; rm < renderModes.length; rm++) {
      (function(mode) {
        var item = document.createElement('button');
        item.className = 'context-menu-item';
        var current = wrapper.renderMode || 'fill';
        var check = document.createTextNode(current === mode.id ? '\u2713  ' : '    ');
        var label = document.createTextNode(mode.label);
        item.appendChild(check);
        item.appendChild(label);
        if (current === mode.id) {
          item.style.color = 'var(--accent-primary)';
        }
        item.addEventListener('click', function() {
          wrapper.renderMode = mode.id;
          // If switching to a mode that needs a stroke and none has been set,
          // derive one from the body color so the outline is visible.
          if (mode.id !== 'fill' && !wrapper.strokeColor) {
            wrapper.strokeColor = wrapper.color;
          }
          // Rebuild the physics fixture: stroke mode → hollow thin-wall
          // container, other modes → solid primitive. The user sees the
          // semantic change reflected in both visuals and physics immediately.
          self._attachFixturesForMode(wrapper);
          self._dismissContextMenu();
          self._draw();
          if (self.onBodiesChanged) self.onBodiesChanged();
        });
        menu.appendChild(item);
      })(renderModes[rm]);
    }

    // Separator before delete
    var sep = document.createElement('div');
    sep.style.borderBottom = '1px solid var(--border-color)';
    sep.style.margin = '4px 0';
    menu.appendChild(sep);

    // Delete
    var del = document.createElement('button');
    del.className = 'context-menu-item danger';
    del.textContent = 'Delete';
    del.addEventListener('click', function() {
      self._dismissContextMenu();
      self.removeBody(wrapper);
      self._bodyDrag.hoverBody = null;
      self._draw();
      if (self.onBodiesChanged) self.onBodiesChanged();
    });
    menu.appendChild(del);

    document.body.appendChild(menu);
    this._activeContextMenu = menu;

    // Dismiss on click outside
    var dismissHandler = function(ev) {
      if (!menu.contains(ev.target)) {
        self._dismissContextMenu();
      }
    };
    setTimeout(function() {
      document.addEventListener('mousedown', dismissHandler);
      self._contextMenuDismissHandler = dismissHandler;
    }, 0);
  };

  // ============================================
  // BODY PICKER MENU (overlapping bodies)
  // ============================================

  /**
   * When right-click lands on multiple overlapping bodies, show a picker so
   * the user can explicitly select which one to operate on (instead of being
   * stuck with whichever one happens to be topmost).
   *
   * Each item shows a color swatch (circle for fill, square outline for stroke),
   * the body name, and a dim body-type badge. Clicking an item collapses the
   * selection to that body and opens the normal single-body context menu.
   */
  PhysicsEngine.prototype._showBodyPickerMenu = function(e, bodies) {
    var self = this;
    this._dismissContextMenu();

    var menu = document.createElement('div');
    menu.className = 'context-menu physics-body-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    var title = document.createElement('div');
    title.className = 'context-menu-title';
    title.textContent = 'Select Body';
    menu.appendChild(title);

    for (var i = 0; i < bodies.length; i++) {
      (function(body) {
        var item = document.createElement('button');
        item.className = 'context-menu-item';

        // Color swatch reflects renderMode: stroke-only bodies get a bordered
        // square, filled bodies get a filled circle.
        var swatch = document.createElement('span');
        swatch.style.display = 'inline-block';
        swatch.style.width = '8px';
        swatch.style.height = '8px';
        swatch.style.marginRight = '8px';
        swatch.style.verticalAlign = 'middle';
        if (body.renderMode === 'stroke') {
          swatch.style.borderRadius = '1px';
          swatch.style.border = '2px solid ' + (body.strokeColor || body.color);
          swatch.style.background = 'transparent';
        } else {
          swatch.style.borderRadius = '50%';
          swatch.style.background = body.color;
        }
        item.appendChild(swatch);

        var label = document.createElement('span');
        label.textContent = body.name;
        item.appendChild(label);

        var badge = document.createElement('span');
        badge.style.cssText = 'margin-left:8px;font-size:10px;opacity:0.5;';
        badge.textContent = body.bodyType;
        item.appendChild(badge);

        item.addEventListener('click', function() {
          self._dismissContextMenu();
          self._selectedBodies = [body];
          self._draw();
          // Hand off to the normal single-body menu, positioned at the same click
          self._showBodyContextMenu(e, body);
        });
        menu.appendChild(item);
      })(bodies[i]);
    }

    document.body.appendChild(menu);
    this._activeContextMenu = menu;

    // Keep the picker inside the viewport
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

    var dismissHandler = function(ev) {
      if (!menu.contains(ev.target)) {
        self._dismissContextMenu();
      }
    };
    setTimeout(function() {
      document.addEventListener('mousedown', dismissHandler);
      self._contextMenuDismissHandler = dismissHandler;
    }, 0);
  };

  // ============================================
  // MULTI-BODY CONTEXT MENU (batch actions on a selection)
  // ============================================

  /**
   * Shown when right-click lands on a body that's part of a multi-selection.
   * Offers batch versions of the single-body actions (body type, attractor,
   * render mode, delete) that apply to every selected body at once.
   */
  PhysicsEngine.prototype._showMultiBodyContextMenu = function(e, bodies) {
    var self = this;
    this._dismissContextMenu();

    var menu = document.createElement('div');
    menu.className = 'context-menu physics-body-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    var title = document.createElement('div');
    title.className = 'context-menu-title';
    title.textContent = bodies.length + ' bodies selected';
    menu.appendChild(title);

    // Body type — apply to all selected
    var types = [
      { id: 'dynamic', label: 'All Dynamic' },
      { id: 'static', label: 'All Static' },
      { id: 'kinematic', label: 'All Kinematic' }
    ];
    for (var ti = 0; ti < types.length; ti++) {
      (function(type) {
        var item = document.createElement('button');
        item.className = 'context-menu-item';
        item.textContent = '    ' + type.label;
        item.addEventListener('click', function() {
          for (var b = 0; b < bodies.length; b++) {
            bodies[b].setBodyType(type.id);
          }
          self._dismissContextMenu();
          self._draw();
          if (self.onBodiesChanged) self.onBodiesChanged();
        });
        menu.appendChild(item);
      })(types[ti]);
    }

    // Separator before attractor
    var sepAtt = document.createElement('div');
    sepAtt.style.borderBottom = '1px solid var(--border-color)';
    sepAtt.style.margin = '4px 0';
    menu.appendChild(sepAtt);

    // Enable / disable attractor for all
    var attOn = document.createElement('button');
    attOn.className = 'context-menu-item';
    attOn.textContent = '    Enable Attractor';
    attOn.addEventListener('click', function() {
      for (var b = 0; b < bodies.length; b++) {
        bodies[b].isAttractor = true;
        // Match the single-body menu behavior: attractor bodies go static so
        // they don't drift out of place.
        if (bodies[b].bodyType === 'dynamic') {
          bodies[b].setBodyType('static');
        }
      }
      self._dismissContextMenu();
      self._draw();
      if (self.onBodiesChanged) self.onBodiesChanged();
    });
    menu.appendChild(attOn);

    var attOff = document.createElement('button');
    attOff.className = 'context-menu-item';
    attOff.textContent = '    Disable Attractor';
    attOff.addEventListener('click', function() {
      for (var b = 0; b < bodies.length; b++) {
        bodies[b].isAttractor = false;
      }
      self._dismissContextMenu();
      self._draw();
      if (self.onBodiesChanged) self.onBodiesChanged();
    });
    menu.appendChild(attOff);

    // Separator before render mode
    var sepRender = document.createElement('div');
    sepRender.style.borderBottom = '1px solid var(--border-color)';
    sepRender.style.margin = '4px 0';
    menu.appendChild(sepRender);

    // Render mode — apply to all selected
    var renderModes = [
      { id: 'fill', label: 'All Fill' },
      { id: 'stroke', label: 'All Stroke Only' },
      { id: 'both', label: 'All Fill + Stroke' }
    ];
    for (var rm = 0; rm < renderModes.length; rm++) {
      (function(mode) {
        var item = document.createElement('button');
        item.className = 'context-menu-item';
        item.textContent = '    ' + mode.label;
        item.addEventListener('click', function() {
          for (var b = 0; b < bodies.length; b++) {
            bodies[b].renderMode = mode.id;
            if (mode.id !== 'fill' && !bodies[b].strokeColor) {
              bodies[b].strokeColor = bodies[b].color;
            }
            // Rebuild fixtures so the batch action updates physics, not just visuals
            self._attachFixturesForMode(bodies[b]);
          }
          self._dismissContextMenu();
          self._draw();
          if (self.onBodiesChanged) self.onBodiesChanged();
        });
        menu.appendChild(item);
      })(renderModes[rm]);
    }

    // Separator before delete
    var sepDel = document.createElement('div');
    sepDel.style.borderBottom = '1px solid var(--border-color)';
    sepDel.style.margin = '4px 0';
    menu.appendChild(sepDel);

    var del = document.createElement('button');
    del.className = 'context-menu-item danger';
    del.textContent = 'Delete ' + bodies.length + ' bodies';
    del.addEventListener('click', function() {
      self._dismissContextMenu();
      // Iterate backwards so splicing inside removeBody doesn't disturb indices
      for (var b = bodies.length - 1; b >= 0; b--) {
        self.removeBody(bodies[b]);
      }
      self._bodyDrag.hoverBody = null;
      self._draw();
      if (self.onBodiesChanged) self.onBodiesChanged();
    });
    menu.appendChild(del);

    document.body.appendChild(menu);
    this._activeContextMenu = menu;

    // Keep the menu inside the viewport
    var mRect = menu.getBoundingClientRect();
    if (mRect.right > window.innerWidth) menu.style.left = (window.innerWidth - mRect.width - 4) + 'px';
    if (mRect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - mRect.height - 4) + 'px';

    var dismissHandler = function(ev) {
      if (!menu.contains(ev.target)) {
        self._dismissContextMenu();
      }
    };
    setTimeout(function() {
      document.addEventListener('mousedown', dismissHandler);
      self._contextMenuDismissHandler = dismissHandler;
    }, 0);
  };

  // ============================================
  // CANVAS CONTEXT MENU (no body hit)
  // ============================================

  PhysicsEngine.prototype._showCanvasContextMenu = function(e) {
    var self = this;
    this._dismissContextMenu();

    var menu = document.createElement('div');
    menu.className = 'context-menu physics-body-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    // Wall toggle
    var wallItem = document.createElement('button');
    wallItem.className = 'context-menu-item';
    var wallCheck = document.createTextNode(this.wallsEnabled ? '\u2713  ' : '    ');
    var wallLabel = document.createTextNode('Boundary Walls');
    wallItem.appendChild(wallCheck);
    wallItem.appendChild(wallLabel);
    wallItem.addEventListener('click', function() {
      self._dismissContextMenu();
      self.setWallsEnabled(!self.wallsEnabled);
    });
    menu.appendChild(wallItem);

    document.body.appendChild(menu);
    this._activeContextMenu = menu;

    // Dismiss on click outside
    var dismissHandler = function(ev) {
      if (!menu.contains(ev.target)) {
        self._dismissContextMenu();
      }
    };
    setTimeout(function() {
      document.addEventListener('mousedown', dismissHandler);
      self._contextMenuDismissHandler = dismissHandler;
    }, 0);
  };

  PhysicsEngine.prototype._dismissContextMenu = function() {
    if (this._activeContextMenu) {
      this._activeContextMenu.remove();
      this._activeContextMenu = null;
    }
    if (this._contextMenuDismissHandler) {
      document.removeEventListener('mousedown', this._contextMenuDismissHandler);
      this._contextMenuDismissHandler = null;
    }
  };

  /**
   * Add a user shape at a given position (or a default position).
   * Returns the created PhysicsBody wrapper.
   */
  PhysicsEngine.prototype.addUserShape = function(shapeType, options) {
    options = options || {};
    this._shapeCounter++;
    var id = shapeType + '_' + this._shapeCounter;
    var x = options.x || this.width / 2;
    var y = options.y || 50;
    var color = '#801336';
    var wrapper;

    switch (shapeType) {
      case 'circle':
        wrapper = this.addCircle({
          id: id, name: 'Circle ' + this._shapeCounter,
          x: x, y: y, radius: options.radius || 12, color: color
        });
        break;
      case 'rectangle':
        wrapper = this.addRectangle({
          id: id, name: 'Box ' + this._shapeCounter,
          x: x, y: y, width: options.width || 24, height: options.height || 24, color: color
        });
        break;
      case 'triangle':
        wrapper = this.addPolygon({
          id: id, name: 'Tri ' + this._shapeCounter,
          x: x, y: y, sides: 3, radius: options.radius || 14, color: color
        });
        break;
      case 'pentagon':
        wrapper = this.addPolygon({
          id: id, name: 'Penta ' + this._shapeCounter,
          x: x, y: y, sides: 5, radius: options.radius || 14, color: color
        });
        break;
      case 'hexagon':
        wrapper = this.addPolygon({
          id: id, name: 'Hex ' + this._shapeCounter,
          x: x, y: y, sides: 6, radius: options.radius || 14, color: color
        });
        break;
      case 'attractor':
        wrapper = this.addAttractor({
          id: id, name: 'Attractor ' + this._shapeCounter,
          x: x, y: y,
          visualRadius: 8,
          strength: 5,
          attractorRadius: options.attractorRadius || 80,
          falloff: 'inverseSquare',
          color: '#22AAE1'
        });
        break;
      default:
        wrapper = this.addCircle({
          id: id, name: 'Shape ' + this._shapeCounter,
          x: x, y: y, radius: 12, color: color
        });
    }

    if (!this.isRunning) this._draw();
    return wrapper;
  };

  // ============================================
  // WALL DRAWING
  // ============================================

  PhysicsEngine.prototype.setWallDrawMode = function(active) {
    this._wallDraw.active = active;
    this._wallDraw.startPoint = null;
    this._wallDraw.previewEnd = null;
    this.canvas.style.cursor = active ? 'crosshair' : '';
    if (!this.isRunning) this._draw();
  };

  PhysicsEngine.prototype.isWallDrawMode = function() {
    return this._wallDraw.active;
  };

  PhysicsEngine.prototype.compToCanvas = function(compPixels) {
    return compPixels * this.compScale;
  };

  PhysicsEngine.prototype.addWall = function(x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 5) return null;

    var midX = (x1 + x2) / 2;
    var midY = (y1 + y2) / 2;
    var angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);

    this._shapeCounter++;
    var wrapper = this.addRectangle({
      id: 'wall_' + this._shapeCounter,
      name: 'Wall ' + this._shapeCounter,
      x: midX,
      y: midY,
      width: distance,
      height: this._wallDraw.wallThickness,
      angle: angleDeg,
      isStatic: true,
      color: '#3a3a3a'
    });

    if (!this.isRunning) this._draw();
    return wrapper;
  };

  // ============================================
  // IMPORT FROM COMP
  // ============================================

  /**
   * Import AE layer data as physics bodies.
   * bodies: array from createPhysicsBodiesFromLayers() ExtendScript
   * Each body has: { label, position:{x,y}, rotation, shape, radius, width, height, isStatic }
   * Positions and sizes are in AE comp pixels — converted here via compScale.
   */
  PhysicsEngine.prototype.importBodiesFromComp = function(bodies) {
    // Clear existing dynamic bodies (keep walls intact by rebuilding after)
    this.clearBodies();

    var scale = this.compScale;
    var colors = ['#801336', '#C72C41', '#EE4540', '#2B2D42', '#8D99AE'];

    // AE returns fill/stroke colors as [r,g,b] floats in 0-1; the panel stores
    // colors as hex strings.
    function rgbToHex(rgb) {
      if (!rgb || rgb.length < 3) return null;
      var r = Math.max(0, Math.min(255, Math.round(rgb[0] * 255)));
      var g = Math.max(0, Math.min(255, Math.round(rgb[1] * 255)));
      var bCh = Math.max(0, Math.min(255, Math.round(rgb[2] * 255)));
      return '#' + ((1 << 24) + (r << 16) + (g << 8) + bCh).toString(16).slice(1);
    }

    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      var cx = b.position.x * scale;
      var cy = b.position.y * scale;

      // Prefer the shape's actual AE fill color; fall back to the rotating
      // accent palette when the layer has no solid fill (gradient, stroke-only,
      // or no fill/stroke detected).
      var color = rgbToHex(b.fillColor) || colors[i % colors.length];

      // Render mode from AE fill/stroke composition; default 'fill'.
      var renderMode = b.renderMode || 'fill';
      var strokeColor = rgbToHex(b.strokeColor);
      var strokeWidth = b.strokeWidth ? Math.max(1, b.strokeWidth * scale) : 2;

      this._shapeCounter++;

      // Build keyframes array from imported position/rotation data
      var keyframes = null;
      var hasKeyframes = b.posKeyframes && b.posKeyframes.length > 1;
      if (hasKeyframes) {
        keyframes = [];
        for (var k = 0; k < b.posKeyframes.length; k++) {
          var pk = b.posKeyframes[k];
          var kf = {
            time: pk.time,
            x: pk.x * scale,
            y: pk.y * scale,
            rotation: 0
          };
          // Merge rotation keyframe if available at same index
          if (b.rotKeyframes && b.rotKeyframes[k]) {
            kf.rotation = b.rotKeyframes[k].rotation || 0;
          }
          keyframes.push(kf);
        }
      }

      // Detect attractor bodies by flag or label name convention
      var isAttractorBody = b.isAttractor || (b.label && b.label.toLowerCase().indexOf('attractor') !== -1);

      if (isAttractorBody) {
        this.addAttractor({
          id: 'import_' + this._shapeCounter,
          name: b.label,
          x: cx,
          y: cy,
          visualRadius: Math.min(b.radius || 8, 12) * scale,
          strength: b.attractorStrength || 5,
          attractorRadius: (b.attractorRadius || 100) * scale,
          falloff: b.attractorFalloff || 'inverseSquare',
          color: '#22AAE1',
          layerIndex: b.layerIndex || null
        });
      } else {
        // Body type is derived from the AE layer's motion state only:
        // keyframed layers come in as kinematic so imported animation drives
        // the body, and layers already flagged static stay static. Everything
        // else defaults to dynamic. Render mode is independent — the user
        // promotes a body to static via the context menu when they want it
        // to act as a wall or container.
        var bodyType = hasKeyframes
          ? 'kinematic'
          : (b.isStatic ? 'static' : 'dynamic');

        if (b.shape === 'polygon' && b.vertices && b.vertices.length >= 3) {
          // Scale vertices from comp space to canvas space
          var scaledVerts = [];
          for (var vi = 0; vi < b.vertices.length; vi++) {
            scaledVerts.push({
              x: b.vertices[vi][0] * scale,
              y: b.vertices[vi][1] * scale
            });
          }
          this.addPolygon({
            id: 'import_' + this._shapeCounter,
            name: b.label,
            x: cx,
            y: cy,
            vertices: scaledVerts,
            width: b.width * scale,
            height: b.height * scale,
            color: color,
            bodyType: bodyType,
            density: 1,
            friction: 0.3,
            restitution: 0.3,
            keyframes: keyframes,
            layerIndex: b.layerIndex || null,
            renderMode: renderMode,
            strokeColor: strokeColor,
            strokeWidth: strokeWidth
          });
        } else if (b.shape === 'circle') {
          this.addCircle({
            id: 'import_' + this._shapeCounter,
            name: b.label,
            x: cx,
            y: cy,
            radius: b.radius * scale,
            color: color,
            bodyType: bodyType,
            keyframes: keyframes,
            layerIndex: b.layerIndex || null,
            renderMode: renderMode,
            strokeColor: strokeColor,
            strokeWidth: strokeWidth
          });
        } else {
          this.addRectangle({
            id: 'import_' + this._shapeCounter,
            name: b.label,
            x: cx,
            y: cy,
            width: b.width * scale,
            height: b.height * scale,
            angle: b.rotation || 0,
            color: color,
            bodyType: bodyType,
            keyframes: keyframes,
            layerIndex: b.layerIndex || null,
            renderMode: renderMode,
            strokeColor: strokeColor,
            strokeWidth: strokeWidth
          });
        }
      }
    }

    if (!this.isRunning) this._draw();
  };

  PhysicsEngine.prototype._drawOverlay = function() {
    // Overlay removed — parameters are shown in the knobs below the canvas
  };

  PhysicsEngine.prototype._drawRecordingIndicator = function() {
    var ctx = this.ctx;
    
    // Position
    var x = this.width - 42;
    var y = this.height - 18;
    
    // Pulsing dot with smooth animation (accent color)
    var pulse = Math.sin(this.simulationTime * 6) * 0.35 + 0.65;
    ctx.fillStyle = 'rgba(238, 69, 64, ' + pulse + ')';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // REC label
    ctx.fillStyle = 'rgba(238, 69, 64, 0.9)';
    ctx.font = '600 9px Inter, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('REC', x + 8, y + 3);
  };

  // ============================================
  // RESIZE
  // ============================================

  PhysicsEngine.prototype.resize = function(width, height, compScale) {
    this.width = width;
    this.height = height;
    if (compScale !== undefined) this.compScale = compScale;
    
    // Handle HiDPI
    this.canvas.width = width * this.dpr;
    this.canvas.height = height * this.dpr;
    this.canvas.style.width = width + 'px';
    this.canvas.style.height = height + 'px';
    this.ctx.scale(this.dpr, this.dpr);
    
    this.bounds.left = 2;
    this.bounds.right = width - 2;
    this.bounds.top = 2;
    this.bounds.bottom = height - 2;

    // Update gravity indicator position
    this._gravityIndicator.cx = width - 28;

    // Recreate world with new bounds
    this._destroyWalls();
    this._createWalls();
    this._updateViewport();
    this._createDefaultBodies();
    this._draw();
  };

  // ============================================
  // GETTERS
  // ============================================

  PhysicsEngine.prototype.getParameters = function() {
    return {
      gravity: this.params.gravity,
      gravityAngle: this.params.gravityAngle,
      bounce: this.params.bounce,
      friction: this.params.friction,
      airResistance: this.params.airResistance,
      angularDrag: this.params.angularDrag,
      summary: 'gravity=' + this.params.gravity.toFixed(1) + ', ' +
               'bounce=' + (this.params.bounce * 100).toFixed(0) + '%, ' +
               'friction=' + (this.params.friction * 100).toFixed(0) + '%'
    };
  };

  // ============================================
  // CLEANUP
  // ============================================

  PhysicsEngine.prototype.destroy = function() {
    this.stop();
    this.clearBodies();
    this._destroyWalls();
    this.world = null;
  };

  // ============================================
  // EXPORT
  // ============================================

  // Export to global scope
  global.PhysicsEngine = PhysicsEngine;
  
  // Also keep the old name for backward compatibility
  global.PhysicsTester = PhysicsEngine;

})(typeof window !== 'undefined' ? window : this);
