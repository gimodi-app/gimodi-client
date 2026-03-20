import serverService from '../../services/server.js';

/**
 * Escapes a string for safe insertion into HTML.
 * @param {string} str - The raw string to escape.
 * @returns {string} The HTML-escaped string.
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Formats a byte count into a human-readable string.
 * @param {number} bytes - The number of bytes to format.
 * @returns {string} A formatted string such as "1.5 MB" or "0 B".
 */
export function formatBytes(bytes) {
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Formats milliseconds into a human-readable uptime string.
 * @param {number} ms - The duration in milliseconds.
 * @returns {string} A formatted string such as "3d 5h 12m".
 */
export function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  parts.push(`${mins}m`);
  return parts.join(' ');
}

/**
 * Draws a simple horizontal bar chart into a container element.
 * @param {HTMLElement} container - The DOM element to render the chart into.
 * @param {Array<{label: string, value: number}>} data - The data items to chart.
 * @param {object} [options] - Optional configuration.
 * @param {function} [options.formatValue] - Formatter for bar values.
 * @param {string} [options.color] - CSS color for bar fills.
 * @returns {void}
 */
function renderBarChart(container, data, options = {}) {
  const formatValue = options.formatValue || ((v) => v.toLocaleString());
  const color = options.color || 'var(--accent)';
  const maxVal = Math.max(...data.map((d) => d.value), 1);

  container.innerHTML = '';
  for (const item of data) {
    const row = document.createElement('div');
    row.className = 'analytics-bar-row';

    const label = document.createElement('span');
    label.className = 'analytics-bar-label';
    label.title = item.label;
    label.textContent = item.label;

    const barWrap = document.createElement('div');
    barWrap.className = 'analytics-bar-track';

    const bar = document.createElement('div');
    bar.className = 'analytics-bar-fill';
    bar.style.width = `${(item.value / maxVal) * 100}%`;
    bar.style.background = color;
    barWrap.appendChild(bar);

    const val = document.createElement('span');
    val.className = 'analytics-bar-value';
    val.textContent = formatValue(item.value);

    row.appendChild(label);
    row.appendChild(barWrap);
    row.appendChild(val);
    container.appendChild(row);
  }
}

/**
 * Draws a mini area/line chart into a canvas element.
 * @param {HTMLCanvasElement} canvas - The canvas element to draw on.
 * @param {Array<{x: number, y: number}>} points - The data points to plot.
 * @param {object} [_options] - Reserved for future options.
 * @returns {void}
 */
function renderAreaChart(canvas, points, _options = {}) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  if (points.length < 2) {
    ctx.fillStyle = 'var(--text-muted)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', w / 2, h / 2);
    return;
  }

  const minX = points[0].x;
  const maxX = points[points.length - 1].x;
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const pad = 2;

  const toCanvasX = (x) => pad + ((x - minX) / (maxX - minX || 1)) * (w - pad * 2);
  const toCanvasY = (y) => h - pad - (y / maxY) * (h - pad * 2);

  const accentRaw = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#5b8def';

  ctx.beginPath();
  ctx.moveTo(toCanvasX(points[0].x), toCanvasY(points[0].y));
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(toCanvasX(points[i].x), toCanvasY(points[i].y));
  }
  ctx.strokeStyle = accentRaw;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.lineTo(toCanvasX(points[points.length - 1].x), h);
  ctx.lineTo(toCanvasX(points[0].x), h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, accentRaw + '40');
  grad.addColorStop(1, accentRaw + '05');
  ctx.fillStyle = grad;
  ctx.fill();
}

/**
 * Renders the analytics dashboard panel by fetching data from the server
 * and populating the container with status cards, charts, and statistics.
 * @param {HTMLElement} container - The DOM element to render the analytics panel into.
 * @returns {Promise<void>}
 */
export async function renderAnalyticsPanel(container) {
  container.innerHTML = '<div style="padding:20px;color:var(--text-muted);font-size:13px">Loading analytics...</div>';

  let data;
  try {
    data = await serverService.request('admin:get-analytics', {});
  } catch (err) {
    container.innerHTML = `<div style="padding:20px;color:var(--danger);font-size:13px">${escapeHtml(err.message || String(err))}</div>`;
    return;
  }

  const { live, db: dbData } = data;

  container.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'analytics-wrapper';

  wrapper.innerHTML = `
    <div class="analytics-section">
      <h3 class="analytics-section-title">Live Server Status</h3>
      <div class="analytics-cards">
        <div class="analytics-card">
          <div class="analytics-card-icon"><i class="bi bi-clock-history"></i></div>
          <div class="analytics-card-body">
            <div class="analytics-card-value">${escapeHtml(formatUptime(live.uptimeMs))}</div>
            <div class="analytics-card-label">Uptime</div>
          </div>
        </div>
        <div class="analytics-card">
          <div class="analytics-card-icon"><i class="bi bi-people-fill"></i></div>
          <div class="analytics-card-body">
            <div class="analytics-card-value">${live.connectedClients}</div>
            <div class="analytics-card-label">Connected</div>
          </div>
        </div>
        <div class="analytics-card">
          <div class="analytics-card-icon"><i class="bi bi-mic-fill"></i></div>
          <div class="analytics-card-body">
            <div class="analytics-card-value">${live.clientsInVoice}</div>
            <div class="analytics-card-label">In Voice</div>
          </div>
        </div>
        <div class="analytics-card">
          <div class="analytics-card-icon"><i class="bi bi-hash"></i></div>
          <div class="analytics-card-body">
            <div class="analytics-card-value">${live.activeChannels}</div>
            <div class="analytics-card-label">Active Channels</div>
          </div>
        </div>
        <div class="analytics-card">
          <div class="analytics-card-icon"><i class="bi bi-broadcast"></i></div>
          <div class="analytics-card-body">
            <div class="analytics-card-value">${live.screenShares}</div>
            <div class="analytics-card-label">Screen Shares</div>
          </div>
        </div>
        <div class="analytics-card">
          <div class="analytics-card-icon"><i class="bi bi-camera-video-fill"></i></div>
          <div class="analytics-card-body">
            <div class="analytics-card-value">${live.webcamStreams}</div>
            <div class="analytics-card-label">Webcams</div>
          </div>
        </div>
      </div>
    </div>

    <div class="analytics-section">
      <h3 class="analytics-section-title">Session Counters <span class="analytics-hint">(since server start)</span></h3>
      <div class="analytics-cards">
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${live.sessionsTotal.toLocaleString()}</div>
            <div class="analytics-card-label">Total Connections</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${live.sessionMessagesTotal.toLocaleString()}</div>
            <div class="analytics-card-label">Messages Sent</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${live.sessionFilesTotal.toLocaleString()}</div>
            <div class="analytics-card-label">Files Uploaded</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${live.wsMessagesTotal.toLocaleString()}</div>
            <div class="analytics-card-label">WS Messages</div>
          </div>
        </div>
      </div>
    </div>

    <div class="analytics-section">
      <h3 class="analytics-section-title">Messages</h3>
      <div class="analytics-cards">
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.messages.total.toLocaleString()}</div>
            <div class="analytics-card-label">Total</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.messages.today.toLocaleString()}</div>
            <div class="analytics-card-label">Today</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.messages.last7d.toLocaleString()}</div>
            <div class="analytics-card-label">Last 7 Days</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.messages.last30d.toLocaleString()}</div>
            <div class="analytics-card-label">Last 30 Days</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.reactions.total.toLocaleString()}</div>
            <div class="analytics-card-label">Reactions</div>
          </div>
        </div>
      </div>
      <div class="analytics-chart-container">
        <h4 class="analytics-chart-title">Message Activity (Last 7 Days)</h4>
        <canvas class="analytics-area-chart" data-chart="message-activity"></canvas>
      </div>
    </div>

    <div class="analytics-row">
      <div class="analytics-section analytics-half">
        <h3 class="analytics-section-title">Messages per Channel</h3>
        <div data-chart="messages-per-channel"></div>
      </div>
      <div class="analytics-section analytics-half">
        <h3 class="analytics-section-title">Top Uploaders (by size)</h3>
        <div data-chart="top-uploaders"></div>
      </div>
    </div>

    <div class="analytics-section">
      <h3 class="analytics-section-title">File Storage</h3>
      <div class="analytics-cards">
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.files.total.toLocaleString()}</div>
            <div class="analytics-card-label">Total Files</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${escapeHtml(formatBytes(dbData.files.totalSize))}</div>
            <div class="analytics-card-label">Total Size</div>
          </div>
        </div>
      </div>
      <div class="analytics-chart-container" style="margin-top:12px">
        <h4 class="analytics-chart-title">Files by Type</h4>
        <div data-chart="files-by-type"></div>
      </div>
    </div>

    <div class="analytics-section">
      <h3 class="analytics-section-title">Users & Security</h3>
      <div class="analytics-cards">
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.identities.total.toLocaleString()}</div>
            <div class="analytics-card-label">Registered Identities</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.identities.active7d.toLocaleString()}</div>
            <div class="analytics-card-label">Active (7d)</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.bans.total.toLocaleString()}</div>
            <div class="analytics-card-label">Active Bans</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.channels.total.toLocaleString()}</div>
            <div class="analytics-card-label">Total Channels</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.pins.total.toLocaleString()}</div>
            <div class="analytics-card-label">Pinned Messages</div>
          </div>
        </div>
        <div class="analytics-card card-compact">
          <div class="analytics-card-body">
            <div class="analytics-card-value">${dbData.auditEvents.total.toLocaleString()}</div>
            <div class="analytics-card-label">Audit Events</div>
          </div>
        </div>
      </div>
    </div>
  `;

  container.appendChild(wrapper);

  const activityCanvas = wrapper.querySelector('[data-chart="message-activity"]');
  if (activityCanvas && dbData.messageActivity.length > 0) {
    const points = dbData.messageActivity.map((row) => ({ x: row.hour, y: row.count }));
    renderAreaChart(activityCanvas, points);
  }

  const channelChart = wrapper.querySelector('[data-chart="messages-per-channel"]');
  if (channelChart && dbData.channels.messagesPerChannel.length > 0) {
    renderBarChart(
      channelChart,
      dbData.channels.messagesPerChannel.map((r) => ({ label: r.name, value: r.count })),
    );
  } else if (channelChart) {
    channelChart.innerHTML = '<div class="analytics-empty">No data</div>';
  }

  const uploadersChart = wrapper.querySelector('[data-chart="top-uploaders"]');
  if (uploadersChart && dbData.files.topUploaders.length > 0) {
    renderBarChart(
      uploadersChart,
      dbData.files.topUploaders.map((r) => ({ label: r.nickname, value: r.totalSize })),
      { formatValue: formatBytes },
    );
  } else if (uploadersChart) {
    uploadersChart.innerHTML = '<div class="analytics-empty">No uploads</div>';
  }

  const fileTypeChart = wrapper.querySelector('[data-chart="files-by-type"]');
  if (fileTypeChart && dbData.files.byType.length > 0) {
    renderBarChart(
      fileTypeChart,
      dbData.files.byType.map((r) => ({
        label: r.mime_type.replace('application/', '').replace('image/', 'img/'),
        value: r.totalSize,
      })),
      { formatValue: formatBytes },
    );
  } else if (fileTypeChart) {
    fileTypeChart.innerHTML = '<div class="analytics-empty">No files</div>';
  }
}
