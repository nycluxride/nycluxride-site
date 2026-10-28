import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..");
const MOCK = readFileSync(join(ROOT, "test/fixtures/gmaps-mock.js"), "utf8");
const MAP_FILES = readdirSync(join(ROOT, "assets")).filter((f) => /^map\.[A-Za-z0-9_-]+\.js$/.test(f));
const MAP_JS = MAP_FILES.map((f) => readFileSync(join(ROOT, "assets", f), "utf8")).join("\n");

const REFERENCE = {
  core: ["ColorScheme", "ControlPosition", "LatLng", "LatLngAltitude", "LatLngBounds", "MVCArray", "MVCObject", "MapsNetworkError", "MapsNetworkErrorEndpoint", "MapsRequestError", "MapsServerError", "Orientation3D", "Point", "RPCStatus", "Settings", "Size", "SymbolPath", "UnitSystem", "Vector3D", "event"],
  maps: ["BicyclingLayer", "Circle", "Data", "FeatureType", "GroundOverlay", "ImageMapType", "InfoWindow", "KmlLayer", "KmlLayerStatus", "Map", "MapElement", "MapTypeControlStyle", "MapTypeId", "MapTypeRegistry", "MaxZoomService", "MaxZoomStatus", "OverlayView", "Polygon", "Polyline", "Rectangle", "RenderingType", "StrokePosition", "StyledMapType", "TrafficLayer", "TransitLayer", "WebGLOverlayView", "ZoomChangeEvent"],
  mapOptions: ["backgroundColor", "cameraControl", "cameraControlOptions", "center", "clickableIcons", "colorScheme", "controlSize", "disableDefaultUI", "disableDoubleClickZoom", "draggableCursor", "draggingCursor", "fullscreenControl", "gestureHandling", "heading", "isFractionalZoomEnabled", "keyboardShortcuts", "mapId", "mapTypeControl", "mapTypeId", "maxZoom", "minZoom", "noClear", "renderingType", "restriction", "rotateControl", "scaleControl", "scrollwheel", "streetView", "streetViewControl", "styles", "tilt", "zoom", "zoomControl"],
  mapMethods: ["addListener", "fitBounds", "getBounds", "getCenter", "getDiv", "getHeading", "getMapTypeId", "getProjection", "getRenderingType", "getTilt", "getZoom", "moveCamera", "panBy", "panTo", "panToBounds", "setCenter", "setHeading", "setMapTypeId", "setOptions", "setTilt", "setZoom"],
  overlay: ["draw", "getMap", "getPanes", "getProjection", "onAdd", "onRemove", "setMap", "preventMapHitsAndGesturesFrom", "preventMapHitsFrom"],
  panes: ["floatPane", "mapPane", "markerLayer", "overlayLayer", "overlayMouseTarget"],
  projection: ["fromContainerPixelToLatLng", "fromDivPixelToLatLng", "fromLatLngToContainerPixel", "fromLatLngToDivPixel", "getVisibleRegion", "getWorldWidth"],
  polyline: ["getDraggable", "getEditable", "getMap", "getPath", "getVisible", "setDraggable", "setEditable", "setMap", "setOptions", "setPath", "setVisible"],
  polylineOptions: ["clickable", "draggable", "editable", "geodesic", "icons", "map", "path", "strokeColor", "strokeOpacity", "strokeWeight", "visible", "zIndex"],
  latLng: ["equals", "lat", "lng", "toJSON", "toString", "toUrlValue"],
  bounds: ["contains", "equals", "extend", "getCenter", "getNorthEast", "getSouthWest", "intersects", "isEmpty", "toJSON", "toSpan", "toString", "toUrlValue", "union"],
  mouse: ["domEvent", "latLng", "stop", "placeId", "pixel"],
  events: ["bounds_changed", "center_changed", "click", "contextmenu", "dblclick", "drag", "dragend", "dragstart", "heading_changed", "idle", "isfractionalzoomenabled_changed", "mapcapabilities_changed", "maptypeid_changed", "mousemove", "mouseout", "mouseover", "projection_changed", "renderingtype_changed", "tilesloaded", "tilt_changed", "zoom_changed"],
  rendering: ["RASTER", "UNINITIALIZED", "VECTOR"],
};
const ALL = new Set(Object.values(REFERENCE).flat());
const GOOGLE_HINT = /LatLng|Pixel|Zoom|Bounds$|Bounds\b|Projection|Panes|Pane$|Overlay|Polyline|Rendering|RASTER|VECTOR|Center|Listener|preventMap|stroke|getMap|setMap|Path$|placeId|tilesloaded|gestureHandling|cameraControl|clickableIcons|keyboardShortcuts|mapId|backgroundColor|disableDefaultUI|minZoom|maxZoom|restriction/;
const NOT_GOOGLE = new Set(["getBoundingClientRect", "setPointerCapture", "releasePointerCapture", "preventDefault", "stopPropagation", "getAttribute", "setAttribute", "removeAttribute", "insertAdjacentHTML", "addEventListener", "removeEventListener"]);

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name}\n       ${String(err.message).split("\n").join("\n       ")}`);
  }
}

function page(query = "callback=ready") {
  const dom = new JSDOM(`<!doctype html><html><body><div id="m"></div><script src="https://site.test/__maps-mock.js?${query}"></script></body></html>`, { url: "https://site.test/book", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const box = w.document.getElementById("m");
  const size = { w: 256, h: 256 };
  Object.defineProperty(box, "clientWidth", { get: () => size.w });
  Object.defineProperty(box, "clientHeight", { get: () => size.h });
  box.getBoundingClientRect = () => ({ left: 0, top: 0, right: size.w, bottom: size.h, width: size.w, height: size.h, x: 0, y: 0 });
  w.calls = [];
  w.ready = () => w.calls.push("ready");
  Object.defineProperty(w.document, "currentScript", { configurable: true, get: () => w.document.querySelector("script") });
  w.eval(MOCK);
  return { w, box, size, tick: (ms = 0) => new Promise((r) => w.setTimeout(r, ms)) };
}
const pointer = (w, target, type, x, y, extra = {}) => {
  const e = new w.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra });
  Object.defineProperty(e, "pointerId", { value: 1 });
  Object.defineProperty(e, "pointerType", { value: extra.pointerType || "mouse" });
  target.dispatchEvent(e);
};

await test("map.js uses only names that the mock implements and that the Maps JavaScript API reference lists", () => {
  assert.equal(MAP_FILES.length, 1, MAP_FILES.join(", "));
  const code = MAP_JS.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  const props = [...new Set([...code.matchAll(/\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))];
  const google = props.filter((p) => GOOGLE_HINT.test(p) && !NOT_GOOGLE.has(p));
  assert.ok(google.length > 15, google.join(" "));
  assert.deepEqual(google.filter((p) => !ALL.has(p)), [], "not in the reference lists");
  const { w } = page();
  const gm = w.google.maps;
  const has = (p) => p in gm || [gm.Map, gm.OverlayView, gm.Polyline, gm.LatLng, gm.LatLngBounds, gm.MVCArray].some((c) => p in c.prototype || p in c) || p in gm.RenderingType || p in gm.event || REFERENCE.panes.includes(p) || REFERENCE.projection.includes(p) || REFERENCE.mouse.includes(p) || REFERENCE.polylineOptions.includes(p) || REFERENCE.mapOptions.includes(p) || REFERENCE.events.includes(p);
  assert.deepEqual(google.filter((p) => !has(p)), [], "not in the mock");
  const options = REFERENCE.mapOptions.filter((o) => new RegExp(`[{,]${o}:`).test(MAP_JS));
  for (const o of ["center", "zoom", "minZoom", "maxZoom", "renderingType", "backgroundColor", "disableDefaultUI", "cameraControl", "gestureHandling", "restriction"]) assert.ok(options.includes(o), o);
  const box = w.document.getElementById("m");
  assert.doesNotThrow(() => new gm.Map(box, Object.fromEntries(options.filter((o) => o !== "mapId").map((o) => [o, o === "center" ? { lat: 40.7, lng: -74 } : o === "restriction" ? { latLngBounds: { north: 42, south: 39, west: -76, east: -71 } } : o === "styles" ? [] : o === "gestureHandling" ? "cooperative" : o === "renderingType" ? "RASTER" : o === "backgroundColor" ? "#fff" : /Zoom|zoom/.test(o) ? 10 : true]))));
  assert.throws(() => new gm.Map(box, { styles: [], mapId: "x" }), /styles and mapId/);
  assert.throws(() => new gm.Map(box, { tilt: 0 }), /not implemented/);
  const libs = [...MAP_JS.matchAll(/importLibrary\(([^)]*)\)/g)].map((m) => m[1]);
  assert.ok(libs.length > 0);
  assert.ok(/\["core","maps"\]/.test(MAP_JS), "map.js imports core and maps");
});

await test("the mock loads like the API: callback after load, importLibrary for core and maps only, the version, and the names of the reference", async () => {
  const { w, tick } = page();
  await tick(5);
  assert.deepEqual(w.calls, ["ready"]);
  assert.equal(w.google.maps.version, "mock");
  const core = await w.google.maps.importLibrary("core");
  const maps = await w.google.maps.importLibrary("maps");
  for (const k of Object.keys(core)) assert.ok(REFERENCE.core.includes(k), k);
  for (const k of Object.keys(maps)) assert.ok(REFERENCE.maps.includes(k), k);
  await assert.rejects(w.google.maps.importLibrary("marker"), /mock: library marker is not implemented/);
  assert.deepEqual({ ...maps.RenderingType }, { RASTER: "RASTER", VECTOR: "VECTOR", UNINITIALIZED: "UNINITIALIZED" });
});

await test("projection: div pixels round trip, zoom 0 puts 0,0 in the middle of a 256 box, fitBounds with padding keeps every point inside", async () => {
  const { w, box } = page();
  const gm = w.google.maps;
  const map = new gm.Map(box, { center: { lat: 0, lng: 0 }, zoom: 0 });
  const ov = new gm.OverlayView();
  ov.onAdd = ov.draw = ov.onRemove = () => 0;
  ov.setMap(map);
  assert.equal(ov.getProjection(), null, "onAdd and the projection come after setMap, like the API");
  await new Promise((r) => w.setTimeout(r, 5));
  const pr = ov.getProjection();
  const c = pr.fromLatLngToContainerPixel(new gm.LatLng(0, 0));
  assert.deepEqual([c.x, c.y], [128, 128]);
  map.setZoom(12);
  for (const p of [[40.75, -73.98], [40.64, -73.78], [-33.86, 151.2]]) {
    const back = pr.fromDivPixelToLatLng(pr.fromLatLngToDivPixel(new gm.LatLng(...p)));
    assert.ok(Math.abs(back.lat() - p[0]) < 1e-6 && Math.abs(back.lng() - p[1]) < 1e-6, String(back));
  }
  const pts = [[40.741389, -73.987193], [40.714224, -73.961452], [40.644166, -73.782425]];
  const b = new gm.LatLngBounds();
  pts.forEach((p) => b.extend({ lat: p[0], lng: p[1] }));
  map.fitBounds(b, { top: 20, right: 20, bottom: 60, left: 20 });
  for (const p of pts) {
    const q = pr.fromLatLngToContainerPixel({ lat: p[0], lng: p[1] });
    assert.ok(q.x >= 20 && q.x <= 236 && q.y >= 20 && q.y <= 196, `${p} at ${q.x},${q.y} zoom ${map.getZoom()}`);
  }
  assert.ok(map.getZoom() >= 8 && Number.isInteger(map.getZoom()));
});

await test("events: click only after a press without movement, idle after setCenter, tilesloaded once, a stopped icon click opens no info window", async () => {
  const { w, box, tick } = page();
  const gm = w.google.maps;
  const map = new gm.Map(box, { center: { lat: 40.741389, lng: -73.987193 }, zoom: 15, gestureHandling: "cooperative", clickableIcons: true });
  await tick(0);
  const seen = [];
  for (const n of ["click", "idle", "tilesloaded", "dragstart", "dragend"]) map.addListener(n, (e) => seen.push(n + (e && e.placeId ? ":" + e.placeId : "")));
  await tick(80);
  const style = box.querySelector(".gm-style");
  pointer(w, style, "pointerdown", 10, 10);
  pointer(w, style, "pointermove", 40, 40);
  pointer(w, style, "pointerup", 40, 40);
  style.dispatchEvent(new w.MouseEvent("click", { bubbles: true, clientX: 40, clientY: 40 }));
  assert.ok(seen.includes("dragstart") && seen.includes("dragend"), seen.join());
  assert.ok(!seen.includes("click"), "a drag is not a click");
  seen.length = 0;
  pointer(w, style, "pointerdown", 30, 30);
  pointer(w, style, "pointerup", 30, 30);
  style.dispatchEvent(new w.MouseEvent("click", { bubbles: true, clientX: 30, clientY: 30 }));
  assert.ok(seen.includes("click"));
  map.setCenter({ lat: 40.741389, lng: -73.987193 });
  await tick(5);
  assert.ok(seen.includes("idle"));
  assert.equal(seen.filter((x) => x === "tilesloaded").length, 0, "tilesloaded fired once before");
  const icon = box.querySelector('[data-place-id="mock-edition"]');
  assert.ok(icon, "a place icon near the EDITION fixture");
  map.addListener("click", (e) => e.placeId && e.stop());
  pointer(w, icon, "pointerdown", 128, 128);
  pointer(w, icon, "pointerup", 128, 128);
  icon.dispatchEvent(new w.MouseEvent("click", { bubbles: true, clientX: 128, clientY: 128 }));
  assert.ok(seen.includes("click:mock-edition"), seen.join());
  assert.equal(box.querySelector(".gm-style-iw"), null);
  const keep = [];
  const before = map.getCenter().toJSON();
  box.querySelector("[role=region]").dispatchEvent(new w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.ok(map.getCenter().lng() > before.lng, "the arrow keys pan");
  keep.push(map.getZoom());
  box.querySelector("[role=region]").dispatchEvent(new w.KeyboardEvent("keydown", { key: "+", bubbles: true }));
  assert.equal(map.getZoom(), keep[0] + 1);
});

await test("the map box carries the region, the logo, the terms and the camera control, and fail=auth calls gm_authFailure and shows the error", async () => {
  const { w, box, tick } = page("callback=ready&fail=auth");
  w.gm_authFailure = () => w.calls.push("auth");
  const map = new w.google.maps.Map(box, { center: { lat: 40.7, lng: -74 }, zoom: 11 });
  assert.equal(box.querySelector("[role=region]"), null, "like the API, the map builds its DOM after the constructor returns");
  await tick(0);
  const region = box.querySelector("[role=region]");
  assert.deepEqual([region.getAttribute("tabindex"), region.getAttribute("aria-label"), region.getAttribute("aria-roledescription")], ["0", "Map", "map"]);
  assert.ok(box.querySelector('a[title="Open this area in Google Maps (opens a new window)"] img[alt="Google"]'));
  assert.ok(box.querySelector('button[aria-label="Map camera controls"]'));
  assert.ok(/Map data ©\d{4} Google/.test(box.textContent) && /Terms/.test(box.textContent));
  await tick(60);
  assert.ok(w.calls.includes("auth"));
  assert.equal(w.__gmock.failed, true);
  assert.ok(/Oops! Something went wrong\./.test(box.textContent));
  assert.ok(map);
});

await test("the fixture holds no Google key prefix and no shipped file points at it", () => {
  assert.equal(MOCK.includes(["AI", "za"].join("")), false);
  const shipped = readdirSync(join(ROOT, "assets")).filter((f) => /\.(js|css|html)$/.test(f)).map((f) => readFileSync(join(ROOT, "assets", f), "utf8"));
  assert.deepEqual(shipped.filter((t) => t.includes("gmaps-mock") || t.includes("__maps-mock")).length, 0);
});

if (failures) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll google.maps mock tests passed");
process.exit(0);
