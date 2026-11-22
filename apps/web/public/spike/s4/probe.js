// Spike S4 (F-008, ADR 0023): records what a page on this origin can read cross-origin.
// It names no host: the targets come from e2e/s4-probe/targets.ts through window.s4Probe.run().
const TIMEOUT_MS = 20_000;
const violations = [];

document.addEventListener("securitypolicyviolation", (event) => {
  violations.push({
    blockedURI: event.blockedURI,
    effectiveDirective: event.effectiveDirective,
  });
});

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round = (ms) => Math.round(ms * 10) / 10;

function originOf(url) {
  try {
    return new URL(url, location.href).origin;
  } catch {
    return null;
  }
}

async function probeOne(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = performance.now();
  const base = { id: target.id, url: target.url };
  try {
    const response = await fetch(target.url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
    const bytes = (await response.arrayBuffer()).byteLength;
    return {
      ...base,
      outcome: "readable",
      status: response.status,
      responseType: response.type,
      redirected: response.redirected,
      finalUrl: response.url,
      bytes,
      exposedHeaders: Object.fromEntries(response.headers),
      durationMs: round(performance.now() - t0),
    };
  } catch (error) {
    const durationMs = round(performance.now() - t0);
    if (controller.signal.aborted) {
      return { ...base, outcome: "timeout", durationMs };
    }
    // The violation event can arrive after the rejection.
    await pause(50);
    const origin = originOf(target.url);
    const violation = violations.find((v) => originOf(v.blockedURI) === origin);
    if (violation) {
      return {
        ...base,
        outcome: "csp-blocked",
        cspDirective: violation.effectiveDirective,
        durationMs,
      };
    }
    return { ...base, outcome: "failed", error: String(error), durationMs };
  } finally {
    clearTimeout(timer);
  }
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

async function run(targets) {
  document.body.dataset.state = "running";
  const body = document.querySelector("#probe-results tbody");
  const results = [];
  for (const target of targets) {
    const result = await probeOne(target);
    results.push(result);
    const row = document.createElement("tr");
    row.append(
      cell(result.id),
      cell(result.outcome),
      cell(result.status === undefined ? "" : String(result.status)),
      cell(String(result.durationMs)),
    );
    body.append(row);
  }
  document.querySelector("#probe-status").textContent =
    `Probed ${results.length} targets.`;
  document.body.dataset.state = "done";
  return results;
}

window.s4Probe = { run };
document.body.dataset.state = "ready";
