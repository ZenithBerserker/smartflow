export function fmtPrice(p) {
  if (!p || isNaN(p)) return "--";
  if (p >= 1000) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return "$" + p.toFixed(4);
  if (p >= 0.0001) return "$" + p.toFixed(6);
  return "$" + p.toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
}

export function fmtNum(n) {
  if (!n || isNaN(n)) return "--";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}
