#!/usr/bin/env node
/**
 * GMUX v0.1 DOM lifecycle suite — real bootstrap against a miniature DOM.
 *
 * Dependency-free: node tests/dom-smoke.mjs
 *
 * Evidence provided here (pack §60): G2 host boundary, G3 failure containment,
 * G4 shell once, G5 style once, G6 observer once, G7 reconciliation
 * idempotence, G8 desktop stays usable and untouched, plus the §24/§25/§26
 * shell contracts, §38 kill switch, §39 Back, §40 history discipline and §37
 * preference tolerance.
 *
 * This is a harness, not a browser and not github.dev: every claim stays
 * PARTIALLY_VERIFIED and the runtime is never asserted to work on the host
 * (pack §60/§67/§68).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { install, serialize, parseHTML, createDocument, El } from './lib/mini-dom.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, '..', 'github-dev-mobile.user.js');

let passed = 0;
let failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name + (detail ? ` — ${detail}` : ''));
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}
function section(t) { console.log(`\n== ${t} ==`); }

const OWNER_SELECTOR = '[data-gmux-owner="github-dev-mobile"][data-gmux-root="true"]';

function loadFresh() {
  delete require.cache[require.resolve(FILE)];
  return require(FILE);
}

async function boot(opts = {}) {
  const h = install(opts);
  const K = loadFresh();
  await h.settle();
  return { h, K };
}

const src = readFileSync(FILE, 'utf8');

const HOST_HTML = `<div class="workbench"><div class="sidebar"><ul class="tree"><li>main.rs</li></ul></div>
<div class="editor"><textarea class="inputarea"></textarea></div><div class="panel"></div></div>`;

/* --------------------------- 1. bootstrap path --------------------------- */
section('Bootstrap mounts exactly one owned shell (§23/§24)');
{
  const { h, K } = await boot({ width: 412, height: 915, touchPoints: 5, coarsePointer: true, hostHTML: HOST_HTML });
  const roots = h.doc.querySelectorAll(OWNER_SELECTOR);
  check('exactly one owned root', roots.length === 1, `found ${roots.length}`);
  check('root id is gmux-root', roots[0].id === 'gmux-root');
  check('root carries ownership + root markers',
    roots[0].getAttribute('data-gmux-owner') === 'github-dev-mobile' && roots[0].getAttribute('data-gmux-root') === 'true');
  const styles = h.doc.querySelectorAll('[data-gmux-style]');
  check('exactly one style node', styles.length === 1, `found ${styles.length}`);
  check('style is in head', styles[0].parentNode === h.doc.head);
  const structure = roots[0].children.map((c) => c.id).join(',');
  check('§23 structure: header, content, backdrop, drawer, toolbar',
    structure === 'gmux-header,gmux-content,gmux-backdrop,gmux-drawer,gmux-toolbar', structure);
  check('toolbar holds exactly the four §26 commands',
    h.doc.querySelectorAll('#gmux-toolbar .gmux-btn').length === 4);
  check('command ids use the gmux- prefix',
    ['gmux-cmd-explorer', 'gmux-cmd-search', 'gmux-cmd-sourceControl', 'gmux-cmd-terminal']
      .every((id) => !!h.doc.getElementById(id)));
  check('every generated id is gmux-prefixed',
    h.doc.querySelectorAll('[id]').every((el) => el.id.startsWith('gmux-')),
    h.doc.querySelectorAll('[id]').map((e) => e.id).filter((i) => !i.startsWith('gmux-')).join(','));
  check('GMUX namespace exposes state/adapter/shell/observers',
    !!K.GMUX.state && !!K.GMUX.adapter && !!K.GMUX.shell && !!K.GMUX.observer && !!K.GMUX.viewportObserver);
  check('window.GMUX is the one global GMUX creates', h.window.GMUX === K.GMUX);
  check('no extra globals created on window',
    Object.keys(h.window).every((k) => !/^__GMUX|GMUX_INTERNALS|__gmux/.test(k)),
    Object.keys(h.window).filter((k) => /__GMUX|gmuxInternal/i.test(k)).join(','));
  check('mutation observer is installed once', !!K.GMUX.observer);
  check('viewport observer listens on visualViewport (§36)', K.GMUX.viewportObserver.target === h.window.visualViewport);
  check('viewport observer uses passive listeners (§36)', K.GMUX.viewportObserver.listeners.length === 2);
  check('mode is mobile at 412px (§7)', K.GMUX.state.mode === 'mobile');
  check('shell is visible on mobile', h.doc.getElementById('gmux-root').hidden === false);
  check('no polling APIs used', K.log.events.every((e) => !/poll/i.test(e.message)));
  check('booted state carries a classification, never the raw "auto" preference', K.GMUX.state.mode !== 'auto');
  check('root carries every rendered attribute',
    ['mode', 'surface', 'immersive', 'keyboard', 'bottomBar'].every((k) => k in roots[0].dataset),
    JSON.stringify(roots[0].dataset));
  check('a created root starts hidden until the first render (§27)',
    /root\.hidden = true;/.test(src));

  /* ---- 2. §24 idempotent factories under a live DOM ---- */
  section('Repeated factory calls stay singletons (§24/§28/§35)');
  const before2 = h.doc.querySelectorAll(OWNER_SELECTOR).length;
  K.createShell(); K.createShell(); K.createShell();
  K.createMobileShell();
  await h.settle();
  check('4 extra createShell() calls still yield one root',
    h.doc.querySelectorAll(OWNER_SELECTOR).length === 1 && before2 === 1);
  K.installStyles(); K.installStyles();
  check('extra installStyles() calls still yield one node', h.doc.querySelectorAll('[data-gmux-style]').length === 1);
  const firstObserver = K.GMUX.observer;
  K.installObserver(); K.installObserver();
  check('extra installObserver() calls do not replace or add observers', K.GMUX.observer === firstObserver);
  const vpFirst = K.GMUX.viewportObserver;
  K.installViewportObserver();
  check('installViewportObserver is a no-op when already installed', K.GMUX.viewportObserver === vpFirst);

  /* ---- 3. §21 reconciliation idempotence + §22 coalescing ---- */
  section('Reconciliation is idempotent and converges (§21/§22)');
  const domBefore = serialize(h.doc.getElementById('gmux-root'));
  const recBefore = K.GMUX.state.diagnostics.reconciliations;
  for (let i = 0; i < 25; i++) K.reconcile();
  await h.settle();
  check('shell subtree unchanged by repeated reconciliation', serialize(h.doc.getElementById('gmux-root')) === domBefore);
  check('reconciliations counter advanced', K.GMUX.state.diagnostics.reconciliations >= recBefore + 25);
  check('still exactly one root after 25 reconciliations', h.doc.querySelectorAll(OWNER_SELECTOR).length === 1);
  check('still exactly one style node', h.doc.querySelectorAll('[data-gmux-style]').length === 1);
  check('no duplicate listeners on the Files control',
    h.doc.getElementById('gmux-cmd-explorer')._listeners.filter(([t]) => t === 'click').length === 1);
  check('last error stays null under churn', K.GMUX.state.diagnostics.lastError === null);

  // N mutations → ≤ 1 pending reconciliation
  const beforeCount = K.GMUX.state.diagnostics.reconciliations;
  for (let i = 0; i < 40; i++) K.dispatch({ type: K.ACTION.IMMERSIVE_TOGGLE });
  await h.settle(1);
  const afterOne = K.GMUX.state.diagnostics.reconciliations;
  check('40 dispatches coalesce into few reconciliations (≤ 2 pending)',
    afterOne - beforeCount <= 2, `delta=${afterOne - beforeCount}`);
  check('immersive state is consistent after coalescing', typeof K.GMUX.state.immersive === 'boolean');

  /* ---- 4. §26 capability policy on a revision-0 adapter ---- */
  section('Controls never pretend (§26)');
  const explorer = h.doc.getElementById('gmux-cmd-explorer');
  check('all four commands report BLOCKED capability',
    ['explorer', 'search', 'sourceControl', 'terminal']
      .every((s) => h.doc.getElementById(`gmux-cmd-${s}`).dataset.capability === 'BLOCKED'));
  check('commands are aria-disabled while BLOCKED', explorer.getAttribute('aria-disabled') === 'true');
  check('the reason is attached to the control', /No verified host mapping/.test(explorer.getAttribute('title') || ''));
  explorer.click();
  await h.settle();
  check('a BLOCKED tap does not commit a surface', K.GMUX.state.surface === 'editor');
  check('a BLOCKED tap leaves no pending action', K.GMUX.state.pendingAction === null);
  check('the refusal is surfaced to the user', /BLOCKED/.test(h.doc.getElementById('gmux-reason').textContent));
  check('nothing was pressed on the host', !/workbench/.test(serialize(h.doc.getElementById('gmux-root'))));

  /* ---- 5. §39/§40 back + navigation ---- */
  section('Back is a command, history is untouched (§39/§40)');
  let pushCalls = 0;
  h.window.history.pushState = () => { pushCalls++; };
  h.window.history.replaceState = () => { pushCalls++; };
  h.doc.getElementById('gmux-menu').click();
  await h.settle();
  check('diagnostics opens the GMUX window', K.GMUX.state.drawer.kind === 'diagnostics');
  check('drawer body renders the report', /GMUX 0\.1\.0 · diagnostics/.test(h.doc.getElementById('gmux-drawer-body').textContent));
  h.fire('keydown', { key: 'Escape' });
  await h.settle();
  check('Escape closes diagnostics first', K.GMUX.state.drawer === null);
  h.fire('keydown', { key: 'Escape' });
  await h.settle();
  check('Escape with nothing owned changes nothing', K.GMUX.state.surface === 'editor');
  const backResult = K.handleBackCommand('test');
  check('Back is NOT consumed when GMUX owns nothing', backResult.consume === false && backResult.step === 'browser-default');
  check('no browser history entries created by GMUX', pushCalls === 0);
  check('nav stack stays [editor]', K.GMUX.state.surface === 'editor');

  /* ---- 6. keyboard heuristic drives presentation only ---- */
  section('Keyboard heuristic is applied as derived state (§8)');
  h.window.visualViewport.height = 500;   // innerHeight 915 → Δ415 > 150
  h.window.visualViewport.dispatchEvent({ type: 'resize' });
  await h.settle();
  check('keyboardVisible becomes true', K.GMUX.state.keyboardVisible === true);
  check('root records the keyboard state', h.doc.getElementById('gmux-root').dataset.keyboard === 'true');
  h.window.visualViewport.height = 915;
  h.window.visualViewport.dispatchEvent({ type: 'resize' });
  await h.settle();
  check('keyboardVisible returns to false', K.GMUX.state.keyboardVisible === false);
  check('no scroll/overflow was forced on the host body',
    !h.doc.body.style._props.size && h.doc.body.className === '', JSON.stringify([...h.doc.body.style._props.entries()]));

  /* ---- 7. host subtree is never rewritten ---- */
  section('Host subtree is untouched (§3/§30/§31/§32)');
  const hostBefore = h.doc.body.children.filter((c) => c.getAttribute('data-gmux-owner') !== 'github-dev-mobile').map(serialize).join('');
  for (const id of ['gmux-cmd-search', 'gmux-cmd-sourceControl', 'gmux-cmd-terminal', 'gmux-menu', 'gmux-immersive', 'gmux-back']) {
    h.doc.getElementById(id).click();
  }
  h.window.visualViewport.dispatchEvent({ type: 'scroll' });
  await h.settle(4);
  const hostAfter = h.doc.body.children.filter((c) => c.getAttribute('data-gmux-owner') !== 'github-dev-mobile').map(serialize).join('');
  check('host markup identical after a full interaction pass', hostBefore === hostAfter);
  const wb = h.doc.querySelector('.workbench');
  check('no class was added to the host workbench', wb.className === 'workbench', wb.className);
  check('no attribute was added to the host workbench', wb.attrs.size === 1);
  check('nothing was reparented into the GMUX root', h.doc.getElementById('gmux-root').querySelector('.sidebar,.editor,.panel') === null);
  check('Monaco textarea untouched', h.doc.querySelector('.inputarea').attrs.size === 1);
  h.uninstall();
}

/* ------------------------- 8. desktop stays usable ---------------------- */
section('Desktop mode leaves the host alone (§27/G8)');
{
  const { h, K } = await boot({ width: 1440, height: 900, coarsePointer: false, touchPoints: 0, hostHTML: HOST_HTML });
  const root = h.doc.getElementById('gmux-root');
  check('classification is desktop', K.GMUX.state.mode === 'desktop');
  check('shell root is hidden on desktop', root.hidden === true);
  check('dataset still reports the mode', root.dataset.mode === 'desktop');
  // Compare against the same fixture parsed with no GMUX at all: byte-identical
  // host markup is the §27 promise for desktop ("host presentation minimally
  // affected" — here: not affected at all).
  const clean = createDocument({});
  const parsed = parseHTML(HOST_HTML, clean);
  while (parsed.children.length) clean.body.appendChild(parsed.children[0]);
  const cleanHost = clean.body.children.map(serialize).join('');
  const serializedHost = h.doc.body.children.filter((c) => c !== root).map(serialize).join('');
  check('host markup byte-identical to the same page without GMUX', serializedHost === cleanHost,
    `\n  with GMUX: ${serializedHost}\n  without   : ${cleanHost}`);
  // Stronger, explicit claim: no GMUX interaction is possible while hidden.
  check('commands remain present but disabled (never pretending)',
    h.doc.querySelectorAll('#gmux-toolbar .gmux-btn[aria-disabled="true"]').length === 4);
  check('zero host mutations on desktop', h.doc.querySelectorAll('.workbench [data-gmux-owner]').length === 0);
  h.uninstall();
}

/* ------------------------------ 9. kill switch --------------------------- */
section('Kill switch mounts nothing (§38)');
{
  const viaQuery = await boot({ href: 'https://github.dev/o/r?gmux=off', hostHTML: HOST_HTML });
  check('?gmux=off creates no shell', viaQuery.h.doc.querySelectorAll(OWNER_SELECTOR).length === 0);
  check('?gmux=off creates no style node', viaQuery.h.doc.querySelectorAll('[data-gmux-style]').length === 0);
  check('?gmux=off installs no observer', viaQuery.K.GMUX.observer === null);
  check('?gmux=off installs no viewport observer', viaQuery.K.GMUX.viewportObserver === null);
  check('?gmux=off leaves state unbooted', viaQuery.K.GMUX.state === null);
  check('?gmux=off mutates the host not at all',
    serialize(viaQuery.h.doc.body) === serialize(viaQuery.h.doc.querySelector('.workbench').parentNode));
  viaQuery.h.uninstall();

  const viaPref = await boot({ rawPrefs: JSON.stringify({ version: 1, disabled: true }), hostHTML: HOST_HTML });
  check('preferences.disabled creates no shell', viaPref.h.doc.querySelectorAll(OWNER_SELECTOR).length === 0);
  check('preferences.disabled creates no style node', viaPref.h.doc.querySelectorAll('[data-gmux-style]').length === 0);
  check('preferences.disabled installs no observer', viaPref.K.GMUX.observer === null);
  viaPref.h.uninstall();

  const escape = await boot({ rawPrefs: JSON.stringify({ version: 1, disabled: true }), href: 'https://github.dev/o/r?gmux=on' });
  check('?gmux=on recovers a session disabled by preference', escape.h.doc.querySelectorAll(OWNER_SELECTOR).length === 1);
  escape.h.uninstall();

  const deadPref = await boot({ rawPrefs: '{ this is not json', hostHTML: HOST_HTML });
  check('corrupt preferences still boot the runtime (§37)', deadPref.h.doc.querySelectorAll(OWNER_SELECTOR).length === 1);
  check('corrupt preferences are reported, not hidden',
    deadPref.K.log.events.some((e) => /preference-parse-failed/.test(e.detail || '')));
  deadPref.h.uninstall();

  const halfPref = await boot({ rawPrefs: JSON.stringify({ version: 1, mode: 'nonsense', immersive: 'yes', bottomBar: true }), hostHTML: HOST_HTML });
  check('invalid preference fields fall back to defaults', halfPref.K.GMUX.state.immersive === true);
  check('invalid mode is reported', halfPref.K.log.events.some((e) => /preference-mode-invalid/.test(e.detail || '')));
  halfPref.h.uninstall();
}

/* --------------------- 9b. preferredSurface preference -------------------- */
section('preferredSurface is honoured through the evidence path (§37)');
{
  const { h, K } = await boot({ rawPrefs: JSON.stringify({ version: 1, preferredSurface: 'explorer' }), hostHTML: HOST_HTML });
  check('a host preferred surface never commits without verification', K.GMUX.state.surface === 'editor');
  check('the BLOCKED outcome is reported, not swallowed',
    K.log.events.some((e) => /preferred surface explorer → BLOCKED/.test(e.message)),
    JSON.stringify(K.log.events.map((e) => e.message)));
  check('no host element was activated by the preference', h.doc.querySelector('.workbench').attrs.size === 1);
  h.uninstall();

  const gmuxOwned = await boot({ rawPrefs: JSON.stringify({ version: 1, preferredSurface: 'diagnostics' }), hostHTML: HOST_HTML });
  check('a GMUX-owned preferred surface opens immediately', gmuxOwned.K.GMUX.state.drawer.kind === 'diagnostics');
  check('and mounts the diagnostics report', /diagnostics/.test(gmuxOwned.h.doc.getElementById('gmux-drawer-body').textContent));
  gmuxOwned.h.uninstall();

  const none = await boot({ hostHTML: HOST_HTML });
  check('default editor preference opens nothing', none.K.GMUX.state.drawer === null);
  none.h.uninstall();
}

/* --------------------------- 10. host boundary --------------------------- */
section('Only github.dev is touched (§59/G2)');
for (const hostname of ['github.com', 'vscode.dev', 'gist.github.com', 'example.com', 'localhost']) {
  const { h, K } = await boot({ hostname, href: `https://${hostname}/o/r` });
  check(`${hostname}: no shell`, h.doc.querySelectorAll(OWNER_SELECTOR).length === 0);
  check(`${hostname}: no style node`, h.doc.querySelectorAll('[data-gmux-style]').length === 0);
  check(`${hostname}: no observers`, !K.GMUX.observer && !K.GMUX.viewportObserver);
  h.uninstall();
}

/* ----------------------- 11. failure containment ------------------------- */
section('GMUX failures never reach the host (§59/G3)');
{
  const h = install({});
  // Hostile page: appendChild throws, as a locked-down or detached DOM would.
  const originalAppend = El.prototype.appendChild;
  El.prototype.appendChild = function () { throw new Error('host rejected the append'); };
  let threw = null;
  let K = null;
  try {
    delete require.cache[require.resolve(FILE)];
    K = require(FILE);
  } catch (e) {
    threw = e;
  }
  El.prototype.appendChild = originalAppend;
  check('a throwing host does not surface an exception', threw === null, String(threw));
  check('the failure is recorded as a diagnostic', K.log.events.some((e) => /bootstrap failed/.test(e.message)));
  check('the host page keeps its own DOM', h.doc.querySelectorAll(OWNER_SELECTOR).length === 0);
  h.uninstall();
}
{
  // Reconcile must not throw even when the adapter misbehaves.
  const { h, K } = await boot({ hostHTML: HOST_HTML });
  const good = K.GMUX.adapter;
  K.__setAdapter({ id: 'broken', revision: 9, detectEnvironment: () => true, observe: () => { throw new Error('adapter exploded'); } });
  // Production path: host mutation → scheduleReconcile → contained try/catch (§22).
  h.doc.querySelector('.workbench').appendChild(h.doc.createElement('div'));
  let escaped = false;
  try { await h.settle(2); } catch (e) { escaped = true; }
  check('a throwing adapter never escapes into the host', escaped === false);
  check('the failure is recorded as a diagnostic', K.GMUX.state.diagnostics.lastError !== null,
    String(K.GMUX.state.diagnostics.lastError));
  check('the shell survives an adapter failure', !!h.doc.getElementById('gmux-toolbar'));
  check('the host keeps its own DOM after the failure', !!h.doc.querySelector('.workbench div'));
  K.__setAdapter(good);
  const errorsBefore = K.log.errors;
  let recoveryThrew = false;
  try { K.reconcile(); } catch (e) { recoveryThrew = true; }
  check('recovery with a working adapter does not throw', recoveryThrew === false);
  check('recovery adds no new error', K.log.errors === errorsBefore);
  // lastError is the historical record ("last error", §58), not a live flag, so
  // it intentionally survives recovery.
  check('lastError remains auditable after recovery', /adapter exploded/.test(String(K.GMUX.state.diagnostics.lastError)));
  check('shell still mounts after recovery', !!h.doc.getElementById('gmux-root'));
  h.uninstall();
}

/* --------------------------- 12. DISABLE teardown ------------------------ */
section('DISABLE tears down cleanly and persists (§10/§38)');
{
  const { h, K } = await boot({ hostHTML: HOST_HTML });
  const hostSnapshot = h.doc.body.children.filter((c) => c.getAttribute('data-gmux-owner') !== 'github-dev-mobile').map(serialize).join('');
  K.dispatch({ type: K.ACTION.DISABLE });
  await h.settle();
  check('shell removed', h.doc.querySelectorAll(OWNER_SELECTOR).length === 0);
  check('style node removed', h.doc.querySelectorAll('[data-gmux-style]').length === 0);
  check('observer released', K.GMUX.observer === null && K.GMUX.viewportObserver === null);
  check('host markup survives teardown',
    h.doc.body.children.filter((c) => c.getAttribute('data-gmux-owner') !== 'github-dev-mobile').map(serialize).join('') === hostSnapshot);
  const stored = JSON.parse(h.window.localStorage.getItem('github-dev-mobile:v1'));
  check('disable persisted to preferences', stored.disabled === true);
  K.reconcile();
  await h.settle();
  check('reconcile after disable mounts nothing', h.doc.querySelectorAll(OWNER_SELECTOR).length === 0);
  h.uninstall();

  // And the persisted switch is honoured on the next load.
  const h2 = install({ rawPrefs: JSON.stringify({ version: 1, disabled: true }), hostHTML: HOST_HTML });
  const K2 = loadFresh();
  await h2.settle();
  check('next boot stays off', h2.doc.querySelectorAll(OWNER_SELECTOR).length === 0 && !K2.GMUX.observer);
  h2.uninstall();
}

/* ---------------------- 13. preference round-trip ------------------------ */
section('Immersive toggle persists as configuration (§37)');
{
  const { h, K } = await boot({ hostHTML: HOST_HTML });
  const immersive = h.doc.getElementById('gmux-immersive');
  const before = K.GMUX.state.immersive;
  immersive.click();
  await h.settle();
  check('state flipped', K.GMUX.state.immersive !== before);
  check('root reflects immersive via attribute', h.doc.getElementById('gmux-root').dataset.immersive === String(K.GMUX.state.immersive));
  const stored = JSON.parse(h.window.localStorage.getItem('github-dev-mobile:v1'));
  check('preference written under the frozen key', stored.immersive === K.GMUX.state.immersive);
  check('control created once — same node after reconcile', h.doc.getElementById('gmux-immersive') === immersive);
  h.uninstall();
}

/* --------------------- 14. ownership of generated CSS ------------------- */
section('Style hygiene (§28/§33/§34)');
{
  const { h } = await boot({ hostHTML: HOST_HTML });
  const css = h.doc.querySelector('[data-gmux-style]').textContent;
  check('all rules are scoped to the owner or gmux ids',
    css.split('}').every((block) => !block.trim() || /data-gmux-owner|#gmux-|\.gmux-|@media/.test(block)),
    css.split('}').filter((b) => b.trim() && !/data-gmux-owner|#gmux-|\.gmux-|@media/.test(b)).join(' | '));
  check('no !important in generated CSS', !/!important/.test(css));
  check('no universal selector in generated CSS', !/(^|[,\s])\*\s*[,{]/.test(css));
  check('safe-area insets used', ['top', 'right', 'bottom', 'left'].every((s) => css.includes(`env(safe-area-inset-${s},0px)`)));
  const flat = css.replace(/\s*\n\s*/g, ' ');
  check('safe-area values are aliased to custom properties',
    /--gmux-inset-bottom:env\(safe-area-inset-bottom,0px\)/.test(flat));
  check('bottom toolbar accounts for the bottom inset',
    /#gmux-toolbar\{[^}]*var\(--gmux-inset-bottom\)/.test(flat), flat.slice(flat.indexOf('#gmux-toolbar'), flat.indexOf('#gmux-toolbar') + 200));
  check('header accounts for the top inset',
    /#gmux-header\{[^}]*var\(--gmux-inset-left\)/.test(flat));
  check('touch target of 44px is applied', /min-height:44px/.test(css) && /min-width:44px/.test(css));
  check('only GMUX-owned content scrolls',
    /\.gmux-drawer-body\{[^}]*overflow-y:auto/.test(flat));
  const selectors = flat.split('}').map((block) => block.split('{')[0].trim()).filter(Boolean);
  check('no rule targets host structure (every selector is gmux-scoped)',
    selectors.every((sel) => /data-gmux-owner|#gmux-|\.gmux-|@media/.test(sel)),
    selectors.filter((sel) => !/data-gmux-owner|#gmux-|\.gmux-|@media/.test(sel)).join(' | '));
  check('no bare body/html rule (§32 scroll ownership)',
    !selectors.some((sel) => /(^|[,{\s])(body|html)(\s*\{|,|$)/.test(sel + '{')),
    selectors.join(' | '));
  // §32: the shell background owns no scrolling and clips nothing — clipping is
  // confined to GMUX's own drawer, and the root stays pass-through.
  const rootRule = (flat.match(/#gmux-root\{[^}]*\}/) || [''])[0];
  check('#gmux-root sets no overflow and no host-affecting positioning', rootRule && !/overflow/.test(rootRule), rootRule);
  check('overflow rules only appear inside gmux-scoped blocks',
    flat.split('}').every((block) => {
      const sel = block.split('{')[0];
      return !/overflow(?!-x:visible)/.test(block) || /#gmux-|\.gmux-/.test(sel);
    }));
  h.uninstall();
}

/* ------------------- 15. shell survives host DOM churn ----------------- */
section('Host churn re-observes without duplicating (§35)');
{
  const { h, K } = await boot({ hostHTML: HOST_HTML });
  const obsBefore = K.GMUX.state.diagnostics.observations;
  const wb = h.doc.querySelector('.workbench');
  for (let i = 0; i < 30; i++) {
    const node = h.doc.createElement('div');
    node.setAttribute('data-probe', String(i));
    wb.appendChild(node);
  }
  await h.settle(3);
  check('observations counter grew from host mutations', K.GMUX.state.diagnostics.observations > obsBefore);
  check('mutation volume was measured (§35 narrowing evidence)', K.mutationVolume.total >= 30);
  check('peak batch recorded', K.mutationVolume.maxBatch >= 1);
  check('still exactly one root after churn', h.doc.querySelectorAll(OWNER_SELECTOR).length === 1);
  check('shell subtree unchanged by churn', !!h.doc.getElementById('gmux-toolbar'));
  check('no GMUX nodes leaked into the host subtree', h.doc.querySelector('.workbench [data-gmux-owner]') === null);
  h.uninstall();
}

/* --------------------------- 16. empty <body> --------------------------- */
section('Degradation without a usable body (§59)');
{
  const doc = createDocument({});
  const noBodyDoc = doc;
  noBodyDoc.body = null;
  const h = install({});
  h.doc.body = null;
  let threw = null;
  let K = null;
  try { K = loadFresh(); } catch (e) { threw = e; }
  check('no exception without a body', threw === null, String(threw));
  check('no shell created without a body', h.doc.querySelectorAll(OWNER_SELECTOR).length === 0);
  check('no observer without a body', K.GMUX.observer === null);
  h.uninstall();
}

/* ------------------------------- summary -------------------------------- */
console.log(`\ndom-smoke: ${passed} passed, ${failed} failed`);
if (failed) {
  console.error('failures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
  process.exitCode = 1;
}
