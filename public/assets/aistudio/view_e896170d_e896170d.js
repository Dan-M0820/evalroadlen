const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// Camera: world metres <-> screen pixels (north is up).
export class View {
  constructor() { this.cx = 0; this.cy = 0; this.scale = .14; this.W = 800; this.H = 600; }
  toScreen(x, y) { return [(x - this.cx) * this.scale + this.W / 2, -(y - this.cy) * this.scale + this.H / 2]; }
  toWorld(px, py) { return [(px - this.W / 2) / this.scale + this.cx, -(py - this.H / 2) / this.scale + this.cy]; }
  zoomAt(px, py, f) { const [wx, wy] = this.toWorld(px, py); this.scale = clamp(this.scale * f, .02, 14); this.cx = wx - (px - this.W / 2) / this.scale; this.cy = wy + (py - this.H / 2) / this.scale; }
  pan(dx, dy) { this.cx -= dx / this.scale; this.cy += dy / this.scale; }
  fit(b, pad = .92) { this.cx = (b[0] + b[2]) / 2; this.cy = (b[1] + b[3]) / 2; this.scale = clamp(Math.min(this.W / Math.max(50, b[2] - b[0]), this.H / Math.max(50, b[3] - b[1])) * pad, .02, 14); }
}
