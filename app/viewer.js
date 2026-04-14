const fmtNum = (val, digits = 2) => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return "N/A";
  return Number(val).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
};

const fmtBn = (val) => {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return "N/A";
  return `${(Number(val) / 1e9).toFixed(2)} Bn`;
};

const state = {
  payload: null,
  symbol: null,
  bucket: "core",
};

function getSymbolEntry() {
  if (!state.payload || !Array.isArray(state.payload.symbols)) return null;
  return state.payload.symbols.find((item) => item.symbol === state.symbol) || null;
}

function renderMeta() {
  const meta = state.payload?.meta || {};
  const line = document.getElementById("metaLine");
  line.textContent = `Run #${meta.run_id || "-"} | Last ${meta.finished_at || "-"} | Success ${meta.success_count || 0}, Failed ${meta.failure_count || 0}`;
}

function renderCards(symbolEntry, bucketData) {
  const metric = bucketData?.metric || {};
  const oi = symbolEntry?.oi_summary || {};
  document.getElementById("cardSpot").textContent = `Spot: ${fmtNum(metric.spot)}`;
  document.getElementById("cardSign").textContent = `Sign: ${metric.sign || "N/A"} | Net ${fmtBn(metric.net_gex)}`;
  document.getElementById("cardFlip").textContent = `Flip: ${fmtNum(metric.flip_price)}`;
  document.getElementById("cardWalls").textContent =
    `Call ${fmtNum(metric.call_wall)} | Put ${fmtNum(metric.put_wall)} | OI ${oi.contracts || 0}`;
}

function renderLevels(bucketData) {
  const metric = bucketData?.metric || {};
  const strikes = bucketData?.strike_profile || [];
  const x = strikes.map((r) => Number(r.strike));
  const callY = strikes.map((r) => Number(r.call_gex || 0) / 1e9);
  const putY = strikes.map((r) => Number(r.put_gex || 0) / 1e9);
  const netY = strikes.map((r) => Number(r.net_gex || 0) / 1e9);

  const traces = [
    { type: "bar", x, y: callY, name: "Call GEX", marker: { color: "#2C7FB8" }, opacity: 0.7 },
    { type: "bar", x, y: putY, name: "Put GEX", marker: { color: "#F03B20" }, opacity: 0.7 },
    { type: "scatter", mode: "lines+markers", x, y: netY, name: "Net GEX", line: { color: "#1B9E77", width: 2 } },
  ];

  const shapes = [];
  if (metric.spot != null) {
    shapes.push({ type: "line", x0: metric.spot, x1: metric.spot, y0: 0, y1: 1, yref: "paper", line: { color: "#FF8C00", width: 2 } });
  }
  if (metric.call_wall != null) {
    shapes.push({ type: "line", x0: metric.call_wall, x1: metric.call_wall, y0: 0, y1: 1, yref: "paper", line: { color: "#2C7FB8", width: 1, dash: "dash" } });
  }
  if (metric.put_wall != null) {
    shapes.push({ type: "line", x0: metric.put_wall, x1: metric.put_wall, y0: 0, y1: 1, yref: "paper", line: { color: "#F03B20", width: 1, dash: "dash" } });
  }
  if (metric.flip_price != null) {
    shapes.push({ type: "line", x0: metric.flip_price, x1: metric.flip_price, y0: 0, y1: 1, yref: "paper", line: { color: "#111111", width: 1, dash: "dot" } });
  }

  Plotly.newPlot("levelsChart", traces, {
    barmode: "overlay",
    margin: { l: 45, r: 10, t: 8, b: 45 },
    xaxis: { title: "Strike" },
    yaxis: { title: "GEX (Bn$ per 1% move)" },
    legend: { orientation: "h" },
    shapes,
    paper_bgcolor: "#171c25",
    plot_bgcolor: "#171c25",
    font: { color: "#f2f3f5" },
  }, { responsive: true, displaylogo: false });
}

function renderFlip(bucketData) {
  const curve = bucketData?.gex_curve || [];
  const x = curve.map((r) => Number(r.spot));
  const y = curve.map((r) => Number(r.net_gex || 0) / 1e9);
  Plotly.newPlot("flipChart", [
    { type: "scatter", mode: "lines", x, y, line: { color: "#7E57C2", width: 2 }, name: "Net GEX Curve" },
  ], {
    margin: { l: 45, r: 10, t: 8, b: 45 },
    xaxis: { title: "Spot" },
    yaxis: { title: "Total Net GEX (Bn$ per 1% move)", zeroline: true },
    paper_bgcolor: "#171c25",
    plot_bgcolor: "#171c25",
    font: { color: "#f2f3f5" },
  }, { responsive: true, displaylogo: false });
}

function renderOI(bucketData) {
  const rows = bucketData?.top_oi || [];
  const wrap = document.getElementById("oiTableWrap");
  if (!rows.length) {
    wrap.innerHTML = "<div>No OI rows.</div>";
    return;
  }
  const body = rows.slice(0, 20).map((r) => {
    const cp = String(r.option_type || "").toLowerCase().startsWith("c") ? "C" : "P";
    return `<tr><td>${r.expiration || "-"}</td><td>${fmtNum(r.strike)}</td><td>${cp}</td><td>${Number(r.open_interest || 0).toLocaleString()}</td></tr>`;
  }).join("");
  wrap.innerHTML = `
    <table>
      <thead><tr><th>Exp</th><th>Strike</th><th>Type</th><th>OI</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderAll() {
  const symbolEntry = getSymbolEntry();
  if (!symbolEntry) return;
  const bucketData = symbolEntry.buckets?.[state.bucket] || {};
  renderCards(symbolEntry, bucketData);
  renderLevels(bucketData);
  renderFlip(bucketData);
  renderOI(bucketData);
}

async function loadSnapshot() {
  const resp = await fetch(`./latest.json?v=${Date.now()}`);
  if (!resp.ok) throw new Error(`Failed to load latest.json (${resp.status})`);
  state.payload = await resp.json();
  renderMeta();

  const select = document.getElementById("symbolSelect");
  const symbols = (state.payload.symbols || []).map((x) => x.symbol).sort();
  select.innerHTML = symbols.map((s) => `<option value="${s}">${s}</option>`).join("");
  if (symbols.length) state.symbol = symbols[0];
  select.value = state.symbol || "";
  select.addEventListener("change", () => {
    state.symbol = select.value;
    renderAll();
  });

  const bucketSelect = document.getElementById("bucketSelect");
  bucketSelect.value = state.bucket;
  bucketSelect.addEventListener("change", () => {
    state.bucket = bucketSelect.value;
    renderAll();
  });

  renderAll();
}

loadSnapshot().catch((err) => {
  document.getElementById("metaLine").textContent = `Load failed: ${err.message}`;
});

