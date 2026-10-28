(() => {
  const script = document.currentScript;
  const query = new URL(script ? script.src : location.href, location.href).searchParams;
  const CALLBACK = query.get("callback");
  const FAIL = query.get("fail");
  const TILE = 256;
  const SVG = "http://www.w3.org/2000/svg";
  const LOGO = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="66" height="26"><text x="2" y="19" font-family="Arial" font-size="18" fill="#5E5E5E">Google</text></svg>')}`;
  const ICONS = [
    { placeId: "mock-edition", name: "The New York EDITION", lat: 40.741389, lng: -73.987193 },
    { placeId: "mock-jfk-t4", name: "JFK Terminal 4", lat: 40.644166, lng: -73.782425 },
  ];
  const state = { maps: 0, map: null, setPathCalls: 0, failed: false, lines: [] };
  const blocked = new WeakSet();
  const quiet = new WeakSet();
  const handlers = new WeakMap();

  const event = {
    addListener(target, name, fn) {
      if (typeof fn !== "function") throw new TypeError("mock: event.addListener needs a function");
      const all = handlers.get(target) || new window.Map();
      handlers.set(target, all);
      const list = all.get(name) || [];
      all.set(name, list);
      const entry = { fn };
      list.push(entry);
      return { remove: () => list.splice(list.indexOf(entry) >>> 0, list.includes(entry) ? 1 : 0) };
    },
    removeListener(listener) {
      listener && listener.remove();
    },
    trigger(target, name, ...args) {
      const list = (handlers.get(target) || new window.Map()).get(name) || [];
      for (const { fn } of [...list]) fn.apply(target, args);
    },
    clearInstanceListeners(target) {
      handlers.delete(target);
    },
  };

  class MVCObject {
    addListener(name, fn) {
      return event.addListener(this, name, fn);
    }
  }

  class LatLng {
    constructor(lat, lng) {
      if (lat && typeof lat === "object") [lat, lng] = typeof lat.lat === "function" ? [lat.lat(), lat.lng()] : [lat.lat, lat.lng];
      if (!Number.isFinite(+lat) || !Number.isFinite(+lng)) throw new TypeError("mock: LatLng needs finite numbers");
      this.__lat = Math.max(-90, Math.min(90, +lat));
      this.__lng = ((((+lng + 180) % 360) + 360) % 360) - 180;
    }
    lat() {
      return this.__lat;
    }
    lng() {
      return this.__lng;
    }
    equals(other) {
      return !!other && Math.abs(this.lat() - other.lat()) < 1e-9 && Math.abs(this.lng() - other.lng()) < 1e-9;
    }
    toJSON() {
      return { lat: this.lat(), lng: this.lng() };
    }
    toString() {
      return `(${this.lat()}, ${this.lng()})`;
    }
    toUrlValue(precision = 6) {
      return `${+this.lat().toFixed(precision)},${+this.lng().toFixed(precision)}`;
    }
  }
  const toLatLng = (p) => (p instanceof LatLng ? p : new LatLng(p));

  class LatLngBounds {
    constructor(sw, ne) {
      this.__s = Infinity;
      this.__n = -Infinity;
      this.__w = Infinity;
      this.__e = -Infinity;
      if (sw && !ne && typeof sw === "object" && "north" in sw) {
        this.extend({ lat: sw.south, lng: sw.west });
        this.extend({ lat: sw.north, lng: sw.east });
      } else {
        sw && this.extend(sw);
        ne && this.extend(ne);
      }
    }
    extend(point) {
      const p = toLatLng(point);
      this.__s = Math.min(this.__s, p.lat());
      this.__n = Math.max(this.__n, p.lat());
      this.__w = Math.min(this.__w, p.lng());
      this.__e = Math.max(this.__e, p.lng());
      return this;
    }
    union(other) {
      if (!other.isEmpty()) this.extend(other.getSouthWest()).extend(other.getNorthEast());
      return this;
    }
    contains(point) {
      const p = toLatLng(point);
      return !this.isEmpty() && p.lat() >= this.__s && p.lat() <= this.__n && p.lng() >= this.__w && p.lng() <= this.__e;
    }
    isEmpty() {
      return this.__s > this.__n;
    }
    getSouthWest() {
      return new LatLng(this.__s, this.__w);
    }
    getNorthEast() {
      return new LatLng(this.__n, this.__e);
    }
    getCenter() {
      const { x, y } = worldOf(this.getSouthWest());
      const b = worldOf(this.getNorthEast());
      return latLngOf((x + b.x) / 2, (y + b.y) / 2);
    }
    toJSON() {
      return { south: this.__s, west: this.__w, north: this.__n, east: this.__e };
    }
  }

  class Point {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    equals(other) {
      return !!other && other.x === this.x && other.y === this.y;
    }
    toString() {
      return `(${this.x}, ${this.y})`;
    }
  }

  class MVCArray extends MVCObject {
    constructor(items = []) {
      super();
      this.__items = [...items];
    }
    getArray() {
      return this.__items;
    }
    getAt(i) {
      return this.__items[i];
    }
    getLength() {
      return this.__items.length;
    }
    forEach(fn) {
      this.__items.forEach(fn);
    }
    push(item) {
      return this.__items.push(item);
    }
    pop() {
      return this.__items.pop();
    }
    setAt(i, item) {
      this.__items[i] = item;
    }
    insertAt(i, item) {
      this.__items.splice(i, 0, item);
    }
    removeAt(i) {
      return this.__items.splice(i, 1)[0];
    }
    clear() {
      this.__items.length = 0;
    }
  }

  function worldOf(point) {
    const p = toLatLng(point);
    const s = Math.min(Math.max(Math.sin((p.lat() * Math.PI) / 180), -0.9999), 0.9999);
    return { x: TILE * (0.5 + p.lng() / 360), y: TILE * (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) };
  }
  function latLngOf(x, y) {
    const n = Math.PI - (2 * Math.PI * y) / TILE;
    return new LatLng((180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), (x / TILE - 0.5) * 360);
  }

  const RenderingType = Object.freeze({ RASTER: "RASTER", VECTOR: "VECTOR", UNINITIALIZED: "UNINITIALIZED" });
  const GESTURES = ["cooperative", "greedy", "none", "auto"];
  const OPTIONS = ["backgroundColor", "cameraControl", "center", "clickableIcons", "disableDefaultUI", "gestureHandling", "keyboardShortcuts", "mapId", "maxZoom", "minZoom", "renderingType", "restriction", "styles", "zoom"];
  const el = (tag, attrs = {}, css = "") => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (css) e.style.cssText = css;
    return e;
  };

  class Map extends MVCObject {
    constructor(div, options = {}) {
      super();
      if (!(div instanceof HTMLElement)) throw new TypeError("mock: Map needs an element");
      for (const name of Object.keys(options)) if (!OPTIONS.includes(name)) throw new Error(`mock: Map option ${name} is not implemented`);
      if (options.styles && options.mapId) throw new Error("mock: styles and mapId cannot be used together, the real API ignores styles");
      state.maps++;
      state.map = this;
      this.__div = div;
      this.__opts = { minZoom: 0, maxZoom: 22, gestureHandling: "auto", keyboardShortcuts: true, clickableIcons: true, ...options };
      this.__center = toLatLng(options.center || { lat: 0, lng: 0 });
      this.__zoom = Math.round(options.zoom ?? 1);
      this.__overlays = new Set();
      this.__lines = new Set();
      this.__mapId = options.mapId || null;
      this.__styles = options.styles || null;
      this.__rendering = options.renderingType || RenderingType.RASTER;
      this.__build();
      this.__clamp();
      this.__render();
      new ResizeObserver(() => this.__changed("resize")).observe(div);
      setTimeout(() => event.trigger(this, "tilesloaded"), 50);
      this.__idle();
      if (FAIL === "auth") setTimeout(() => this.__authFail(), 30);
    }
    __build() {
      const div = this.__div;
      div.style.position = div.style.position || "relative";
      div.style.overflow = "hidden";
      div.replaceChildren();
      this.__region = el("div", { tabindex: "0", "aria-label": "Map", "aria-roledescription": "map", role: "region" }, "position:absolute;inset:0");
      this.__style = el("div", { class: "gm-style" }, "position:absolute;inset:0;z-index:0;overflow:hidden;font-family:Roboto,Arial,sans-serif;font-size:11px");
      this.__tiles = el("div", { class: "gm-mock-tiles" }, `position:absolute;inset:0;background-color:${this.__opts.backgroundColor || "#E5E3DF"}`);
      this.__svg = document.createElementNS(SVG, "svg");
      this.__svg.setAttribute("class", "gm-mock-lines");
      this.__svg.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible";
      this.__paneRoot = el("div", {}, "position:absolute;left:50%;top:50%;width:0;height:0");
      this.__panes = {};
      for (const name of ["mapPane", "overlayLayer", "overlayShadow", "markerLayer", "overlayImage", "floatShadow", "overlayMouseTarget", "floatPane"]) this.__paneRoot.appendChild((this.__panes[name] = el("div", { "data-pane": name }, "position:absolute;left:0;top:0;width:100%;height:100%")));
      this.__icons = el("div", { class: "gm-mock-icons" }, "position:absolute;inset:0");
      this.__note = el("div", { class: "gm-style-moc" }, "position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.45);color:#fff;font-size:22px;text-align:center;pointer-events:none");
      const logo = el("div", {}, "position:absolute;left:0;bottom:0;margin:0 5px 5px;z-index:1000000");
      const link = el("a", { href: "https://maps.google.com/maps", target: "_blank", rel: "noopener", title: "Open this area in Google Maps (opens a new window)", "aria-label": "Open this area in Google Maps (opens a new window)" }, "display:block");
      const holder = el("div", {}, "width:66px;height:26px");
      holder.appendChild(el("img", { alt: "Google", src: LOGO, draggable: "false" }, "width:66px;height:26px"));
      link.appendChild(holder);
      logo.appendChild(link);
      const terms = el("div", { class: "gm-mock-terms" }, "position:absolute;right:0;bottom:0;display:flex;gap:6px;align-items:center;max-width:calc(100% - 80px);height:14px;overflow:hidden;padding:0 6px;background:rgba(245,245,245,.7);color:#000;font-size:10px;line-height:14px;white-space:nowrap;z-index:1000000");
      const keys = el("button", { type: "button", "aria-label": "Keyboard shortcuts", title: "Keyboard shortcuts" }, "border:0;background:none;padding:0;font:inherit;cursor:pointer");
      keys.textContent = "Keyboard shortcuts";
      const data = el("span");
      data.textContent = "Map data ©2026 Google";
      const termsLink = el("a", { href: "https://www.google.com/intl/en-US_US/help/terms_maps.html", target: "_blank", rel: "noopener" }, "color:inherit");
      termsLink.textContent = "Terms";
      terms.append(keys, data, termsLink);
      this.__camera = el("div", { class: "gm-mock-camera" }, "position:absolute;right:10px;bottom:24px;z-index:1000000");
      const cam = el("button", { type: "button", "aria-label": "Map camera controls", title: "Map camera controls", "aria-expanded": "false", class: "gm-control-active" }, "width:40px;height:40px;border:0;border-radius:2px;background:#fff;color:#000;font:18px/40px Arial,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.3);cursor:pointer");
      cam.textContent = "+";
      const menu = el("div", { class: "gm-mock-camera-menu" }, "position:absolute;right:0;bottom:44px;display:none;grid-template-columns:repeat(3,40px);gap:2px");
      for (const [label, fn] of [["Move up", () => this.panBy(0, -100)], ["Move left", () => this.panBy(-100, 0)], ["Move right", () => this.panBy(100, 0)], ["Move down", () => this.panBy(0, 100)], ["Zoom in", () => this.setZoom(this.__zoom + 1)], ["Zoom out", () => this.setZoom(this.__zoom - 1)]]) {
        const b = el("button", { type: "button", "aria-label": label, title: label }, "width:40px;height:40px;border:0;background:#fff;color:#000;cursor:pointer");
        b.textContent = label.split(" ")[1][0].toUpperCase();
        b.addEventListener("click", (e) => (e.stopPropagation(), fn()));
        menu.appendChild(b);
      }
      cam.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = cam.getAttribute("aria-expanded") !== "true";
        cam.setAttribute("aria-expanded", String(open));
        menu.style.display = open ? "grid" : "none";
      });
      this.__camera.append(menu, cam);
      for (const node of [logo, terms, this.__camera]) {
        for (const type of ["pointerdown", "pointerup", "click", "wheel"]) node.addEventListener(type, (e) => e.stopPropagation());
      }
      this.__style.append(this.__tiles, this.__icons, this.__svg, this.__paneRoot, this.__note, logo, terms, this.__camera);
      setTimeout(() => this.__failed || (div.append(el("div", {}, "width:100%;height:0"), this.__region, this.__style), this.__render()));
      this.__wire();
    }
    __wire() {
      const style = this.__style;
      let drag = null;
      const insideBlocked = (target) => {
        for (let n = target; n && n !== style; n = n.parentNode) if (blocked.has(n) || quiet.has(n)) return true;
        return false;
      };
      style.addEventListener("pointerdown", (e) => {
        if (insideBlocked(e.target) || e.button > 0) return;
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, last: [e.clientX, e.clientY], moved: false, type: e.pointerType, pan: this.__canPan(e.pointerType), target: e.target };
        if (drag.pan && style.setPointerCapture) style.setPointerCapture(e.pointerId);
      });
      style.addEventListener("pointermove", (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.last[0], dy = e.clientY - drag.last[1];
        if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 4) return;
        if (!drag.moved) {
          drag.moved = true;
          if (drag.pan) event.trigger(this, "dragstart");
          else if (drag.type === "touch") this.__hint("Use two fingers to move the map");
        }
        drag.last = [e.clientX, e.clientY];
        if (drag.pan) {
          this.__shift(-dx, -dy);
          event.trigger(this, "drag");
        }
      });
      const finish = (e, cancel) => {
        if (!drag || e.pointerId !== drag.id) return;
        const d = drag;
        drag = null;
        if (d.moved) {
          if (d.pan) {
            event.trigger(this, "dragend");
            this.__idle();
          }
          return;
        }
        this.__pending = cancel ? null : d.target;
      };
      style.addEventListener("pointerup", (e) => finish(e, false));
      style.addEventListener("pointercancel", (e) => finish(e, true));
      style.addEventListener("click", (e) => {
        const target = this.__pending;
        this.__pending = null;
        if (target && !insideBlocked(e.target)) this.__click(e, target);
      });
      style.addEventListener("wheel", (e) => {
        if (insideBlocked(e.target)) return;
        const g = this.__gesture();
        if (g === "none") return;
        if (g === "cooperative" && !e.ctrlKey && !e.metaKey) return this.__hint(/Mac/.test(navigator.platform) ? "Use ⌘ + scroll to zoom the map" : "Use ctrl + scroll to zoom the map");
        e.preventDefault();
        this.setZoom(this.__zoom + (e.deltaY < 0 ? 1 : -1));
      }, { passive: false });
      this.__region.addEventListener("keydown", (e) => {
        if (!this.__opts.keyboardShortcuts) return;
        const move = { ArrowUp: [0, -100], ArrowDown: [0, 100], ArrowLeft: [-100, 0], ArrowRight: [100, 0] }[e.key];
        if (move) return e.preventDefault(), this.panBy(...move);
        if (e.key === "+" || e.key === "=") return e.preventDefault(), this.setZoom(this.__zoom + 1);
        if (e.key === "-") return e.preventDefault(), this.setZoom(this.__zoom - 1);
      });
    }
    __gesture() {
      const g = this.__opts.gestureHandling;
      return g === "auto" ? (window.self !== window.top ? "cooperative" : "greedy") : g;
    }
    __canPan(type) {
      const g = this.__gesture();
      return g === "greedy" || (g === "cooperative" && type !== "touch");
    }
    __hint(text) {
      this.__note.textContent = text;
      this.__note.style.display = "flex";
      clearTimeout(this.__noteTimer);
      this.__noteTimer = setTimeout(() => (this.__note.style.display = "none"), 1500);
    }
    __click(e, target) {
      const rect = this.__div.getBoundingClientRect();
      const pixel = new Point(e.clientX - rect.left, e.clientY - rect.top);
      const icon = target && target.closest && target.closest("[data-place-id]");
      const latLng = icon ? new LatLng(+icon.dataset.lat, +icon.dataset.lng) : this.__proj.fromContainerPixelToLatLng(pixel);
      let stopped = false;
      const payload = { latLng, pixel, domEvent: e, stop: () => (stopped = true) };
      if (icon) payload.placeId = icon.dataset.placeId;
      event.trigger(this, "click", payload);
      if (icon && !stopped) this.__info(icon);
    }
    __info(icon) {
      const box = el("div", { class: "gm-style-iw", role: "dialog" }, "position:absolute;left:50%;top:20%;transform:translateX(-50%);padding:8px 12px;background:#fff;box-shadow:0 2px 7px rgba(0,0,0,.3);color:#000;z-index:5");
      box.textContent = icon.dataset.name;
      this.__style.appendChild(box);
    }
    __authFail() {
      if (this.__failed) return;
      this.__failed = true;
      state.failed = true;
      const box = el("div", { class: "gm-err-container" }, "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#e5e3df");
      const t = el("div", { class: "gm-err-title" });
      t.textContent = "Oops! Something went wrong.";
      box.appendChild(t);
      this.__div.replaceChildren(box);
      if (typeof window.gm_authFailure === "function") window.gm_authFailure();
    }
    __size() {
      return [this.__div.clientWidth, this.__div.clientHeight];
    }
    __scale(zoom = this.__zoom) {
      return 2 ** zoom;
    }
    __clamp() {
      const o = this.__opts;
      this.__zoom = Math.max(o.minZoom ?? 0, Math.min(o.maxZoom ?? 22, Math.round(this.__zoom)));
      const r = o.restriction && o.restriction.latLngBounds;
      if (r) {
        const b = r instanceof LatLngBounds ? r : new LatLngBounds(r);
        const sw = b.getSouthWest(), ne = b.getNorthEast();
        this.__center = new LatLng(Math.max(sw.lat(), Math.min(ne.lat(), this.__center.lat())), Math.max(sw.lng(), Math.min(ne.lng(), this.__center.lng())));
      }
    }
    __shift(dx, dy) {
      const s = this.__scale(), w = worldOf(this.__center);
      this.__center = latLngOf(w.x + dx / s, w.y + dy / s);
      this.__changed("center");
    }
    __changed(what) {
      const before = [this.__center.toString(), this.__zoom];
      this.__clamp();
      this.__render();
      if (what === "zoom") event.trigger(this, "zoom_changed");
      if (what === "center" || before[0] !== this.__center.toString()) event.trigger(this, "center_changed");
      event.trigger(this, "bounds_changed");
      this.__idle();
    }
    __idle() {
      clearTimeout(this.__idleTimer);
      this.__idleTimer = setTimeout(() => event.trigger(this, "idle"));
    }
    get __proj() {
      const map = this;
      const toDiv = (p) => {
        const s = map.__scale(), a = worldOf(p), c = worldOf(map.__center);
        return new Point((a.x - c.x) * s, (a.y - c.y) * s);
      };
      const fromDiv = (pt) => {
        const s = map.__scale(), c = worldOf(map.__center);
        return latLngOf(c.x + pt.x / s, c.y + pt.y / s);
      };
      return {
        fromLatLngToDivPixel: (p) => (p ? toDiv(p) : null),
        fromDivPixelToLatLng: (pt) => (pt ? fromDiv(pt) : null),
        fromLatLngToContainerPixel: (p) => {
          if (!p) return null;
          const q = toDiv(p), [w, h] = map.__size();
          return new Point(q.x + w / 2, q.y + h / 2);
        },
        fromContainerPixelToLatLng: (pt) => {
          if (!pt) return null;
          const [w, h] = map.__size();
          return fromDiv(new Point(pt.x - w / 2, pt.y - h / 2));
        },
        getWorldWidth: () => TILE * map.__scale(),
      };
    }
    __render() {
      if (this.__failed) return;
      const s = this.__scale(), c = worldOf(this.__center), [w, h] = this.__size();
      const step = TILE / 4;
      const ox = -((c.x * s) % step) + w / 2, oy = -((c.y * s) % step) + h / 2;
      this.__tiles.style.backgroundImage = "linear-gradient(#e6dfd2 1px,transparent 1px),linear-gradient(90deg,#e6dfd2 1px,transparent 1px)";
      this.__tiles.style.backgroundSize = `${step}px ${step}px`;
      this.__tiles.style.backgroundPosition = `${ox}px ${oy}px`;
      this.__icons.replaceChildren();
      if (this.__opts.clickableIcons !== false) {
        for (const icon of ICONS) {
          const p = this.__proj.fromLatLngToContainerPixel(icon);
          if (p.x < -20 || p.y < -20 || p.x > w + 20 || p.y > h + 20) continue;
          const dot = el("div", { "data-place-id": icon.placeId, "data-name": icon.name, "data-lat": String(icon.lat), "data-lng": String(icon.lng) }, `position:absolute;left:${p.x - 7}px;top:${p.y - 7}px;width:14px;height:14px;border-radius:50%;background:#9c9c9c;cursor:pointer`);
          this.__icons.appendChild(dot);
        }
      }
      for (const line of this.__lines) line.__draw();
      for (const overlay of this.__overlays) if (overlay.__added && typeof overlay.draw === "function") overlay.draw();
    }
    setOptions(options = {}) {
      for (const name of Object.keys(options)) if (!OPTIONS.includes(name)) throw new Error(`mock: Map option ${name} is not implemented`);
      if ("mapId" in options || "renderingType" in options) throw new Error("mock: mapId and renderingType cannot change after the map is created");
      if (options.styles && this.__mapId) throw new Error("mock: styles and mapId cannot be used together");
      if (options.gestureHandling && !GESTURES.includes(options.gestureHandling)) throw new Error("mock: unknown gestureHandling");
      Object.assign(this.__opts, options);
      if (options.center) this.__center = toLatLng(options.center);
      if (options.zoom != null) this.__zoom = options.zoom;
      this.__changed(options.zoom != null ? "zoom" : "options");
    }
    get(name) {
      return this.__opts[name];
    }
    getDiv() {
      return this.__div;
    }
    getCenter() {
      return this.__center;
    }
    setCenter(p) {
      this.__center = toLatLng(p);
      this.__changed("center");
    }
    panTo(p) {
      this.setCenter(p);
    }
    panBy(x, y) {
      this.__shift(x, y);
    }
    getZoom() {
      return this.__zoom;
    }
    setZoom(z) {
      if (!Number.isFinite(z)) throw new TypeError("mock: setZoom needs a number");
      this.__zoom = z;
      this.__changed("zoom");
    }
    getBounds() {
      const [w, h] = this.__size();
      const p = this.__proj;
      return new LatLngBounds(p.fromContainerPixelToLatLng(new Point(0, h)), p.fromContainerPixelToLatLng(new Point(w, 0)));
    }
    getMapTypeId() {
      return "roadmap";
    }
    getRenderingType() {
      return this.__rendering;
    }
    fitBounds(bounds, padding = 0) {
      const b = bounds instanceof LatLngBounds ? bounds : new LatLngBounds(bounds);
      if (b.isEmpty()) return;
      const pad = typeof padding === "number" ? { top: padding, right: padding, bottom: padding, left: padding } : { top: 0, right: 0, bottom: 0, left: 0, ...padding };
      const [w, h] = this.__size();
      const a = worldOf(b.getSouthWest()), c = worldOf(b.getNorthEast());
      const bw = Math.abs(c.x - a.x), bh = Math.abs(a.y - c.y);
      const fw = Math.max(1, w - pad.left - pad.right), fh = Math.max(1, h - pad.top - pad.bottom);
      let zoom = this.__opts.maxZoom ?? 22;
      while (zoom > (this.__opts.minZoom ?? 0) && (bw * 2 ** zoom > fw || bh * 2 ** zoom > fh)) zoom--;
      const s = 2 ** zoom;
      const cx = (a.x + c.x) / 2 + (pad.right - pad.left) / 2 / s, cy = (a.y + c.y) / 2 + (pad.bottom - pad.top) / 2 / s;
      this.__zoom = zoom;
      this.__center = latLngOf(cx, cy);
      this.__changed("zoom");
    }
  }

  class OverlayView extends MVCObject {
    setMap(map) {
      const old = this.__map;
      if (old === map) return;
      if (old) {
        old.__overlays.delete(this);
        if (this.__added && typeof this.onRemove === "function") this.onRemove();
        this.__added = false;
      }
      this.__map = map || null;
      if (!map) return;
      map.__overlays.add(this);
      setTimeout(() => {
        if (this.__map !== map || this.__added) return;
        this.__added = true;
        if (typeof this.onAdd === "function") this.onAdd();
        if (typeof this.draw === "function") this.draw();
      });
    }
    getMap() {
      return this.__map || null;
    }
    getPanes() {
      return this.__map && this.__added ? this.__map.__panes : null;
    }
    getProjection() {
      return this.__map && this.__added ? this.__map.__proj : null;
    }
    static preventMapHitsAndGesturesFrom(element) {
      blocked.add(element);
      for (const type of ["click", "dblclick", "contextmenu", "pointerdown", "mousedown", "touchstart", "wheel"]) element.addEventListener(type, (e) => e.stopPropagation());
    }
    static preventMapHitsFrom(element) {
      quiet.add(element);
      for (const type of ["click", "dblclick", "contextmenu"]) element.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  class Polyline extends MVCObject {
    constructor(options = {}) {
      super();
      this.__opts = { strokeColor: "#000000", strokeOpacity: 1, strokeWeight: 3, zIndex: 0, clickable: true, icons: null };
      this.__path = new MVCArray([]);
      this.__sets = 0;
      this.__node = document.createElementNS(SVG, "path");
      this.__node.setAttribute("fill", "none");
      this.__node.setAttribute("stroke-linecap", "round");
      this.__node.setAttribute("stroke-linejoin", "round");
      state.lines.push(this);
      this.setOptions(options);
    }
    setOptions(options = {}) {
      const { map, path, ...rest } = options;
      Object.assign(this.__opts, rest);
      if (path) this.__path = new MVCArray([...(path instanceof MVCArray ? path.getArray() : path)].map(toLatLng));
      if ("map" in options) this.setMap(map);
      else this.__draw();
    }
    setMap(map) {
      if (this.__map) this.__map.__lines.delete(this);
      this.__node.remove();
      this.__map = map || null;
      if (map) {
        map.__lines.add(this);
        map.__svg.appendChild(this.__node);
        this.__draw();
      }
    }
    getMap() {
      return this.__map || null;
    }
    setPath(path) {
      this.__sets++;
      state.setPathCalls++;
      this.__path = new MVCArray([...(path instanceof MVCArray ? path.getArray() : path)].map(toLatLng));
      this.__draw();
    }
    getPath() {
      return this.__path;
    }
    getVisible() {
      return true;
    }
    __draw() {
      const map = this.__map;
      if (!map) return;
      const pts = this.__path.getArray().map((p) => map.__proj.fromLatLngToContainerPixel(p));
      const o = this.__opts;
      this.__node.setAttribute("d", pts.length ? "M" + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join("L") : "");
      this.__node.setAttribute("stroke", o.strokeColor);
      this.__node.setAttribute("stroke-opacity", String(o.strokeOpacity));
      this.__node.setAttribute("stroke-width", String(o.strokeWeight));
      this.__node.dataset.z = String(o.zIndex || 0);
      const nodes = [...map.__svg.children].sort((a, b) => +a.dataset.z - +b.dataset.z);
      if (nodes.some((n, i) => map.__svg.children[i] !== n)) map.__svg.replaceChildren(...nodes);
    }
  }

  const core = { LatLng, LatLngBounds, Point, MVCArray, MVCObject, event };
  const mapsLib = { Map, OverlayView, Polyline, RenderingType };
  const namespace = { ...core, ...mapsLib, version: "mock" };
  namespace.importLibrary = (name) => {
    if (name === "core") return Promise.resolve({ ...core });
    if (name === "maps") return Promise.resolve({ ...mapsLib });
    return Promise.reject(new Error(`mock: library ${name} is not implemented`));
  };
  window.google = window.google || {};
  window.google.maps = namespace;

  const client = (map, lat, lng) => {
    const r = map.__div.getBoundingClientRect(), p = map.__proj.fromLatLngToContainerPixel({ lat, lng });
    return { x: r.left + p.x, y: r.top + p.y };
  };
  window.__gmock = {
    get maps() {
      return state.maps;
    },
    get map() {
      return state.map;
    },
    get setPathCalls() {
      return state.setPathCalls;
    },
    get failed() {
      return state.failed;
    },
    lines: () =>
      state.lines
        .filter((l) => l.__map)
        .map((l) => {
          const pts = l.__path.getArray();
          return { color: l.__opts.strokeColor, weight: l.__opts.strokeWeight, opacity: l.__opts.strokeOpacity, z: l.__opts.zIndex || 0, points: pts.length, first: pts[0] && pts[0].toJSON(), last: pts.length ? pts[pts.length - 1].toJSON() : null, sets: l.__sets };
        }),
    overlays: () => {
      const map = state.map;
      if (!map) return [];
      const r = map.__div.getBoundingClientRect();
      return Object.values(map.__panes).flatMap((pane) =>
        [...pane.children].map((node) => {
          const b = node.getBoundingClientRect();
          const p = map.__proj.fromContainerPixelToLatLng(new Point(b.left + b.width / 2 - r.left, b.top + b.height / 2 - r.top));
          return { node, className: String(node.className || ""), hidden: node.hidden, lat: p.lat(), lng: p.lng() };
        }),
      );
    },
    px: (lat, lng) => client(state.map, lat, lng),
    ll: (x, y) => {
      const map = state.map, r = map.__div.getBoundingClientRect();
      return map.__proj.fromContainerPixelToLatLng(new Point(x - r.left, y - r.top)).toJSON();
    },
  };

  setTimeout(() => {
    const fn = CALLBACK && CALLBACK.split(".").reduce((o, k) => o && o[k], window);
    if (typeof fn === "function") fn();
    if (FAIL === "auth") setTimeout(() => {
      state.failed = true;
      if (typeof window.gm_authFailure === "function") window.gm_authFailure();
    });
  });
})();
