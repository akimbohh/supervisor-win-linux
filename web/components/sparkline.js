// Tiny sparkline renderer — SVG path, fill area + line stroke.
// Usage: sparkline(values, { width: 180, height: 32, max?, min? }) → SVGElement

(function () {
  function sparkline(values, opts = {}) {
    const w = opts.width || 180;
    const h = opts.height || 32;
    const xmlns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(xmlns, 'svg');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);

    const v = (values || []).filter(n => typeof n === 'number' && !isNaN(n));
    if (!v.length) return svg;

    const max = opts.max != null ? opts.max : Math.max(...v, 1);
    const min = opts.min != null ? opts.min : Math.min(...v, 0);
    const span = Math.max(max - min, 0.0001);
    const n = v.length;

    function pt(i, val) {
      const x = n === 1 ? w / 2 : (i / (n - 1)) * w;
      const y = h - ((val - min) / span) * (h - 2) - 1;
      return [x, y];
    }
    let line = '';
    let area = '';
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, v[i]);
      line += (i === 0 ? 'M ' : 'L ') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
    }
    area = line + 'L ' + w + ' ' + h + ' L 0 ' + h + ' Z';
    const a = document.createElementNS(xmlns, 'path');
    a.setAttribute('class', 'area'); a.setAttribute('d', area);
    const l = document.createElementNS(xmlns, 'path');
    l.setAttribute('class', 'line'); l.setAttribute('d', line);
    svg.appendChild(a); svg.appendChild(l);
    return svg;
  }
  window.sparkline = sparkline;
})();
