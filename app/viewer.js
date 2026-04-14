const CFG = {
  bg: "#171c25",
  text: "#f2f3f5",
  grid: "#2d3646",
  call: "#2C7FB8",
  put: "#F03B20",
  net: "#1B9E77",
  spot: "#FF8C00",
  flip: "#111111",
  front: "#27ae60",
  core: "#2980b9",
  medium: "#f39c12",
};

const TAB_HINTS = {
  levels:
    "Levels Map: bars are call/put gamma by strike, and green line is net gamma. Use spot/call wall/put wall/flip vertical lines as your key levels.",
  flip:
    "Flip Map: net gamma curve across hypothetical spot prices. Above zero means positive-gamma zone, below zero means negative-gamma zone.",
  trend:
    "Trend: run-to-run net gamma history in your browser timezone. Hover points to read exact time and value.",
  buckets:
    "3 Buckets: compare Front/Core/Medium bucket net gamma line on the same strike axis.",
  oi:
    "Highest OI: top call/put contracts ranked by open interest. You can filter by expiration above.",
  heatmap:
    "Gamma Heatmap: strike on Y, run time on X, blue=positive gamma, red=negative gamma; black line is spot path.",
};

const state = {
  payload: null,
  symbol: null,
  bucket: "core",
  activeTab: "levels",
  selectedExpirations: new Set(),
  expTouched: false,
};

const toNum = (val) => {
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
};

const safeText = (val) => {
  if (val === null || val === undefined) return "";
  return String(val);
};

const fmtNum = (val, digits = 2) => {
  const n = toNum(val);
  if (n === null) return "N/A";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

const fmtBn = (val) => {
  const n = toNum(val);
  if (n === null) return "N/A";
  return `${(n / 1e9).toFixed(2)} Bn`;
};

const fmtInt = (val) => {
  const n = toNum(val);
  if (n === null) return "N/A";
  return Math.round(n).toLocaleString();
};

const fmtExp = (val) => {
  const raw = safeText(val).trim();
  if (!raw) return "-";
  try {
    const dt = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(dt.getTime())) return raw;
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const dd = String(dt.getDate()).padStart(2, "0");
    const yy = String(dt.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  } catch {
    return raw;
  }
};

const parseTime = (val) => {
  if (!val) return null;
  const dt = new Date(val);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const baseLayout = (titleX, titleY) => ({
  margin: { l: 64, r: 18, t: 20, b: 46 },
  xaxis: {
    title: titleX,
    gridcolor: CFG.grid,
    zeroline: true,
    zerolinecolor: "#7b8798",
    zerolinewidth: 1,
  },
  yaxis: {
    title: titleY,
    gridcolor: CFG.grid,
    zeroline: true,
    zerolinecolor: "#7b8798",
    zerolinewidth: 1,
  },
  dragmode: "pan",
  paper_bgcolor: CFG.bg,
  plot_bgcolor: CFG.bg,
  font: { color: CFG.text },
  legend: { orientation: "h" },
};

const baseConfig = {
  responsive: true,
  displaylogo: false,
  scrollZoom: true,
  doubleClick: "reset",
};

function getSymbols() {
  const symbols = (state.payload?.symbols || []).map((item) => safeText(item.symbol).toUpperCase()).filter(Boolean);
  return symbols.sort();
}

function getSymbolEntry(sym = state.symbol) {
  const symbols = state.payload?.symbols || [];
  return symbols.find((item) => safeText(item.symbol).toUpperCase() === safeText(sym).toUpperCase()) || null;
}

function getBucketData(symbolEntry, bucket = state.bucket) {
  const buckets = symbolEntry?.buckets || {};
  if (buckets[bucket]) return buckets[bucket];
  if (buckets.core) return buckets.core;
  const keys = Object.keys(buckets);
  return keys.length ? buckets[keys[0]] : {};
}

function getMetric(symbolEntry, bucket = state.bucket) {
  return getBucketData(symbolEntry, bucket)?.metric || {};
}

function getDefaultPriceRange(spot) {
  const s = toNum(spot);
  if (s === null || s <= 0) return null;
  return [s * 0.95, s * 1.05];
}

function sourceBadgeClass(source) {
  const src = safeText(source).toLowerCase();
  if (src.includes("ibkr") && src.includes("yahoo")) return "mix";
  if (src.includes("ibkr")) return "ibkr";
  if (src.includes("yahoo")) return "yahoo";
  return "ibkr";
}

function sourceBadgeText(source) {
  const src = safeText(source).toLowerCase();
  if (src.includes("ibkr") && src.includes("yahoo")) return "I+Y";
  if (src.includes("yahoo")) return "Y";
  if (src.includes("ibkr")) return "I";
  return "?";
}

function renderMeta() {
  const meta = state.payload?.meta || {};
  const finishedAt = parseTime(meta.finished_at);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  const finishedText = finishedAt ? finishedAt.toLocaleString() : safeText(meta.finished_at || "-");
  const line = document.getElementById("metaLine");
  line.textContent = `Run #${meta.run_id || "-"} | Last ${finishedText} (${tz}) | Success ${meta.success_count || 0} | Failed ${meta.failure_count || 0}`;
}

function renderSymbolSelect() {
  const symbols = getSymbols();
  const sel = document.getElementById("symbolSelect");
  sel.innerHTML = symbols.map((sym) => `<option value="${sym}">${sym}</option>`).join("");
  if (!state.symbol || !symbols.includes(state.symbol)) {
    state.symbol = symbols[0] || null;
    state.selectedExpirations = new Set();
    state.expTouched = false;
  }
  sel.value = state.symbol || "";
}

function renderSnapshotTable() {
  const body = document.getElementById("snapshotBody");
  const symbols = getSymbols();
  const rows = [];

  for (const sym of symbols) {
    const entry = getSymbolEntry(sym);
    const metric = getMetric(entry, state.bucket);
    const badgeCls = sourceBadgeClass(entry?.source);
    const badgeText = sourceBadgeText(entry?.source);
    const activeCls = sym === state.symbol ? "active" : "";
    rows.push(`
      <tr data-symbol="${sym}" class="${activeCls}">
        <td class="symbol-cell">${sym}</td>
        <td><span class="badge ${badgeCls}" title="${safeText(entry?.source) || "unknown"}">${badgeText}</span></td>
        <td>${fmtNum(metric.spot)}</td>
        <td>${safeText(metric.sign || "N/A")}</td>
        <td>${fmtBn(metric.net_gex)}</td>
        <td>${fmtNum(metric.call_wall)}</td>
        <td>${fmtNum(metric.put_wall)}</td>
        <td>${fmtNum(metric.flip_price)}</td>
      </tr>
    `);
  }

  body.innerHTML = rows.join("");
  body.querySelectorAll("tr[data-symbol]").forEach((row) => {
    row.addEventListener("click", () => {
      const symbol = safeText(row.dataset.symbol).toUpperCase();
      state.symbol = symbol;
      state.selectedExpirations = new Set();
      state.expTouched = false;
      document.getElementById("symbolSelect").value = symbol;
      renderAll();
    });
  });

  const activeEntry = getSymbolEntry();
  const note = document.getElementById("leftNote");
  const msg = safeText(activeEntry?.error || "").trim();
  note.textContent = msg || `Loaded ${symbols.length} symbol(s).`;
}

function renderCards(symbolEntry, bucketData) {
  const metric = bucketData?.metric || {};
  const oi = symbolEntry?.oi_summary || {};
  const source = safeText(symbolEntry?.source || "unknown");
  document.getElementById("cardSpot").textContent = `Spot: ${fmtNum(metric.spot)}`;
  document.getElementById("cardSign").textContent = `Sign: ${safeText(metric.sign || "N/A")} | Net ${fmtBn(metric.net_gex)}`;
  document.getElementById("cardFlip").textContent = `Flip: ${fmtNum(metric.flip_price)} | Source: ${source}`;
  document.getElementById("cardWalls").textContent = `CallW ${fmtNum(metric.call_wall)} | PutW ${fmtNum(metric.put_wall)} | OI ${fmtInt(oi.contracts)}`;
}

function getOIRows(symbolEntry) {
  const rows = Array.isArray(symbolEntry?.oi_rows) ? symbolEntry.oi_rows.slice() : [];
  if (rows.length) return rows;
  const bucket = getBucketData(symbolEntry);
  const fallback = Array.isArray(bucket?.top_oi) ? bucket.top_oi : [];
  return fallback.map((row) => ({
    expiration: row.expiration,
    strike: row.strike,
    option_type: row.option_type,
    open_interest: row.open_interest,
  }));
}

function getAllExpirations(symbolEntry) {
  const listed = Array.isArray(symbolEntry?.oi_expirations) ? symbolEntry.oi_expirations.slice() : [];
  if (listed.length) {
    return listed.map((v) => safeText(v)).filter(Boolean).sort();
  }
  const rows = getOIRows(symbolEntry);
  return [...new Set(rows.map((r) => safeText(r.expiration)).filter(Boolean))].sort();
}

function ensureExpirationSelection(expirations) {
  if (!expirations.length) {
    state.selectedExpirations = new Set();
    state.expTouched = false;
    return;
  }
  if (!state.expTouched && state.selectedExpirations.size === 0) {
    state.selectedExpirations = new Set(expirations);
    return;
  }

  const next = new Set();
  for (const exp of expirations) {
    if (state.selectedExpirations.has(exp)) next.add(exp);
  }
  state.selectedExpirations = next;
}

function updateExpirationSummary(all) {
  const summary = document.getElementById("oiExpSummary");
  const total = all.length;
  const selected = state.selectedExpirations.size;
  if (!total) {
    summary.textContent = "No expiration rows";
    return;
  }
  if (selected === 0) summary.textContent = "None selected";
  else if (selected === total) summary.textContent = "All expirations";
  else summary.textContent = `${selected}/${total} selected`;
}

function renderOIExpirationFilter(symbolEntry) {
  const holder = document.getElementById("oiExpirations");
  const expirations = getAllExpirations(symbolEntry);
  holder.innerHTML = "";

  ensureExpirationSelection(expirations);

  for (const exp of expirations) {
    const id = `exp-${exp.replace(/[^0-9]/g, "")}`;
    const checked = state.selectedExpirations.has(exp) ? "checked" : "";
    const row = document.createElement("label");
    row.className = "oi-exp-item";
    row.innerHTML = `<input id="${id}" type="checkbox" value="${exp}" ${checked} /> ${fmtExp(exp)} (${exp})`;
    holder.appendChild(row);
  }

  holder.querySelectorAll("input[type='checkbox']").forEach((el) => {
    el.addEventListener("change", () => {
      const exp = safeText(el.value);
      state.expTouched = true;
      if (el.checked) state.selectedExpirations.add(exp);
      else state.selectedExpirations.delete(exp);
      updateExpirationSummary(expirations);
      renderOI(symbolEntry);
    });
  });

  document.getElementById("oiAllBtn").onclick = () => {
    state.selectedExpirations = new Set(expirations);
    state.expTouched = true;
    renderOIExpirationFilter(symbolEntry);
    renderOI(symbolEntry);
  };

  document.getElementById("oiNoneBtn").onclick = () => {
    state.selectedExpirations = new Set();
    state.expTouched = true;
    renderOIExpirationFilter(symbolEntry);
    renderOI(symbolEntry);
  };

  updateExpirationSummary(expirations);
}

function getFilteredOIRows(symbolEntry) {
  const rows = getOIRows(symbolEntry);
  if (!rows.length) return [];
  if (!state.selectedExpirations.size) return [];
  return rows.filter((row) => state.selectedExpirations.has(safeText(row.expiration)));
}

function annotateLines(metric) {
  const shapes = [];
  const annotations = [];

  if (metric.call_wall != null && metric.put_wall != null) {
    const left = Math.min(metric.call_wall, metric.put_wall);
    const right = Math.max(metric.call_wall, metric.put_wall);
    shapes.push({
      type: "rect",
      x0: left,
      x1: right,
      y0: 0,
      y1: 1,
      yref: "paper",
      fillcolor: "rgba(125, 190, 180, 0.14)",
      line: { width: 0 },
      layer: "below",
    });
  }

  if (metric.spot != null) {
    shapes.push({ type: "line", x0: metric.spot, x1: metric.spot, y0: 0, y1: 1, yref: "paper", line: { color: CFG.spot, width: 2 } });
    annotations.push({ x: metric.spot, y: 0.95, yref: "paper", text: `Spot ${fmtNum(metric.spot)}`, showarrow: false, font: { color: CFG.spot, size: 11 } });
  }
  if (metric.call_wall != null) {
    shapes.push({ type: "line", x0: metric.call_wall, x1: metric.call_wall, y0: 0, y1: 1, yref: "paper", line: { color: CFG.call, width: 1.3, dash: "dash" } });
    annotations.push({ x: metric.call_wall, y: 0.08, yref: "paper", text: `CallW ${fmtNum(metric.call_wall)}`, showarrow: false, font: { color: CFG.call, size: 10 } });
  }
  if (metric.put_wall != null) {
    shapes.push({ type: "line", x0: metric.put_wall, x1: metric.put_wall, y0: 0, y1: 1, yref: "paper", line: { color: CFG.put, width: 1.3, dash: "dash" } });
    annotations.push({ x: metric.put_wall, y: 0.14, yref: "paper", text: `PutW ${fmtNum(metric.put_wall)}`, showarrow: false, font: { color: CFG.put, size: 10 } });
  }
  if (metric.flip_price != null) {
    shapes.push({ type: "line", x0: metric.flip_price, x1: metric.flip_price, y0: 0, y1: 1, yref: "paper", line: { color: CFG.flip, width: 1.2, dash: "dot" } });
    annotations.push({ x: metric.flip_price, y: 0.02, yref: "paper", text: `Flip ${fmtNum(metric.flip_price)}`, showarrow: false, font: { color: "#d8d8d8", size: 10 } });
  }

  return { shapes, annotations };
}

function renderLevels(bucketData) {
  const metric = bucketData?.metric || {};
  const rows = Array.isArray(bucketData?.strike_profile) ? bucketData.strike_profile : [];
  if (!rows.length) {
    Plotly.newPlot(
      "levelsChart",
      [],
      {
        ...baseLayout("Strike", "Gamma (Bn$ per 1% move)"),
        annotations: [{ text: "No strike profile.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
      },
      baseConfig,
    );
    return;
  }

  const x = rows.map((r) => toNum(r.strike));
  const callY = rows.map((r) => (toNum(r.call_gex) || 0) / 1e9);
  const putY = rows.map((r) => (toNum(r.put_gex) || 0) / 1e9);
  const netY = rows.map((r) => (toNum(r.net_gex) || 0) / 1e9);

  const traces = [
    { type: "bar", x, y: callY, name: "Call GEX", marker: { color: CFG.call }, opacity: 0.62, hovertemplate: "Strike %{x}<br>Call %{y:.3f} Bn<extra></extra>" },
    { type: "bar", x, y: putY, name: "Put GEX", marker: { color: CFG.put }, opacity: 0.62, hovertemplate: "Strike %{x}<br>Put %{y:.3f} Bn<extra></extra>" },
    {
      type: "scatter",
      mode: "lines+markers",
      x,
      y: netY,
      name: "Net GEX",
      line: { color: CFG.net, width: 2 },
      marker: { size: 4 },
      hovertemplate: "Strike %{x}<br>Net %{y:.3f} Bn<extra></extra>",
    },
  ];

  const lines = annotateLines(metric);
  const xRange = getDefaultPriceRange(metric.spot);

  Plotly.newPlot(
    "levelsChart",
    traces,
    {
      ...baseLayout("Strike", "Gamma (Bn$ per 1% move)"),
      barmode: "overlay",
      shapes: lines.shapes,
      annotations: lines.annotations,
      xaxis: {
        ...baseLayout("", "").xaxis,
        title: "Strike",
        range: xRange || undefined,
      },
    },
    baseConfig,
  );
}

function renderFlip(bucketData) {
  const metric = bucketData?.metric || {};
  const curve = Array.isArray(bucketData?.gex_curve) ? bucketData.gex_curve : [];
  if (!curve.length) {
    Plotly.newPlot(
      "flipChart",
      [],
      {
        ...baseLayout("Spot", "Net GEX (Bn$ per 1% move)"),
        annotations: [{ text: "No flip curve.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
      },
      baseConfig,
    );
    return;
  }

  const x = curve.map((r) => toNum(r.spot));
  const y = curve.map((r) => (toNum(r.net_gex) || 0) / 1e9);
  const yPos = y.map((v) => (v >= 0 ? v : null));
  const yNeg = y.map((v) => (v <= 0 ? v : null));

  const traces = [
    { type: "scatter", mode: "lines", x, y: yPos, line: { color: "#2e7d32", width: 1.2 }, name: "Positive Zone", fill: "tozeroy", fillcolor: "rgba(46,125,50,0.18)", hoverinfo: "skip" },
    { type: "scatter", mode: "lines", x, y: yNeg, line: { color: "#b71c1c", width: 1.2 }, name: "Negative Zone", fill: "tozeroy", fillcolor: "rgba(183,28,28,0.18)", hoverinfo: "skip" },
    { type: "scatter", mode: "lines", x, y, line: { color: "#7E57C2", width: 2.2 }, name: "Net GEX Curve", hovertemplate: "Spot %{x:.2f}<br>Net %{y:.3f} Bn<extra></extra>" },
  ];

  const shapes = [{ type: "line", x0: Math.min(...x), x1: Math.max(...x), y0: 0, y1: 0, line: { color: "#90a4ae", width: 1 } }];
  if (metric.spot != null) shapes.push({ type: "line", x0: metric.spot, x1: metric.spot, y0: 0, y1: 1, yref: "paper", line: { color: CFG.spot, width: 1.6 } });
  if (metric.flip_price != null) shapes.push({ type: "line", x0: metric.flip_price, x1: metric.flip_price, y0: 0, y1: 1, yref: "paper", line: { color: CFG.flip, width: 1.2, dash: "dot" } });

  const xRange = getDefaultPriceRange(metric.spot);

  Plotly.newPlot(
    "flipChart",
    traces,
    {
      ...baseLayout("Hypothetical Spot Price", "Net GEX (Bn$ per 1% move)"),
      shapes,
      xaxis: {
        ...baseLayout("", "").xaxis,
        title: "Hypothetical Spot Price",
        range: xRange || undefined,
      },
    },
    baseConfig,
  );
}

function renderTrend(bucketData) {
  const history = Array.isArray(bucketData?.history) ? bucketData.history.slice() : [];
  if (!history.length) {
    Plotly.newPlot(
      "trendChart",
      [],
      {
        ...baseLayout("Run Time", "Net GEX (Bn$ per 1% move)"),
        annotations: [{ text: "No trend history.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
      },
      baseConfig,
    );
    return;
  }

  history.sort((a, b) => {
    const ta = parseTime(a.finished_at)?.getTime() || 0;
    const tb = parseTime(b.finished_at)?.getTime() || 0;
    return ta - tb;
  });

  const x = history.map((r) => parseTime(r.finished_at));
  const y = history.map((r) => (toNum(r.net_gex) || 0) / 1e9);

  Plotly.newPlot(
    "trendChart",
    [
      {
        type: "scatter",
        mode: "lines+markers",
        x,
        y,
        line: { color: "#1B9E77", width: 2 },
        marker: { size: 6 },
        name: "Net GEX",
        customdata: history.map((r) => [toNum(r.spot), toNum(r.flip_price), safeText(r.sign)]),
        hovertemplate:
          "Time %{x|%Y-%m-%d %H:%M}<br>Net %{y:.3f} Bn<br>Spot %{customdata[0]:.2f}<br>Flip %{customdata[1]:.2f}<br>Sign %{customdata[2]}<extra></extra>",
      },
    ],
    {
      ...baseLayout("Run Time", "Net GEX (Bn$ per 1% move)"),
      xaxis: { title: "Run Time", type: "date", gridcolor: CFG.grid },
    },
    baseConfig,
  );
}

function renderBucketCompare(symbolEntry) {
  const buckets = ["front", "core", "medium"];
  const labels = { front: "Front (0-7)", core: "Core (8-90)", medium: "Medium (46-90)" };
  const colors = { front: CFG.front, core: CFG.core, medium: CFG.medium };
  const traces = [];

  for (const bucket of buckets) {
    const data = getBucketData(symbolEntry, bucket);
    const rows = Array.isArray(data?.strike_profile) ? data.strike_profile : [];
    if (!rows.length) continue;
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      x: rows.map((r) => toNum(r.strike)),
      y: rows.map((r) => (toNum(r.net_gex) || 0) / 1e9),
      name: labels[bucket],
      line: { color: colors[bucket], width: 2 },
      marker: { size: 3 },
      hovertemplate: `${labels[bucket]}<br>Strike %{x}<br>Net %{y:.3f} Bn<extra></extra>`,
    });
  }

  if (!traces.length) {
    Plotly.newPlot(
      "bucketChart",
      [],
      {
        ...baseLayout("Strike", "Net GEX (Bn$ per 1% move)"),
        annotations: [{ text: "No bucket comparison data.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
      },
      baseConfig,
    );
    return;
  }

  const metric = getMetric(symbolEntry, state.bucket);
  const xRange = getDefaultPriceRange(metric.spot);
  const shapes = [];
  if (metric.spot != null) {
    shapes.push({
      type: "line",
      x0: metric.spot,
      x1: metric.spot,
      y0: 0,
      y1: 1,
      yref: "paper",
      line: { color: CFG.spot, width: 1.8 },
    });
  }

  Plotly.newPlot(
    "bucketChart",
    traces,
    {
      ...baseLayout("Strike", "Net GEX (Bn$ per 1% move)"),
      shapes,
      xaxis: {
        ...baseLayout("", "").xaxis,
        title: "Strike",
        range: xRange || undefined,
      },
    },
    baseConfig,
  );
}

function renderOI(symbolEntry) {
  const rows = getFilteredOIRows(symbolEntry);
  const top = rows
    .slice()
    .sort((a, b) => (toNum(b.open_interest) || 0) - (toNum(a.open_interest) || 0))
    .slice(0, 24);

  if (!top.length) {
    Plotly.newPlot(
      "oiChart",
      [],
      {
        ...baseLayout("Open Interest", "Contract"),
        annotations: [{ text: "No OI rows for selected expiration(s).", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
      },
      baseConfig,
    );
    document.getElementById("oiTableWrap").innerHTML = "<div class=\"hint\">No OI rows for selected expiration(s).</div>";
    return;
  }

  const makeLabel = (r) => {
    const cp = safeText(r.option_type).toLowerCase().startsWith("c") ? "C" : "P";
    return `${symbolEntry.symbol} ${fmtExp(r.expiration)} ${fmtNum(r.strike)}${cp}`;
  };

  const calls = top.filter((r) => safeText(r.option_type).toLowerCase().startsWith("c"));
  const puts = top.filter((r) => safeText(r.option_type).toLowerCase().startsWith("p"));

  const maxOi = Math.max(1, ...top.map((r) => toNum(r.open_interest) || 0));

  Plotly.newPlot(
    "oiChart",
    [
      {
        type: "bar",
        orientation: "h",
        x: calls.map((r) => toNum(r.open_interest) || 0),
        y: calls.map(makeLabel),
        marker: { color: CFG.call },
        name: "Calls",
        text: calls.map((r) => fmtInt(r.open_interest)),
        textposition: "outside",
        cliponaxis: false,
        hovertemplate: "%{y}<br>OI %{x:,}<extra></extra>",
      },
      {
        type: "bar",
        orientation: "h",
        x: puts.map((r) => toNum(r.open_interest) || 0),
        y: puts.map(makeLabel),
        marker: { color: "#E58A8A" },
        name: "Puts",
        text: puts.map((r) => fmtInt(r.open_interest)),
        textposition: "outside",
        cliponaxis: false,
        hovertemplate: "%{y}<br>OI %{x:,}<extra></extra>",
      },
    ],
    {
      ...baseLayout("Open Interest", ""),
      barmode: "overlay",
      margin: { l: 240, r: 24, t: 10, b: 36 },
      xaxis: { title: "Open Interest", range: [0, maxOi * 1.2], gridcolor: CFG.grid },
      yaxis: { automargin: true },
    },
    baseConfig,
  );

  const body = top
    .map((r) => {
      const cp = safeText(r.option_type).toLowerCase().startsWith("c") ? "C" : "P";
      return `<tr><td>${fmtExp(r.expiration)}</td><td>${fmtNum(r.strike)}</td><td>${cp}</td><td>${fmtInt(r.open_interest)}</td></tr>`;
    })
    .join("");

  document.getElementById("oiTableWrap").innerHTML = `
    <table>
      <thead><tr><th>Expiration</th><th>Strike</th><th>Type</th><th>Open Interest</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderHeatmap(bucketData) {
  const rows = Array.isArray(bucketData?.heatmap_history) ? bucketData.heatmap_history : [];
  if (!rows.length) {
    Plotly.newPlot(
      "heatmapChart",
      [],
      {
        ...baseLayout("Run Time", "Strike"),
        annotations: [{ text: "No gamma heatmap history.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
      },
      baseConfig,
    );
    return;
  }

  const items = rows
    .map((r) => ({
      t: parseTime(r.finished_at),
      strike: toNum(r.strike),
      net: (toNum(r.net_gex) || 0) / 1e9,
      spot: toNum(r.spot),
    }))
    .filter((r) => r.t && r.strike !== null);

  if (!items.length) {
    Plotly.newPlot(
      "heatmapChart",
      [],
      {
        ...baseLayout("Run Time", "Strike"),
        annotations: [{ text: "No gamma heatmap history.", x: 0.5, y: 0.5, xref: "paper", yref: "paper", showarrow: false }],
      },
      baseConfig,
    );
    return;
  }

  items.sort((a, b) => a.t.getTime() - b.t.getTime() || a.strike - b.strike);
  const times = [...new Map(items.map((r) => [r.t.toISOString(), r.t])).values()];
  const strikes = [...new Set(items.map((r) => r.strike))].sort((a, b) => a - b);

  const xIndex = new Map(times.map((t, i) => [t.toISOString(), i]));
  const yIndex = new Map(strikes.map((s, i) => [String(s), i]));
  const z = strikes.map(() => times.map(() => null));

  for (const it of items) {
    const xi = xIndex.get(it.t.toISOString());
    const yi = yIndex.get(String(it.strike));
    if (xi === undefined || yi === undefined) continue;
    z[yi][xi] = it.net;
  }

  const absVals = z.flat().filter((v) => typeof v === "number").map((v) => Math.abs(v));
  let maxAbs = 1;
  if (absVals.length) {
    absVals.sort((a, b) => a - b);
    const idx = Math.floor(absVals.length * 0.98);
    maxAbs = absVals[Math.max(0, Math.min(idx, absVals.length - 1))] || 1;
  }

  const spotByTime = new Map();
  for (const it of items) {
    if (it.spot !== null) spotByTime.set(it.t.toISOString(), it.spot);
  }

  Plotly.newPlot(
    "heatmapChart",
    [
      {
        type: "heatmap",
        x: times,
        y: strikes,
        z,
        zmid: 0,
        zmin: -maxAbs,
        zmax: maxAbs,
        colorscale: [
          [0.0, "#d73027"],
          [0.5, "#f7f7f7"],
          [1.0, "#4575b4"],
        ],
        colorbar: { title: "Net GEX (Bn)" },
        hovertemplate: "Time %{x|%Y-%m-%d %H:%M}<br>Strike %{y:.2f}<br>Net %{z:.3f} Bn<extra></extra>",
      },
      {
        type: "scatter",
        mode: "lines",
        x: times,
        y: times.map((t) => spotByTime.get(t.toISOString()) ?? null),
        line: { color: "#111111", width: 2 },
        name: "Spot Path",
        hovertemplate: "Time %{x|%Y-%m-%d %H:%M}<br>Spot %{y:.2f}<extra></extra>",
      },
    ],
    {
      ...baseLayout("Run Time", "Strike"),
      xaxis: { title: "Run Time", type: "date", gridcolor: CFG.grid },
      yaxis: { title: "Strike", gridcolor: CFG.grid },
    },
    baseConfig,
  );
}

function setHint() {
  const hint = document.getElementById("chartHint");
  hint.textContent = TAB_HINTS[state.activeTab] || "";
}

function activateTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === `panel-${tabName}`);
  });
  const quick = document.getElementById("tabSelect");
  if (quick.value !== tabName) quick.value = tabName;
  setHint();
}

function renderAll() {
  const symbolEntry = getSymbolEntry();
  if (!symbolEntry) return;

  const bucketData = getBucketData(symbolEntry);
  renderSnapshotTable();
  renderCards(symbolEntry, bucketData);
  renderOIExpirationFilter(symbolEntry);
  renderLevels(bucketData);
  renderFlip(bucketData);
  renderTrend(bucketData);
  renderBucketCompare(symbolEntry);
  renderOI(symbolEntry);
  renderHeatmap(bucketData);
  setHint();
}

function bindEvents() {
  document.getElementById("symbolSelect").addEventListener("change", (ev) => {
    state.symbol = safeText(ev.target.value).toUpperCase();
    state.selectedExpirations = new Set();
    state.expTouched = false;
    renderAll();
  });

  document.getElementById("bucketSelect").addEventListener("change", (ev) => {
    state.bucket = safeText(ev.target.value) || "core";
    renderAll();
  });

  document.getElementById("tabSelect").addEventListener("change", (ev) => {
    activateTab(safeText(ev.target.value) || "levels");
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
}

async function loadSnapshot() {
  const resp = await fetch(`./latest.json?v=${Date.now()}`);
  if (!resp.ok) throw new Error(`Failed to load latest.json (${resp.status})`);
  state.payload = await resp.json();

  renderMeta();
  renderSymbolSelect();
  bindEvents();
  activateTab("levels");
  renderAll();
}

loadSnapshot().catch((err) => {
  const line = document.getElementById("metaLine");
  line.textContent = `Load failed: ${err.message}`;
});
