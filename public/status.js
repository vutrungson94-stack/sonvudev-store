// The public status page. Everything it renders comes from measurements:
// /api/status returns the live shallow probe plus the committed SLO evidence,
// and /api/health is the same check the monitors read - the page never calls
// /api/status for a "100%" it cannot back up. A missing or unreadable file is
// shown as "chưa có dữ liệu", never as a green badge.
(function () {
  const T = (key, vars) => window.I18N.t(key, undefined, vars);
  const esc = window.SVDFormat.esc;
  const $ = (id) => document.getElementById(id);

  const dot = $('status-dot');
  const liveText = $('status-live-text');
  const setLive = (state, text) => {
    dot.className = `status-dot ${state}`;
    liveText.textContent = text;
  };
  const setNote = (id, text) => { $(id).textContent = text; };

  const fmtNumber = (value, digits = 2) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    try {
      return new Intl.NumberFormat(window.I18N.lang || 'vi', { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);
    } catch { return String(n); }
  };
  const fmtDate = (iso) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString(window.I18N.lang || 'vi'); } catch { return String(iso); }
  };
  const fmtUptime = (sec) => {
    const s = Number(sec);
    if (!Number.isFinite(s) || s < 0) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const renderSloCard = (availability, prefix) => {
    const el = $(`status-${prefix}`);
    const note = $(`status-${prefix}-note`);
    if (!availability) {
      el.textContent = T('status.unknown');
      setNote(`status-${prefix}-note`, T('status.honesty'));
      return;
    }
    // A partial window is evidence, not a pass: measureSLOs() withdraws "ok"
    // when coverageDays < 1, so a 20-minute 100% must not be printed as a
    // 30-day SLO on a page a buyer reads. The value stays in /api/status.
    if (availability.value == null || availability.status === 'unknown') {
      el.textContent = T('status.unknownMeasured');
    } else {
      el.textContent = `${fmtNumber(availability.value)}${availability.unit ? '%' : ''}`;
      el.classList.toggle('breached', Boolean(availability.breached));
    }
    const coverage = availability.coverageDays != null && availability.windowDays
      ? T('status.coverage.window', { window: availability.windowDays, days: fmtNumber(availability.coverageDays, 2) })
      : T('status.coverage.unknown');
    const partial = availability.partialWindow ? ` · ${T('status.coverage.partial')}` : '';
    setNote(`status-${prefix}-note`, `${coverage}${partial} · ${T('status.updated', { when: fmtDate(availability.measuredAt) })}`);
  };

  const render = (data) => {
    const probe = data.probe || {};
    if (probe.state === 'up') setLive('ok', T('status.live.ok'));
    else if (probe.state === 'down') setLive('bad', T('status.live.degraded'));
    else setLive('unknown', T('status.live.unknown'));

    renderSloCard(data.slo?.availability, 'availability');
    renderSloCard(data.slo?.errorRate, 'errorrate');

    const p95 = data.slo?.latencyP95;
    const p95El = $('status-p95');
    if (p95 && p95.value != null) {
      p95El.textContent = `${fmtNumber(p95.value, 0)} ${p95.unit || 'ms'}`;
      p95El.classList.toggle('breached', Boolean(p95.breached));
      setNote('status-p95-note', `${T('status.p95.target', { target: p95.target })} · ${T('status.updated', { when: fmtDate(p95.measuredAt) })}`);
    } else {
      p95El.textContent = T('status.p95.unknown');
      setNote('status-p95-note', T('status.honesty'));
    }

    const incidents = data.incidents || null;
    const inc = $('status-incidents');
    if (incidents) {
      inc.textContent = String(incidents.openIncidents ?? 0);
      setNote('status-incidents-note', T('status.incidents.note', {
        total: incidents.recordedPostmortems ?? 0,
        without: incidents.resolvedWithoutRootCause ?? 0,
      }));
    } else {
      inc.textContent = T('status.unknown');
      setNote('status-incidents-note', T('status.honesty'));
    }

    $('status-commit').textContent = data.commit ? String(data.commit).slice(0, 12) : '—';
    $('status-uptime').textContent = fmtUptime(data.uptimeSec);
    $('status-measured').textContent = fmtDate(data.checkedAt);
  };

  const fail = () => {
    setLive('unknown', T('status.live.unknown'));
    $('status-commit').textContent = '—';
    $('status-uptime').textContent = '—';
    $('status-measured').textContent = '—';
    setNote('status-availability-note', T('status.error'));
    setNote('status-errorrate-note', T('status.error'));
    setNote('status-p95-note', T('status.error'));
    setNote('status-incidents-note', T('status.error'));
    $('status-availability').textContent = '—';
    $('status-errorrate').textContent = '—';
    $('status-p95').textContent = '—';
    $('status-incidents').textContent = '—';
  };

  fetch('/api/status', { cache: 'no-store', headers: { Accept: 'application/json' } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then(render)
    .catch(fail);
})();
