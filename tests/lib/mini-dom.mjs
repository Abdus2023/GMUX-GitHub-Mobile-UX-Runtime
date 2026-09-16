/**
 * Miniature DOM harness for GMUX tests — dependency-free, Node only.
 *
 * It exists so the runtime's DOM contracts can be evidenced without a browser
 * (shell singleton, style singleton, observer idempotence, kill switch). It is
 * NOT a browser: anything measured here is recorded as harness evidence, never
 * as live-host VERIFIED (pack §60/§67/§68).
 *
 * Supported: element/attr/class/id/descendant selectors, `[attr="v"]`, dataset,
 * classList, textContent aggregation, event bubbling, automatic
 * MutationObserver batching, HTML parsing for fixtures, serialization.
 */

/* ------------------------------- selectors -------------------------------- */

function parseSegment(text) {
  const seg = { tag: null, ids: [], cls: [], attrs: [] };
  let rest = String(text).trim();
  if (rest === '*') return { star: true };
  const tagM = rest.match(/^[a-zA-Z][\w-]*/);
  if (tagM) { seg.tag = tagM[0].toUpperCase(); rest = rest.slice(tagM[0].length); }
  const attrRe = /\[([^\]]+)\]/g;
  let am;
  while ((am = attrRe.exec(rest))) seg.attrs.push(parseAttr(am[1]));
  rest = rest.replace(/\[[^\]]+\]/g, '');
  const tokRe = /([.#])([\w-]+)/g;
  let tm;
  while ((tm = tokRe.exec(rest))) {
    if (tm[1] === '.') seg.cls.push(tm[2]); else seg.ids.push(tm[2]);
  }
  return seg;
}

function parseAttr(text) {
  const eq = String(text).match(/^([\w-]+)([~^$*|]?=)"?([^"]*)"$/);
  if (eq) return { name: eq[1], op: eq[2], val: eq[3] };
  const eq2 = String(text).match(/^([\w-]+)=([\w-]+)$/);
  if (eq2) return { name: eq2[1], op: '=', val: eq2[2] };
  return { name: String(text).trim(), op: null, val: null };
}

function matchSegment(el, seg) {
  if (seg.star) return el.nodeType === 1;
  if (seg.tag && el.tagName !== seg.tag) return false;
  if (seg.ids.length && seg.ids.some((i) => el.id !== i)) return false;
  if (seg.cls.some((c) => !el.classes.has(c))) return false;
  for (const a of seg.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.op === '=') { if (el.getAttribute(a.name) !== a.val) return false; }
    if (a.op === '^=') { if (!String(el.getAttribute(a.name)).startsWith(a.val)) return false; }
  }
  return true;
}

function matchPath(el, segs) {
  if (!matchSegment(el, segs[segs.length - 1])) return false;
  let node = el.parentNode;
  for (let i = segs.length - 2; i >= 0; i--) {
    let found = false;
    while (node) {
      if (matchSegment(node, segs[i])) { found = true; node = node.parentNode; break; }
      node = node.parentNode;
    }
    if (!found) return false;
  }
  return true;
}

function selectAll(root, selector) {
  const out = [];
  for (const group of String(selector).split(',').map((s) => s.trim()).filter(Boolean)) {
    const segs = group.split(/\s+/).map(parseSegment);
    walk(root, (el) => { if (el !== root && matchPath(el, segs)) out.push(el); });
  }
  return Array.from(new Set(out));
}

/* --------------------------------- element -------------------------------- */

let nodeSeq = 0;

class El {
  constructor(tag, owner) {
    this.nodeType = 1;
    this.tagName = String(tag || 'div').toUpperCase();
    this.ownerDocument = owner || null;
    this.children = [];
    this.parentNode = null;
    this.attrs = new Map();
    this.classes = new Set();
    this.hidden = false;
    this.disabled = false;
    this.type = '';
    this._text = '';
    this._listeners = [];
    this._uid = ++nodeSeq;
    this.style = {
      _props: new Map(),
      setProperty(k, v) { this._props.set(k, String(v)); },
      getPropertyValue(k) { return this._props.has(k) ? this._props.get(k) : ''; },
      removeProperty(k) { this._props.delete(k); },
    };
    const el = this;
    this.dataset = new Proxy({}, {
      get(_t, key) {
        if (typeof key !== 'string') return undefined;
        const v = el.attrs.get(`data-${kebab(key)}`);
        return v === undefined ? undefined : v;
      },
      set(_t, key, value) { el.setAttribute(`data-${kebab(key)}`, String(value)); return true; },
      has(_t, key) { return el.attrs.has(`data-${kebab(key)}`); },
      deleteProperty(_t, key) { el.attrs.delete(`data-${kebab(key)}`); return true; },
      ownKeys() { return Array.from(el.attrs.keys()).filter((k) => k.startsWith('data-')).map((k) => camel(k.slice(5))); },
      getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
    });
    this.classList = {
      add: (...xs) => xs.forEach((x) => el.classes.add(x)),
      remove: (...xs) => xs.forEach((x) => el.classes.delete(x)),
      contains: (x) => el.classes.has(x),
      toggle: (x) => (el.classes.has(x) ? (el.classes.delete(x), false) : (el.classes.add(x), true)),
    };
  }

  setAttribute(name, value) {
    const next = String(value);
    if (this.attrs.get(name) === next) return;
    this.attrs.set(name, next);
    if (name === 'class') this.classes = new Set(next.split(/\s+/).filter(Boolean));
    if (name === 'hidden') this.hidden = true;
    this._notify('attributes', name);
  }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  hasAttribute(name) { return this.attrs.has(name); }
  removeAttribute(name) { if (this.attrs.delete(name)) this._notify('attributes', name); }

  get id() { return this.attrs.get('id') || ''; }
  set id(v) { this.setAttribute('id', String(v)); }
  get className() { return Array.from(this.classes).join(' '); }
  set className(v) { this.setAttribute('class', String(v || '')); }

  get textContent() {
    if (this.children.length === 0) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  set textContent(value) {
    const had = this.children.length > 0 || this._text !== '';
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this._text = String(value);
    if (had) this._notify('childList');
  }

  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.children.push(node);
    this._notify('childList');
    return node;
  }
  removeChild(node) {
    const i = this.children.indexOf(node);
    if (i >= 0) this.children.splice(i, 1);
    node.parentNode = null;
    this._notify('childList');
    return node;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    this.textContent = '';
    this.append(...nodes);
  }

  addEventListener(type, fn) { this._listeners.push([String(type), fn]); }
  removeEventListener(type, fn) {
    this._listeners = this._listeners.filter(([t, f]) => !(t === String(type) && f === fn));
  }
  dispatchEvent(event) {
    let node = this;
    while (node) {
      for (const [t, fn] of node._listeners.slice()) {
        if (t === event.type) {
          try { fn.call(node, event); } catch (e) { event.__error = e; throw e; }
        }
      }
      if (event.__bubbles === false) break;
      node = node.parentNode;
    }
    return true;
  }
  /** Convenience used by tests: fires a bubbling click/keydown. */
  click() { this.dispatchEvent(makeEvent('click', { target: this })); }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }

  matches(selector) {
    return String(selector).split(',').map((s) => s.trim()).filter(Boolean)
      .some((g) => matchPath(this, g.split(/\s+/).map(parseSegment)));
  }
  closest(selector) {
    let node = this;
    while (node) { if (node.matches && node.matches(selector)) return node; node = node.parentNode; }
    return null;
  }
  querySelector(selector) { return selectAll(this, selector)[0] || null; }
  querySelectorAll(selector) { return selectAll(this, selector); }
  contains(other) {
    let node = other;
    while (node) { if (node === this) return true; node = node.parentNode; }
    return false;
  }
  getBoundingClientRect() {
    const r = this.attrs.get('data-rect');
    if (r) {
      const [x, y, width, height] = r.split(':').map(Number);
      return { x, y, width, height, top: y, left: x, right: x + width, bottom: y + height };
    }
    return { x: 0, y: 0, width: this.hidden ? 0 : 48, height: this.hidden ? 0 : 48, top: 0, left: 0, right: 0, bottom: 0 };
  }
  getClientRects() { return this.hidden ? [] : [this.getBoundingClientRect()]; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return !!(this.ownerDocument && n === this.ownerDocument.body); }
  get offsetWidth() { return this.getBoundingClientRect().width; }
  get offsetHeight() { return this.getBoundingClientRect().height; }

  _notify(kind, attributeName) {
    const doc = this.ownerDocument;
    if (doc) doc.__mutationPending(this, kind, attributeName);
  }
}

function kebab(s) { return String(s).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`); }
function camel(s) { return String(s).replace(/-([a-z])/g, (_m, c) => c.toUpperCase()); }
function walk(root, fn) { root.children.slice().forEach((c) => { fn(c); walk(c, fn); }); }

function makeEvent(type, init = {}) {
  return {
    type,
    bubbles: init.bubbles !== false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.__bubbles = false; },
    ...init,
  };
}

/* ----------------------------- MutationObserver ---------------------------- */

export function createMutationObserverClass(doc) {
  class MiniMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = [];
      this.active = false;
      doc.__observers.add(this);
    }
    observe(target, options) {
      this.targets.push({ target, options: options || {} });
      this.active = true;
    }
    disconnect() {
      this.targets = [];
      this.active = false;
      doc.__observers.delete(this);
    }
    takeRecords() { return []; }
  }
  return MiniMutationObserver;
}

/* -------------------------------- HTML parse ------------------------------- */

const VOID_TAGS = new Set(['AREA', 'BASE', 'BR', 'COL', 'EMBED', 'HR', 'IMG', 'INPUT', 'LINK', 'META', 'SOURCE', 'TRACK', 'WBR']);

/** Very small HTML parser: enough for scriptless recognition fixtures. */
export function parseHTML(html, doc) {
  const source = String(html).replace(/<!--[\s\S]*?-->/g, '');
  const root = doc.createElement('div');
  const stack = [root];
  const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^>]*?)?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(source))) {
    if (m[4] !== undefined) {
      const text = m[4].replace(/\s+/g, ' ');
      if (text.trim()) stack[stack.length - 1].textContent += text.trim();
      continue;
    }
    const closing = m[0].startsWith('</');
    const tag = m[1].toUpperCase();
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = doc.createElement(tag);
    const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let a;
    while ((a = attrRe.exec(m[2] || ''))) {
      el.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? '');
    }
    stack[stack.length - 1].appendChild(el);
    if (!VOID_TAGS.has(tag) && !m[3]) stack.push(el);
  }
  return root;
}

/** Structural serialization used to prove the host subtree is untouched. */
export function serialize(el) {
  const attrs = Array.from(el.attrs.entries())
    .filter(([k]) => k !== 'data-rect')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => ` ${k}="${v}"`).join('');
  const cls = el.classes.size ? ` class="${Array.from(el.classes).sort().join(' ')}"` : '';
  const kids = el.children.map(serialize).join('');
  const text = el.children.length === 0 ? escapeText(el._text) : '';
  return `<${el.tagName.toLowerCase()}${cls}${attrs}>${kids}${text}</${el.tagName.toLowerCase()}>`;
}

function escapeText(t) {
  return String(t == null ? '' : t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

/* ------------------------------- mini document ----------------------------- */

export function createDocument(opts = {}) {
  const doc = {
    readyState: opts.readyState || 'complete',
    activeElement: null,
    __observers: new Set(),
    __mutationQueue: [],
    _listeners: [],
    createElement(tag) { return new El(tag, doc); },
    createTextNode(text) { const t = new El('#text', doc); t.textContent = String(text); return t; },
    getElementById(id) {
      let found = null;
      walk(doc.documentElement, (el) => { if (!found && el.id === id) found = el; });
      return found;
    },
    querySelector(sel) { return selectAll(doc.documentElement, sel)[0] || null; },
    querySelectorAll(sel) { return selectAll(doc.documentElement, sel); },
    addEventListener(type, fn) { doc._listeners.push([String(type), fn]); },
    removeEventListener(type, fn) {
      doc._listeners = doc._listeners.filter(([t, f]) => !(t === String(type) && f === fn));
    },
    dispatchEvent(event) {
      for (const [t, fn] of doc._listeners.slice()) if (t === event.type) fn.call(doc, event);
      return true;
    },
    __mutationPending(target, kind, attributeName) {
      if (kind === 'attributes' && attributeName) {
        for (const rec of doc.__mutationQueue) {
          if (rec.__pending && rec.target === target && rec.attributeName === attributeName) return;
        }
      }
      doc.__mutationQueue.push({ type: kind, target, attributeName: attributeName || null, addedNodes: [], removedNodes: [], __pending: true });
    },
  };
  doc.documentElement = new El('html', doc);
  doc.head = new El('head', doc);
  doc.body = opts.body || new El('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  /** Deliver queued records the way a real MutationObserver does: batched. */
  doc.flushMutations = async () => {
    for (let pass = 0; pass < 4; pass++) {
      const records = doc.__mutationQueue.splice(0, doc.__mutationQueue.length);
      if (records.length === 0) break;
      for (const observer of Array.from(doc.__observers)) {
        if (!observer.active) continue;
        const relevant = records.filter((r) => observer.targets.some((t) => {
          if (!t.options.subtree) return t.target === r.target;
          return t.target.contains(r.target);
        }));
        if (relevant.length) observer.callback(relevant, observer);
      }
      await Promise.resolve();
    }
  };
  return doc;
}

export function createWindow(doc, opts = {}) {
  const store = opts.localStorage || (() => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
      clear: () => map.clear(),
      get length() { return map.size; },
      key: (i) => Array.from(map.keys())[i] ?? null,
      __store: map,
    };
  })();

  const win = {
    document: doc,
    innerWidth: opts.width ?? 412,
    innerHeight: opts.height ?? 915,
    visualViewport: opts.visualViewport === null ? null : Object.assign({
      width: opts.width ?? 412,
      height: opts.height ?? 915,
      offsetTop: 0,
      _listeners: [],
      addEventListener(type, fn) { this._listeners.push([String(type), fn]); },
      removeEventListener(type, fn) { this._listeners = this._listeners.filter(([t]) => t !== String(type)); },
      dispatchEvent(event) { for (const [t, fn] of this._listeners.slice()) if (t === event.type) fn(event); return true; },
    }, opts.visualViewport || {}),
    localStorage: store,
    location: opts.location || { hostname: 'github.dev', href: 'https://github.dev/o/r', search: '', pathname: '/o/r' },
    history: opts.history || { pushState() { throw new Error('GMUX must not push history (§40)'); }, replaceState() { throw new Error('GMUX must not replace history (§40)'); }, length: 1 },
    matchMedia: opts.matchMedia || ((query) => ({ matches: /pointer:\s*coarse/.test(query) && opts.coarsePointer !== false, media: query, addEventListener() {}, removeEventListener() {} })),
    _listeners: [],
    addEventListener(type, fn) { win._listeners.push([String(type), fn]); },
    removeEventListener(type, fn) { win._listeners = win._listeners.filter(([t, f]) => !(t === String(type) && f === fn)); },
    dispatchEvent(event) { for (const [t, fn] of win._listeners.slice()) if (t === event.type) fn(event); return true; },
  };
  return win;
}

/** Installs globals, loads the userscript, returns a handle for teardown. */
let pendingFrames = new Set();

export function install({ width, height, viewportHeight, coarsePointer, touchPoints, href, hostname, rawPrefs, body, extraGlobals = {}, history, hostHTML } = {}) {
  pendingFrames = new Set();
  const doc = createDocument({ body });
  if (hostHTML) {
    // The host page must exist before the userscript evaluates, exactly as it
    // does on a real document-idle injection.
    const parsed = parseHTML(hostHTML, doc);
    while (parsed.children.length) doc.body.appendChild(parsed.children[0]);
  }
  const vvHeight = viewportHeight ?? height ?? 915;
  const win = createWindow(doc, {
    width: width ?? 412,
    height: height ?? 915,
    coarsePointer,
    history,
    location: { hostname: hostname || 'github.dev', href: href || 'https://github.dev/o/r', search: (href || '').includes('?') ? `?${String(href).split('?')[1]}` : '', pathname: '/o/r' },
    matchMedia: (query) => ({ matches: /pointer:\s*coarse/.test(query) ? coarsePointer !== false : false, media: query, addEventListener() {}, removeEventListener() {} }),
  });
  if (rawPrefs !== undefined) win.localStorage.setItem('github-dev-mobile:v1', rawPrefs);
  if (viewportHeight !== undefined) win.visualViewport.height = vvHeight;

  const saved = {};
  const globals = {
    window: win,
    document: doc,
    // Browsers expose these as globals next to `window`; the runtime follows
    // the pack's own idiom (`location.hostname`, `navigator.maxTouchPoints`).
    location: win.location,
    history: win.history,
    navigator: extraGlobals.navigator || { maxTouchPoints: touchPoints ?? 0, userAgent: 'node-harness' },
    MutationObserver: createMutationObserverClass(doc),
    requestAnimationFrame: (fn) => {
      const id = setTimeout(() => { pendingFrames.delete(id); try { fn(0); } catch (e) { /* harness */ } }, 0);
      pendingFrames.add(id);
      return id;
    },
    cancelAnimationFrame: (id) => clearTimeout(id),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ...extraGlobals,
  };
  for (const key of Object.keys(globals)) {
    saved[key] = Object.prototype.hasOwnProperty.call(globalThis, key)
      ? { had: true, value: globalThis[key] }
      : { had: false };
    // Node defines some globals (e.g. `navigator`) as getter-only accessors, so
    // assignment alone is not enough; defineProperty keeps this reversible.
    Object.defineProperty(globalThis, key, { value: globals[key], writable: true, configurable: true, enumerable: true });
  }

  return {
    doc,
    window: win,
    globals,
    /** Let queued mutations and scheduled frames run. */
    async settle(turns = 3) {
      for (let i = 0; i < turns; i++) {
        await doc.flushMutations();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    fire(type, init) {
      const event = makeEvent(type, init);
      doc.dispatchEvent(event);
      return event;
    },
    uninstall() {
      // Drop frames the runtime still had queued so harness teardown cannot
      // produce phantom errors that would be mistaken for runtime defects.
      for (const id of pendingFrames) clearTimeout(id);
      pendingFrames.clear();
      for (const [key, s] of Object.entries(saved)) {
        if (s.had) globalThis[key] = s.value;
        else delete globalThis[key];
      }
    },
  };
}

export { El, serialize as serializeNode, selectAll };
