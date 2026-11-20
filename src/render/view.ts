const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

// Camera: world metres <-> screen pixels (north is up).
export class View {
  cx = 0;
  cy = 0;
  scale = 0.14;
  W = 800;
  H = 600;

  toScreen(x: number, y: number): [number, number] {
    return [(x - this.cx) * this.scale + this.W / 2, -(y - this.cy) * this.scale + this.H / 2];
  }

  toWorld(px: number, py: number): [number, number] {
    return [(px - this.W / 2) / this.scale + this.cx, -(py - this.H / 2) / this.scale + this.cy];
  }

  zoomAt(px: number, py: number, f: number) {
    const [wx, wy] = this.toWorld(px, py);
    this.scale = clamp(this.scale * f, 0.02, 14);
    this.cx = wx - (px - this.W / 2) / this.scale;
    this.cy = wy + (py - this.H / 2) / this.scale;
  }

  pan(dx: number, dy: number) {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }

  fit(b: [number, number, number, number], pad = 0.92) {
    this.cx = (b[0] + b[2]) / 2;
    this.cy = (b[1] + b[3]) / 2;
    this.scale = clamp(
      Math.min(this.W / Math.max(50, b[2] - b[0]), this.H / Math.max(50, b[3] - b[1])) * pad,
      0.02,
      14
    );
  }
}
