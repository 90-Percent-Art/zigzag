/*  Zig Blocks (3/5/7 segments) with per-shape single-direction hatching
    Keys: r = regenerate, s = save PNG
*/

const CANVAS = { w: 1200, h: 900 };

function setup() {
  createCanvas(CANVAS.w, CANVAS.h);
  pixelDensity(1);
  noLoop();
  randomizeAll();
  // set up live controls
  if (typeof dat !== 'undefined') setupGUI();
}

function draw() {
  drawScene();
}

function drawScene(target = null, rendererHint = null){
  const ctx = target || window;
  ctx.background(255);
  for (const b of blocks) drawZigBlock(b, ctx, rendererHint);
}

/* ===================== HATCH CORE ===================== */

function dedgToRad(deg){ return (deg*Math.PI)/180; }
function normal2(dx, dy){ const L=Math.hypot(dx,dy)||1; return {x:-dy/L, y:dx/L}; }
function segIntersectT(P,Q,A,B){
  const r = {x:Q.x-P.x, y:Q.y-P.y}, s = {x:B.x-A.x, y:B.y-A.y};
  const den = r.x*s.y - r.y*s.x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((A.x-P.x)*s.y - (A.y-P.y)*s.x) / den;
  const u = ((A.x-P.x)*r.y - (A.y-P.y)*r.x) / den;
  if (t>=0 && t<=1 && u>=0 && u<=1) return t;
  return null;
}
function hatchPolygon(poly, angle, spacing, jitter=0, weight=1, ctx=null){
  const dir = {x:Math.cos(angle), y:Math.sin(angle)};
  const nrm = normal2(dir.x, dir.y);
  const proj = p => nrm.x*p.x + nrm.y*p.y;

  let minProj=Infinity, maxProj=-Infinity;
  for (const p of poly){ const pr=proj(p); if(pr<minProj)minProj=pr; if(pr>maxProj)maxProj=pr; }

  const pad = 2*spacing;
  const minK = Math.floor((minProj - pad)/spacing);
  const maxK = Math.ceil((maxProj + pad)/spacing);

  // support drawing to a p5.Graphics context when provided
  if (ctx){ ctx.strokeWeight(weight); ctx.noFill(); ctx.strokeCap(SQUARE); }
  else { strokeWeight(weight); noFill(); strokeCap(SQUARE); }

  for (let k=minK; k<=maxK; k++){
    const off = k*spacing;
    const p0 = { x:-5000*dir.x + off*nrm.x, y:-5000*dir.y + off*nrm.y };
    const p1 = { x: 5000*dir.x + off*nrm.x, y: 5000*dir.y + off*nrm.y };
    const ts = [];
    for (let i=0;i<poly.length;i++){
      const A=poly[i], B=poly[(i+1)%poly.length];
      const t = segIntersectT(p0,p1,A,B);
      if (t!==null) ts.push(t);
    }
    ts.sort((a,b)=>a-b);
    for (let i=0;i+1<ts.length;i+=2){
      const A = { x:p0.x+(p1.x-p0.x)*ts[i],   y:p0.y+(p1.y-p0.y)*ts[i]   };
      const B = { x:p0.x+(p1.x-p0.x)*ts[i+1], y:p0.y+(p1.y-p0.y)*ts[i+1] };
      const jx = jitter ? randomGaussian(0,jitter) : 0;
      const jy = jitter ? randomGaussian(0,jitter) : 0;
      const AA = { x: A.x + jx, y: A.y + jy };
      const BB = { x: B.x + jx, y: B.y + jy };
      drawHatchSegment(ctx || window, AA, BB);
    }
  }
}

function drawHatchSegment(ctx, A, B){
  if (!PARAMS.CURVE.enabled){
    ctx.line(A.x, A.y, B.x, B.y);
    return;
  }
  const { mag, freq } = PARAMS.CURVE;
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const steps = 8;
  const phase = random(TWO_PI);
  // taper wobble on very short segments to avoid extreme bends
  const lenScale = constrain(len / 30, 0, 1);
  const amp = mag * lenScale;
  const localFreq = freq * lenScale + 0.0001; // avoid zero-frequency flat lines when len is tiny
  ctx.noFill();
  ctx.beginShape();
  for (let i=0;i<=steps;i++){
    const t = i/steps;
    const baseX = A.x + dx*t;
    const baseY = A.y + dy*t;
    const off = Math.sin(phase + t*localFreq*TWO_PI) * amp;
    ctx.vertex(baseX + nx*off, baseY + ny*off);
  }
  ctx.endShape();
}

/* ===================== PARAMS ===================== */

let blocks = [];
let currentPalette;   // declare only, assign later

// small palette for block colors (print-like)
const PALETTE = ['#c85a5a','#6aa6d1','#d1a86a','#6ad1a2','#8f79c8'];

const PARAMS = {
  BLOCK_COUNT: 0,            // 0 => random 1..6
  ZIG_CHOICES: [3,5,7],      // number of segments in a block
  // rect size
  W_RANGE: [200, 340],
  H_RANGE: [90, 140],
  // per-connector offset (top rect relative to previous rect)
  OFF_X_RANGE: [-260, 260],
  OFF_Y_RANGE: [-320, 320], // allow folds up/down
  // look
  MARGIN: 60,
  // tighter spacing, lighter stroke, less jitter for cleaner printed look
  HATCH: { spacing: 3.5, jitter: 0.4, weight: 0.6 },
  // per-shape hatch angle distribution
  RECT_RULE: { meanDeg: 0, jitterDeg: 55, clampDeg: 80, minSepDeg: 10 },  // hatch angle per shape
  CONN_RULE: { mode: 'perpToSlant', jitterDeg: 6 }, // alongSlant|perpToSlant
  CONN_ANGLE: { bufferDeg: 20, stepDeg: 10 }, // connector bend angle quantization
 STROKE: '#1a1a1a',
ALPHA: 255,        // default stronger opacity; adjust in GUI if desired
COLOR_MODE: 'perShape',        // 'perZig' | 'perShape'
CURVE: { enabled: true, mag: 1, freq: 0.5 }  // random curvature on hatch lines
};

function makeColorWithAlpha(hex){
  const c = color(hex);
  c.setAlpha(PARAMS.ALPHA);
  return c;
}

function buildColors(rectCount, connCount){
  const colors = { rects: [], conns: [] };
  if (PARAMS.COLOR_MODE === 'perShape'){
    for (let i=0;i<rectCount;i++) colors.rects.push(makeColorWithAlpha(random(PALETTE)));
    for (let i=0;i<connCount;i++) colors.conns.push(makeColorWithAlpha(random(PALETTE)));
  } else {
    const c = makeColorWithAlpha(random(PALETTE));
    for (let i=0;i<rectCount;i++) colors.rects.push(c);
    for (let i=0;i<connCount;i++) colors.conns.push(c);
  }
  return colors;
}

function setBlockAlpha(block, alpha){
  const setA = col => col && col.setAlpha(alpha);
  for (const c of block.colors.rects) setA(c);
  for (const c of block.colors.conns) setA(c);
}

function applyColorModeToBlocks(){
  for (const b of blocks){
    const rectCount = b.rects.length;
    const connCount = Math.max(0, rectCount - 1);
    b.colors = buildColors(rectCount, connCount);
  }
}

function sampleRectAngleRad(){
  const { meanDeg, jitterDeg, clampDeg=90 } = PARAMS.RECT_RULE;
  const deg = constrain(meanDeg + randomGaussian(0, jitterDeg), -clampDeg, clampDeg);
  return radians(deg);
}

function angleDiff(a, b){
  // shortest signed angular difference
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function sampleAngles(count){
  const { minSepDeg=0 } = PARAMS.RECT_RULE;
  const minSepRad = radians(minSepDeg);
  const angles = [];
  for (let i=0;i<count;i++){
    let ang;
    let tries = 0;
    do {
      ang = sampleRectAngleRad();
      tries++;
    } while (i>0 && Math.abs(angleDiff(ang, angles[i-1])) < minSepRad && tries < 40);
    angles.push(ang);
  }
  return angles;
}

function sampleOffset(rectH, biasPosOverride=null){
  const ang = sampleConnectorAngleRad(biasPosOverride);
  const { OFF_X_RANGE, OFF_Y_RANGE } = PARAMS;
  const cosA = Math.cos(ang), sinA = Math.sin(ang);
  const lenLimits = [];
  if (Math.abs(cosA) > 1e-4) lenLimits.push(Math.abs(OFF_X_RANGE[1] / cosA));
  if (sinA > 0 && OFF_Y_RANGE[1] > 0) lenLimits.push(OFF_Y_RANGE[1] / sinA);
  if (sinA < 0 && OFF_Y_RANGE[0] < 0) lenLimits.push(Math.abs(OFF_Y_RANGE[0] / sinA));
  const finiteLimits = lenLimits.filter(n=>isFinite(n) && n>0);
  let maxLen = finiteLimits.length ? Math.min(...finiteLimits) : 150;
  const targetMin = rectH * 0.5;
  const targetMax = rectH * 2.5;
  maxLen = Math.min(maxLen, targetMax);
  let minLen = Math.min(Math.max(targetMin, 40), maxLen);
  if (minLen > maxLen) minLen = maxLen * 0.9;
  let len = random(minLen, maxLen);
  if (!(len > 0)) len = targetMin || 120;
  const dx = len * cosA;
  const dy = len * sinA;
  return { x: dx, y: dy };
}

function sampleConnectorAngleRad(biasPosOverride=null){
  const { bufferDeg=20, stepDeg=10 } = PARAMS.CONN_ANGLE;
  const minDeg = constrain(bufferDeg, 0, 89);
  const maxDeg = constrain(90 - bufferDeg, minDeg, 90);
  const list = [];
  for (let d = minDeg; d <= maxDeg + 1e-3; d += stepDeg){
    list.push(d);
  }
  const base = list.length ? random(list) : 45;
  const biasPos = biasPosOverride ?? 0.75; // 3:1 favor positive folds by default
  const usePos = random() < biasPos;
  if (usePos){
    const quad = random() < 0.5 ? 1 : 2;
    return radians(quad === 1 ? base : 180 - base);
  } else {
    const quad = random() < 0.5 ? 3 : 4;
    return radians(quad === 3 ? 180 + base : 360 - base);
  }
}

/* ===================== GENERATION ===================== */

function randomizeAll(){
  blocks.length = 0;
  const n = PARAMS.BLOCK_COUNT>0 ? PARAMS.BLOCK_COUNT : floor(random(1,7));
  for (let i=0;i<n;i++) blocks.push(makeZigBlock());
}

function makeZigBlock(){
  // shared size for this block (congruent rects)
  const w = random(PARAMS.W_RANGE[0], PARAMS.W_RANGE[1]);
  const h = random(PARAMS.H_RANGE[0], PARAMS.H_RANGE[1]);

  // choose zig length (odd segment count)
  const segCount = random(PARAMS.ZIG_CHOICES);     // 3,5,7
  const rectCount = (segCount + 1) >> 1;           // 2,3,4 rectangles
  const conns = rectCount - 1;

  // generate offsets for each connector
  const offs = [];
  for (let k=0;k<conns;k++){
    const biasPos = k === 0 ? 0.9 : 0.75; // first fold more likely positive
    offs.push(sampleOffset(h, biasPos));
  }

  // compute extents in local coords to place safely on canvas
  let x = 0, y = 0;
  let minx=0, maxx=w, miny=-h, maxy=0; // first (bottom) rect bounds
  for (const o of offs){
    x += o.x; y += o.y;
    minx = min(minx, x);
    maxx = max(maxx, x + w);
    miny = min(miny, y - h);
    maxy = max(maxy, y);
  }
  // choose anchor so whole chain fits
  const pad = PARAMS.MARGIN;
  const baseX = random(pad - minx, width - pad - maxx);
  const baseY = random(pad - miny, height - pad - maxy);

  // build rectangles in absolute coords
  const rects = [];
  let cur = createVector(baseX, baseY); // bottom-left of current rect
  rects.push({ bl: cur.copy(), w, h });
  for (const o of offs){
    cur = createVector(cur.x + o.x, cur.y + o.y);
    rects.push({ bl: cur.copy(), w, h });
  }

  // assign hatch angles per rectangle with separation, plus colors for rects/conns
  const angles = sampleAngles(rectCount);
  const colors = buildColors(rectCount, conns);

  return {
    rects,
    offs, // for connector angle
    colors,
    strokeCol: color(PARAMS.STROKE),
    angles
  };
}

/* ===================== DRAW ONE BLOCK ===================== */

function rectCorners(bl, w, h){
  // returns [b0,b1,b2,b3] (bottom-left -> bottom-right -> top-right -> top-left)
  const b0 = createVector(bl.x,     bl.y);
  const b1 = createVector(bl.x + w, bl.y);
  const b2 = createVector(bl.x + w, bl.y - h);
  const b3 = createVector(bl.x,     bl.y - h);
  return [b0,b1,b2,b3];
}

function drawZigBlock(block, target=null, rendererHint=null){
  const { rects, offs, colors, strokeCol, angles } = block;
  const { spacing, jitter, weight } = PARAMS.HATCH;
  const ctx = target || window;
  const ctxW = target ? target.width : width;
  const ctxH = target ? target.height : height;

  // draw the whole block into a graphics buffer so overlaps multiply like ink
  const g = createGraphics(ctxW, ctxH, rendererHint);
  g.strokeCap(SQUARE);
  g.noFill();
  g.stroke(strokeCol);
  g.strokeWeight(weight);

  // hatch each rectangle using the block angle
  for (let i=0;i<rects.length;i++){
    const {bl,w,h} = rects[i];
    const [b0,b1,b2,b3] = rectCorners(bl,w,h);
    const poly = [b0,b1,b2,b3];
    g.stroke(colors.rects[i] || colors.rects[0]);
    const rectAng = angles[i];
    hatchPolygon(poly, rectAng, spacing, jitter, weight, g);
  }

  // connectors between consecutive rects
  for (let i=0;i<rects.length-1;i++){
    const rA = rects[i], rB = rects[i+1];
    const [a0,a1,a2,a3] = rectCorners(rA.bl, rA.w, rA.h);
    const [b0,b1,b2,b3] = rectCorners(rB.bl, rB.w, rB.h);

    // connector (parallelogram): top of A -> bottom of B
    const poly = [a2,a3,b0,b1];

    // connector angle: average the two adjacent rect angles plus jitter
    const a0Ang = angles[i];
    const a1Ang = angles[i+1];
    const baseAng = Math.atan2(Math.sin(a0Ang)+Math.sin(a1Ang), Math.cos(a0Ang)+Math.cos(a1Ang));
    let connAng = baseAng + radians(randomGaussian(0, PARAMS.CONN_RULE.jitterDeg));
    g.stroke(colors.conns[i] || colors.rects[i] || colors.rects[0]);
    hatchPolygon(poly, connAng, spacing, jitter, weight, g);
  }

  // composite the block with multiply to simulate layered ink
  ctx.push();
  ctx.blendMode(MULTIPLY);
  ctx.image(g, 0, 0);
  ctx.pop();
}

/* ===================== GUI ===================== */

function setupGUI(){
  const gui = new dat.GUI({name: 'Zig Controls'});

  const hatchFolder = gui.addFolder('Hatch');
  hatchFolder.add(PARAMS.HATCH, 'spacing', 1, 12).step(0.5).name('spacing').onChange(()=>redraw());
  hatchFolder.add(PARAMS.HATCH, 'jitter', 0, 1).step(0.01).name('jitter').onChange(()=>redraw());
  hatchFolder.add(PARAMS.HATCH, 'weight', 0.1, 2).step(0.1).name('weight').onChange(()=>redraw());
  hatchFolder.add(PARAMS.CURVE, 'enabled').name('curve').onChange(()=>redraw());
  hatchFolder.add(PARAMS.CURVE, 'mag', 0, 3).step(0.1).name('curveMag').onChange(()=>redraw());
  hatchFolder.add(PARAMS.CURVE, 'freq', 0.2, 1).step(0.05).name('curveFreq').onChange(()=>redraw());
  hatchFolder.open();

  const lookFolder = gui.addFolder('Look');
  lookFolder.add(PARAMS, 'ALPHA', 10, 255).step(1).name('alpha').onChange(v=>{
    // update existing block alphas
    for (const b of blocks){ setBlockAlpha(b, v); }
    redraw();
  });
  lookFolder.add(PARAMS, 'COLOR_MODE', ['perZig','perShape']).name('colorMode').onChange(()=>{
    applyColorModeToBlocks();
    redraw();
  });
  lookFolder.add(PARAMS.CONN_ANGLE, 'bufferDeg', 0, 40).step(1).name('foldBuffer').onChange(()=>{
    randomizeAllAndRedraw();
  });
  lookFolder.open();

  gui.add({regen: ()=> randomizeAllAndRedraw()}, 'regen').name('Regenerate');
  gui.add({save: ()=> save('zig_blocks_hatched.png')}, 'save').name('Save PNG');
  gui.add({saveSVG: ()=> exportSVG()}, 'saveSVG').name('Save SVG');
}

function exportSVG(){
  const svgBuffer = createGraphics(width, height, SVG);
  svgBuffer.pixelDensity(1);
  drawScene(svgBuffer, SVG);
  save(svgBuffer, 'zig_blocks_hatched.svg');
}

/* ===================== KEYS ===================== */

function randomizeAllAndRedraw(){ randomizeAll(); redraw(); }

function keyPressed(){
  if (key==='r' || key==='R') randomizeAllAndRedraw();
  if (key==='s' || key==='S') save('zig_blocks_hatched.png');
}
