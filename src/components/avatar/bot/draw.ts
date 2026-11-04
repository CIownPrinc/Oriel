import type { BotLook } from "./looks";
import { extent, halfWidthAt, shapeGeom, type ShapeGeom } from "./shapes";
import { PALETTE } from "@/lib/palette";

/**
 * Pure canvas drawing for one bot. Everything is expressed in units of `S`, the
 * smaller side of the canvas, so the bot is crisp at any size.
 */
export interface BotPose {
  yaw: number; // -1..1 simulated head turn
  roll: number; // radians
  bob: number; // vertical offset in units of S
  scale: number; // lean / emphasis
  gazeX: number; // -1..1
  gazeY: number; // -1..1
  open: number; // 0 (closed) .. 1.15 (wide)
  lidTopL: number; // 0..1 cut from the top of the left eye
  lidTopR: number;
  tiltL: number; // -1..1 top-lid angle (positive = outer corner lower)
  tiltR: number;
  happy: number; // 0..1 bottom arc (smile eyes)
  eyeScale: number;
  voice: number; // 0..1 speaking light
  blush: number; // 0..1 extra blush
  glow: number; // 0..1 accessory / eye glow emphasis
}

/** Eye proportions in units of S: shared with the vector reduction of the face (components/brand/Interviewer). */
export const EYE = { width: 0.082, ratio: 2.05 } as const;

function capsule(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const r = Math.min(w, h) / 2;
  const x = cx - w / 2, y = cy - h / 2;
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

/**
 * Draw one bot. `geom` is the face shape and feature layout (pass a morphing copy to
 * animate between shapes); it defaults to the look's own shape.
 */
export function drawBot(ctx: CanvasRenderingContext2D, W: number, H: number, look: BotLook, p: BotPose, accent: string, geom: ShapeGeom = shapeGeom(look.shape)) {
  const S = Math.min(W, H);
  ctx.clearRect(0, 0, W, H);
  const o = geom.outline;
  const ext = extent(o);
  const turn = Math.abs(p.yaw);
  const sx = S * p.scale * (1 - 0.06 * turn), sy = S * p.scale;
  const a = ext.maxX * sx; // face half-width
  const b = Math.max(-ext.top, ext.bottom) * sy; // face half-height
  const cx = W / 2 + p.yaw * S * 0.025;
  const cy = H / 2 - S * 0.03 + p.bob * S;
  const X = (u: number) => cx + u * sx, Y = (v: number) => cy + v * sy;
  const trace = () => {
    ctx.moveTo(X(o[0]), Y(o[1]));
    for (let i = 2; i < o.length; i += 2) ctx.lineTo(X(o[i]), Y(o[i + 1]));
    ctx.closePath();
  };

  // Floor shadow: one flat, faint ellipse that grounds the face.
  const floorY = Y(ext.bottom) + S * 0.075;
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.ellipse(cx, floorY, a * 0.78, S * 0.026, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.roll);
  ctx.translate(-cx, -cy);

  // Accessories behind the face.
  if (look.accessory === "antenna") drawAntenna(ctx, cx, Y(ext.top), S, look, p, accent);
  if (look.accessory === "headset") drawHeadsetCups(ctx, geom, X, Y, S, look);
  if (look.accessory === "halo") drawHalo(ctx, cx, Y(ext.top), a, S, look);

  // Face: one flat colour. The family is drawn like a mark, not a render: no gradients, no lights.
  ctx.beginPath();
  trace();
  ctx.fillStyle = look.face;
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  trace();
  ctx.clip();
  // Blush: two flat soft dots, inside the face whatever its shape.
  const blush = Math.min(1, look.blush + p.blush);
  if (blush > 0.01) {
    ctx.fillStyle = `rgba(226,128,108,${0.22 * blush})`;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(X(side * geom.spacing * 1.24) + p.yaw * a * 0.2, Y(geom.eyeY + 0.1), S * 0.04, S * 0.024, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // A cap sits inside the outline, so it follows any shape.
  if (look.accessory === "beanie") {
    const capY = Y(ext.top) + S * 0.105;
    ctx.fillStyle = look.accessoryColor;
    ctx.fillRect(cx - a * 1.3, Y(ext.top) - S * 0.05, a * 2.6, capY - Y(ext.top) + S * 0.05);
    ctx.fillStyle = look.faceShade;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(cx - a * 1.3, capY - S * 0.022, a * 2.6, S * 0.022);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
  if (look.accessory === "beanie") {
    ctx.beginPath();
    ctx.arc(cx, Y(ext.top) - S * 0.008, S * 0.03, 0, Math.PI * 2);
    ctx.fillStyle = look.accessoryColor;
    ctx.fill();
  }

  if (look.accessory === "rim") {
    ctx.beginPath();
    trace();
    ctx.lineWidth = S * 0.012;
    ctx.strokeStyle = look.accessoryColor;
    ctx.stroke();
  }

  // Eyes.
  const spacing = geom.spacing * sx;
  const ew0 = S * EYE.width * p.eyeScale * geom.eyeK;
  const eh0 = ew0 * EYE.ratio;
  const eyeY = Y(geom.eyeY) + p.gazeY * eh0 * 0.22;
  for (const side of [-1, 1] as const) {
    const far = Math.max(0, p.yaw * side); // eye on the side we turn toward narrows
    const ew = ew0 * (1 - 0.38 * far);
    const eh = eh0 * Math.max(0.12, p.open);
    const ex = cx + side * spacing * (1 - 0.18 * turn) + p.yaw * a * 0.28 + p.gazeX * ew0 * 0.9;
    const lidTop = side < 0 ? p.lidTopL : p.lidTopR;
    const tilt = side < 0 ? p.tiltL : p.tiltR;
    drawEye(ctx, ex, eyeY, ew, eh, lidTop, tilt * side, p.happy, look);
    if (look.accessory === "brows") drawBrow(ctx, ex, eyeY - eh0 * 0.5 - S * 0.045 + lidTop * eh0 * 0.25, ew0, tilt * side, side, S, look);
    if (look.accessory === "freckles") drawFreckles(ctx, ex + side * ew0 * 0.4, eyeY + eh0 * 0.62, S, look);
  }

  // Voice light: the bot has no mouth; a small light breathes with its voice.
  if (p.voice > 0.02) {
    const vw = S * (0.02 + p.voice * 0.085);
    const vh = S * 0.016;
    ctx.beginPath();
    capsule(ctx, cx + p.yaw * a * 0.25, Y(geom.eyeY + geom.voiceDy), vw, vh);
    ctx.fillStyle = look.eye;
    ctx.globalAlpha = Math.min(0.9, 0.2 + p.voice * 1.1);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  if (look.accessory === "glasses") drawGlasses(ctx, cx + p.yaw * a * 0.28, eyeY, spacing * (1 - 0.18 * turn), ew0, eh0, S, look);
  if (look.accessory === "headset") drawHeadsetMic(ctx, geom, X, Y, S, p);
  if (look.accessory === "tuft") drawTuft(ctx, cx, Y(ext.top), S, look);
  if (look.accessory === "bow") drawBow(ctx, cx + a * 0.42, Y(ext.top) + S * 0.035, S, look);
  ctx.restore();
}

function drawEye(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lidTop: number, tilt: number, happy: number, look: BotLook) {
  ctx.save();
  // Lid mask: region between an angled top lid and a (possibly arched) bottom lid.
  const pad = w;
  const top = y - h / 2 + lidTop * h;
  const tl = top - tilt * h * 0.28, tr = top + tilt * h * 0.28;
  const bottom = y + h / 2 + 2;
  const arch = happy * h * 1.1;
  ctx.beginPath();
  ctx.moveTo(x - w / 2 - pad, tl);
  ctx.lineTo(x + w / 2 + pad, tr);
  ctx.lineTo(x + w / 2 + pad, bottom);
  ctx.quadraticCurveTo(x, bottom - arch * 2, x - w / 2 - pad, bottom);
  ctx.closePath();
  ctx.clip();
  // A solid capsule: no glint, no glow.
  ctx.beginPath();
  capsule(ctx, x, y, w, h);
  ctx.fillStyle = look.eye;
  ctx.fill();
  ctx.restore();
}

/** A short flat brow that tilts with the lid, so expressions still read. */
function drawBrow(ctx: CanvasRenderingContext2D, x: number, y: number, ew: number, tilt: number, side: number, S: number, look: BotLook) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt * 0.35 * side);
  ctx.beginPath();
  capsule(ctx, 0, 0, ew * 1.7, S * 0.016);
  ctx.fillStyle = look.eye;
  ctx.fill();
  ctx.restore();
}

function drawFreckles(ctx: CanvasRenderingContext2D, x: number, y: number, S: number, look: BotLook) {
  ctx.save();
  ctx.fillStyle = look.eye;
  ctx.globalAlpha = 0.4;
  for (const [dx, dy] of [[-0.022, 0], [0, 0.014], [0.022, 0]] as const) {
    ctx.beginPath();
    ctx.arc(x + dx * S, y + dy * S, S * 0.008, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawHalo(ctx: CanvasRenderingContext2D, cx: number, topY: number, a: number, S: number, look: BotLook) {
  ctx.save();
  ctx.lineWidth = S * 0.013;
  ctx.strokeStyle = look.accessoryColor;
  ctx.beginPath();
  ctx.ellipse(cx, topY - S * 0.06, a * 0.5, S * 0.03, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBow(ctx: CanvasRenderingContext2D, x: number, y: number, S: number, look: BotLook) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(0.35);
  ctx.fillStyle = look.accessoryColor;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(side * S * 0.075, -S * 0.048);
    ctx.quadraticCurveTo(side * S * 0.095, 0, side * S * 0.075, S * 0.048);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, S * 0.02, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGlasses(ctx: CanvasRenderingContext2D, cx: number, y: number, spacing: number, ew: number, eh: number, S: number, look: BotLook) {
  const fw = ew * 2.55, fh = eh * 1.25;
  ctx.save();
  ctx.lineWidth = S * 0.009;
  ctx.strokeStyle = look.accessoryColor;
  for (const side of [-1, 1]) {
    const x = cx + side * spacing;
    ctx.beginPath();
    const r = S * 0.045;
    ctx.roundRect(x - fw / 2, y - fh / 2, fw, fh, r);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - spacing + fw / 2, y - fh * 0.1);
  ctx.quadraticCurveTo(cx, y - fh * 0.3, cx + spacing - fw / 2, y - fh * 0.1);
  ctx.stroke();
  ctx.restore();
}

function drawHeadsetCups(ctx: CanvasRenderingContext2D, g: ShapeGeom, X: (u: number) => number, Y: (v: number) => number, S: number, look: BotLook) {
  const y = g.eyeY - 0.006;
  const hw = halfWidthAt(g.outline, y);
  // Lean the cups with the side of the face (a triangle's sides slope; a circle's don't at eye level).
  const lean = Math.atan2(halfWidthAt(g.outline, y + 0.02) - halfWidthAt(g.outline, y - 0.02), 0.04);
  ctx.save();
  for (const side of [-1, 1]) {
    const x = X(side * hw * 0.98);
    ctx.save();
    ctx.translate(x, Y(y));
    ctx.rotate(-side * lean);
    ctx.fillStyle = look.accessoryColor;
    ctx.beginPath();
    capsule(ctx, 0, 0, S * 0.07, S * 0.15);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawHeadsetMic(ctx: CanvasRenderingContext2D, g: ShapeGeom, X: (u: number) => number, Y: (v: number) => number, S: number, p: BotPose) {
  ctx.save();
  const hw = halfWidthAt(g.outline, g.eyeY + 0.053);
  ctx.lineWidth = S * 0.011;
  ctx.lineCap = "round";
  ctx.strokeStyle = "#3A3D44";
  ctx.beginPath();
  ctx.moveTo(X(hw * 0.98), Y(g.eyeY + 0.053));
  ctx.quadraticCurveTo(X(hw * 0.93), Y(g.eyeY + 0.23), X(g.spacing * 0.67), Y(g.eyeY + 0.2));
  ctx.stroke();
  ctx.fillStyle = p.voice > 0.05 ? PALETTE.accent : "#2A2C31";
  ctx.beginPath();
  capsule(ctx, X(g.spacing * 0.57), Y(g.eyeY + 0.2), S * 0.06, S * 0.03);
  ctx.fill();
  ctx.restore();
}

function drawAntenna(ctx: CanvasRenderingContext2D, cx: number, topY: number, S: number, look: BotLook, p: BotPose, accent: string) {
  ctx.save();
  ctx.lineWidth = S * 0.01;
  ctx.lineCap = "round";
  ctx.strokeStyle = look.accessoryColor;
  ctx.beginPath();
  ctx.moveTo(cx, topY + S * 0.02);
  ctx.lineTo(cx + S * 0.01, topY - S * 0.07);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + S * 0.01, topY - S * 0.085, S * 0.022, 0, Math.PI * 2);
  // The ball brightens while it speaks: a change of colour, not a glow.
  ctx.fillStyle = p.voice > 0.05 || p.glow > 0.5 ? accent : look.accessoryColor;
  ctx.fill();
  ctx.restore();
}

function drawTuft(ctx: CanvasRenderingContext2D, cx: number, topY: number, S: number, look: BotLook) {
  ctx.save();
  ctx.fillStyle = look.accessoryColor;
  // Two soft leaves sprouting from the crown.
  for (const [dx, h, lean] of [[-0.012, 0.085, -0.25], [0.03, 0.06, 0.45]] as const) {
    ctx.save();
    ctx.translate(cx + dx * S, topY + S * 0.02);
    ctx.rotate(lean);
    ctx.beginPath();
    ctx.ellipse(0, -h * S * 0.5, S * 0.022, h * S * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
