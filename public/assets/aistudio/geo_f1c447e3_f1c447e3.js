// Local flat projection (metres) around an origin. Fine for a town-sized area.
export const Geo = {
  lat0: 16.5, lng0: 121.16, kLat: 110574, kLng: 111320 * Math.cos(16.5 * Math.PI / 180),
  setOrigin(lat, lng) { this.lat0 = lat; this.lng0 = lng; this.kLng = 111320 * Math.cos(lat * Math.PI / 180); },
  xy(p) { return [(p[1] - this.lng0) * this.kLng, (p[0] - this.lat0) * this.kLat]; },
  ll(x, y) { return [this.lat0 + y / this.kLat, this.lng0 + x / this.kLng]; },
  key(p) { return p[0].toFixed(6) + ',' + p[1].toFixed(6); }, // identical coordinates = same junction node
  dist(a, b) { const [ax, ay] = this.xy(a), [bx, by] = this.xy(b); return Math.hypot(bx - ax, by - ay); }
};
