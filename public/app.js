const $ = (selector) => document.querySelector(selector);
let configuration, snapshot, selectedAgent = 'codex', refreshing = false, toastTimer;
const agentSettings = {
  codex: { file: '~/.codex/config.toml', help: 'Add this entry to your Codex configuration, then start a new session. In the app, you can also add the URL under MCP server settings.', docs: 'https://developers.openai.com/codex/mcp/', code: url => `[mcp_servers.graphrail]\nurl = ${JSON.stringify(url)}` },
  claude: { file: 'Run in your terminal', help: 'Run this command in your project, then use /mcp in Claude Code to check the connection.', docs: 'https://code.claude.com/docs/en/mcp', code: url => `claude mcp add --transport http graphrail ${JSON.stringify(url)}` },
  cursor: { file: '.cursor/mcp.json', help: 'Merge this entry into .cursor/mcp.json in your project. Enable GraphRail in Cursor’s MCP settings.', docs: 'https://cursor.com/docs/mcp', code: url => JSON.stringify({ mcpServers: { graphrail: { url } } }, null, 2) },
  other: { file: 'Remote MCP server settings', help: 'Choose a remote Streamable HTTP server. Paste the URL into your client’s server URL field. No GraphRail authentication header is needed for free tools.', docs: 'https://modelcontextprotocol.io/docs/develop/connect-remote-servers', code: url => `Name: GraphRail\nTransport: Streamable HTTP\nURL: ${url}\nAuthentication: None (free tools)` },
};
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('show'); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 3000); }
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
  catch { toast('Clipboard unavailable. Select and copy the text manually.'); }
}
function amount(value) {
  const n = BigInt(value), whole = n / 100000000n, fraction = (n % 100000000n).toString().padStart(8, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${fraction ? '.' + fraction : ''}`;
}
function price(value) { return configuration?.asset === '0.0.0' ? `${amount(value)} test HBAR` : `${value} atomic units of ${configuration?.asset ?? 'the configured asset'}`; }
function renderAgent() {
  const entry = agentSettings[selectedAgent];
  for (const tab of document.querySelectorAll('[data-agent]')) {
    const active = tab.dataset.agent === selectedAgent;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  }
  $('#agent-panel').setAttribute('aria-labelledby', `tab-${selectedAgent}`);
  $('#config-file').textContent = entry.file; $('#agent-help').textContent = entry.help;
  $('#agent-docs').href = entry.docs;
  if (configuration) $('#agent-code').textContent = entry.code(configuration.mcpUrl);
}
for (const tab of document.querySelectorAll('[data-agent]')) {
  tab.addEventListener('click', () => { selectedAgent = tab.dataset.agent; renderAgent(); });
  tab.addEventListener('keydown', event => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']; if (!keys.includes(event.key)) return;
    event.preventDefault(); const names = Object.keys(agentSettings), i = names.indexOf(selectedAgent);
    selectedAgent = names[event.key === 'Home' ? 0 : event.key === 'End' ? names.length - 1 : (i + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length];
    renderAgent(); $(`#tab-${selectedAgent}`).focus();
  });
}
$('#copy-config').addEventListener('click', () => copy(agentSettings[selectedAgent].code(configuration.mcpUrl)));
$('#copy-endpoint').addEventListener('click', () => copy(configuration.mcpUrl));
$('#copy-prompt').addEventListener('click', () => copy($('#starter-prompt').textContent));
$('.menu-button').addEventListener('click', () => { const open = $('#nav-links').classList.toggle('open'); $('.menu-button').setAttribute('aria-expanded', String(open)); $('.menu-button').setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation'); });
for (const link of document.querySelectorAll('.nav-links a')) link.addEventListener('click', () => { $('#nav-links').classList.remove('open'); $('.menu-button').setAttribute('aria-expanded', 'false'); $('.menu-button').setAttribute('aria-label', 'Open navigation'); });
function renderCatalog() {
  const container = $('#catalog'), keyword = $('#catalog-search').value.trim().toLowerCase();
  container.replaceChildren();
  const pipelines = snapshot?.pipelines.filter(p => `${p.description} ${p.events.join(' ')} ${p.chain}`.toLowerCase().includes(keyword)) ?? [];
  if (!pipelines.length) {
    const empty = document.createElement('p'); empty.className = 'empty-catalog';
    empty.textContent = !snapshot ? 'The catalog is unavailable. Try refreshing in a moment.' : keyword ? 'No ready pipelines match your search. Try a different keyword.' : 'No pipelines are ready yet. Connect your agent to explore the tools and plan your first service.';
    container.append(empty); return;
  }
  for (const pipeline of pipelines) {
    const card = document.createElement('article'); card.className = 'pipeline-card';
    const body = document.createElement('div'), heading = document.createElement('h4'), detail = document.createElement('p'), button = document.createElement('button');
    heading.textContent = pipeline.description; detail.textContent = `${pipeline.chain} · ${pipeline.events.join(', ')} · ${price(pipeline.pricePerQuery)} / query`;
    body.append(heading, detail); button.className = 'copy-button'; button.textContent = 'Copy pipeline ID ↗'; button.addEventListener('click', () => copy(pipeline.pipelineId));
    card.append(body, button); container.append(card);
  }
}
$('#catalog-search').addEventListener('input', renderCatalog);
async function fetchJSON(url) { const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12000) }); if (!response.ok) throw new Error('Request unavailable'); return response.json(); }
async function loadConfiguration() {
  try {
    configuration = await fetchJSON('/api/public/config');
    $('#endpoint').textContent = configuration.mcpUrl; renderAgent();
    $('#copy-config').disabled = false; $('#copy-endpoint').disabled = false;
    $('#commission-price').textContent = price(configuration.commissionAmount); $('#query-price').textContent = price(configuration.queryAmount);
    if (configuration.temporaryEndpoint) $('#endpoint-note').textContent = 'Temporary test endpoint: available while the operator’s machine and tunnel are running. If the URL changes, update your agent configuration. Paid tools need an x402 wallet helper.';
  } catch {
    $('#agent-code').textContent = 'Connection configuration unavailable. Use Refresh stats to retry.';
    $('#endpoint').textContent = 'Temporarily unavailable';
  }
}
async function refresh() {
  if (refreshing) return; refreshing = true; $('#refresh').disabled = true;
  try {
    if (!configuration) await loadConfiguration();
    snapshot = await fetchJSON('/api/public/stats');
    $('#network').classList.remove('stale');
    $('#stat-ready').textContent = snapshot.readyPipelines.toLocaleString('en-US');
    $('#stat-builds').textContent = snapshot.commissions.toLocaleString('en-US');
    $('#stat-queries').textContent = snapshot.paidQueries.toLocaleString('en-US');
    $('#stat-volume').textContent = snapshot.asset === '0.0.0' ? amount(snapshot.settledAmount) : snapshot.settledAmount;
    $('#volume-label').textContent = snapshot.asset === '0.0.0' ? 'Test HBAR settled' : 'Atomic units settled';
    $('#receipt-count').textContent = `${snapshot.hcsReceipts} HCS RECEIPT${snapshot.hcsReceipts === 1 ? '' : 'S'} RECORDED`;
    const time = new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    $('#stats-freshness').textContent = `LIVE · UPDATED ${time}`;
    $('#service-title').textContent = snapshot.commissioningEnabled ? 'Commissioning is enabled' : 'New builds are paused';
    $('#service-detail').textContent = !snapshot.commissioningEnabled ? `Discovery and planning remain free. ${snapshot.readyPipelines ? 'Ready pipelines can still be queried.' : 'Queries become available when a pipeline is ready.'}` : 'Your agent can request a quote. A paid build requires a prepared deployment slot.';
    renderCatalog();
  } catch {
    $('#network').classList.add('stale');
    $('#stats-freshness').textContent = snapshot ? 'OFFLINE · SHOWING LAST UPDATE' : 'LIVE STATS UNAVAILABLE';
    $('#service-title').textContent = 'Unable to refresh service status';
    $('#service-detail').textContent = snapshot ? 'The figures above are from the last successful update. Retry in a moment.' : 'Check the server connection and try Refresh stats.';
    if (!snapshot) renderCatalog();
  } finally { refreshing = false; $('#refresh').disabled = false; }
}
$('#refresh').addEventListener('click', refresh);
void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });

// An ASCII sphere inspired by the supplied Optimus reference. No image or 3D dependency.
const canvas = $('#sphere'), context = canvas.getContext('2d');
if (context) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)'), points = [], count = 1350;
  for (let i = 0; i < count; i++) { const y = 1 - 2 * i / (count - 1), radius = Math.sqrt(1 - y * y), theta = i * Math.PI * (3 - Math.sqrt(5)); points.push([Math.cos(theta) * radius, y, Math.sin(theta) * radius]); }
  let width = 0, height = 0, visible = true, frame = 0, previous = 0;
  function resize() { const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2); width = rect.width; height = rect.height; canvas.width = width * dpr; canvas.height = height * dpr; context.setTransform(dpr, 0, 0, dpr, 0, 0); draw(0); }
  function draw(time) {
    context.clearRect(0, 0, width, height);
    const angle = reduced.matches ? .45 : time * .00007, radius = Math.min(width, height) * .37;
    const projected = points.map(([x, y, z]) => { const rx = x * Math.cos(angle) + z * Math.sin(angle), rz = -x * Math.sin(angle) + z * Math.cos(angle), ry = y * Math.cos(.27) - rz * Math.sin(.27), depth = y * Math.sin(.27) + rz * Math.cos(.27); return [rx, ry, depth]; }).sort((a, b) => a[2] - b[2]);
    context.textAlign = 'center'; context.textBaseline = 'middle';
    for (const [x, y, z] of projected) { const perspective = 1 + z * .08; context.fillStyle = `rgba(55,67,44,${.09 + (z + 1) * .3})`; context.font = `${8 + (z + 1) * 1.2}px monospace`; context.fillText(z > .5 ? '+' : z > -.2 ? ':' : '.', width / 2 + x * radius * perspective, height / 2 + y * radius * perspective); }
    context.strokeStyle = '#8a977356'; context.lineWidth = .7;
    context.beginPath(); context.ellipse(width / 2, height / 2, radius * 1.27, radius * .41, -.42, 0, Math.PI * 2); context.stroke();
    context.fillStyle = '#7e955c'; const orbit = angle * 3 + .4; const x = Math.cos(orbit) * radius * 1.27, y = Math.sin(orbit) * radius * .41;
    context.fillRect(width / 2 + x * Math.cos(-.42) - y * Math.sin(-.42) - 4, height / 2 + x * Math.sin(-.42) + y * Math.cos(-.42) - 4, 8, 8);
  }
  function tick(time) { frame = 0; if (visible && !document.hidden && !reduced.matches) { if (time - previous > 40) { draw(time); previous = time; } frame = requestAnimationFrame(tick); } }
  function resume() { cancelAnimationFrame(frame); frame = 0; if (reduced.matches) draw(0); else if (visible && !document.hidden) frame = requestAnimationFrame(tick); }
  new ResizeObserver(resize).observe(canvas); new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; resume(); }).observe(canvas);
  reduced.addEventListener('change', resume); document.addEventListener('visibilitychange', resume);
}
