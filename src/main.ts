import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, message, open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, type Column, type Profile, type Source, type Table, type TagInfo, KNOWN_TAGS } from "./api";

type FileResult =
  | { ok: true; input: string; output: string; rows: number; skipped: number; missing: number }
  | { ok: false; input: string; error: string };

const state = {
  view: "main" as "main" | "editor",
  profiles: [] as Profile[],
  currentId: localStorage.getItem("profile") ?? "mpx",
  busy: false,
  lastFiles: [] as string[],
  results: [] as FileResult[],
  unused: [] as TagInfo[],
  // editor
  draft: null as Profile | null,
  dirty: false,
  previewFile: null as string | null,
  xmlTags: new Map<string, string>(),
};

const app = document.querySelector<HTMLDivElement>("#app")!;

// ---------- pomocné ----------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const dirName = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));
const isXml = (p: string) => p.toLowerCase().endsWith(".xml");
const clone = <T>(v: T): T => structuredClone(v);
const errText = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e));

const current = () => state.profiles.find((p) => p.id === state.currentId) ?? state.profiles[0];

function setCurrent(id: string) {
  state.currentId = id;
  localStorage.setItem("profile", id);
}

function dismissedTags(p: Profile): string[] {
  return JSON.parse(localStorage.getItem(`ignored:${p.id}`) ?? "[]");
}

let toastTimer = 0;
function toast(text: string) {
  const el = document.querySelector<HTMLDivElement>("#toast")!;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2500);
}

async function loadProfiles() {
  state.profiles = await api.listProfiles();
  if (!state.profiles.some((p) => p.id === state.currentId)) setCurrent("mpx");
}

const icons = {
  gear: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  file: `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="m9 15 3-3 3 3"/></svg>`,
  ok: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
  err: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>`,
};

// ---------- hlavná obrazovka ----------

function renderMain() {
  const p = current();
  const options = state.profiles
    .map((x) => `<option value="${esc(x.id)}" ${x.id === p.id ? "selected" : ""}>${esc(x.name)}</option>`)
    .join("");

  const results = state.results
    .map((r) =>
      r.ok
        ? `<li class="result ok">
            <span class="badge">${icons.ok}</span>
            <div class="result-body">
              <div class="result-title"><b>${esc(fileName(r.input))}</b> → ${esc(fileName(r.output))}</div>
              <div class="muted">${r.rows} riadkov · ${r.skipped} bodov preskočených${
                r.missing ? ` · <span class="warn-text">${r.missing} chýbajúcich hodnôt</span>` : ""
              }</div>
            </div>
            <button class="ghost small" data-reveal="${esc(r.output)}">Zobraziť v priečinku</button>
          </li>`
        : `<li class="result err">
            <span class="badge">${icons.err}</span>
            <div class="result-body">
              <div class="result-title"><b>${esc(fileName(r.input))}</b></div>
              <div class="muted">${esc(r.error)}</div>
            </div>
          </li>`,
    )
    .join("");

  const notice = state.unused.length
    ? `<div class="notice">
        <span class="notice-icon">${icons.info}</span>
        <div class="notice-body">V súbore sú aj veličiny, ktoré sa do CSV nezapisujú:
          <b>${state.unused.map((t) => esc(KNOWN_TAGS[t.tag]?.label ?? t.tag)).join(", ")}</b></div>
        <button class="primary small" id="add-unused">Pridať do CSV</button>
        <button class="ghost small" id="ignore-unused">Ignorovať</button>
      </div>`
    : "";

  app.innerHTML = `
    <header class="bar">
      <div class="brand">XML <span>→</span> CSV</div>
      <div class="spacer"></div>
      <label class="profile-select">
        <span class="muted">Profil</span>
        <select id="profile">${options}</select>
      </label>
      <button class="icon" id="open-editor" title="Upraviť profil">${icons.gear}</button>
    </header>
    <main class="main">
      <button id="drop" class="drop ${state.busy ? "busy" : ""}" ${state.busy ? "disabled" : ""}>
        ${
          state.busy
            ? `<div class="spinner"></div><div class="drop-title">Konvertujem…</div>`
            : `<div class="drop-icon">${icons.file}</div>
               <div class="drop-title">Pretiahni sem XML súbory</div>
               <div class="drop-sub">alebo klikni a vyber</div>`
        }
      </button>
      ${notice}
      ${
        state.results.length
          ? `<div class="results-head">
               <span class="muted">Výsledok</span>
               <button class="link" id="again">Konvertovať znova</button>
             </div>
             <ul class="results">${results}</ul>`
          : ""
      }
    </main>
    <footer class="foot muted" id="version"></footer>`;

  getVersion().then((v) => {
    const el = document.querySelector("#version");
    if (el) el.textContent = `v${v}`;
  });

  document.querySelector<HTMLSelectElement>("#profile")!.onchange = (e) => {
    setCurrent((e.target as HTMLSelectElement).value);
    state.unused = [];
    render();
  };
  document.querySelector<HTMLButtonElement>("#open-editor")!.onclick = () => openEditor(current());
  document.querySelector<HTMLButtonElement>("#drop")!.onclick = pickFiles;
  document.querySelector<HTMLButtonElement>("#again")?.addEventListener("click", () => convertFiles(state.lastFiles));
  document.querySelector<HTMLButtonElement>("#add-unused")?.addEventListener("click", addUnusedColumns);
  document.querySelector<HTMLButtonElement>("#ignore-unused")?.addEventListener("click", ignoreUnused);
  app.querySelectorAll<HTMLButtonElement>("[data-reveal]").forEach((b) => {
    b.onclick = () => revealItemInDir(b.dataset.reveal!).catch((e) => message(errText(e), { kind: "error" }));
  });
}

async function pickFiles() {
  const picked = await open({ multiple: true, filters: [{ name: "XML", extensions: ["xml", "XML"] }] });
  if (picked?.length) await convertFiles(picked);
}

async function convertFiles(paths: string[]) {
  if (!paths.length || state.busy) return;
  const profile = current();

  // Kam uložiť: pri jednom súbore sa pýtame na názov, pri viacerých na priečinok.
  let outputs: string[];
  if (paths.length === 1) {
    const out = await save({
      defaultPath: await api.outputPath(paths[0], profile),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (!out) return;
    outputs = [out];
  } else {
    const dir = await open({ directory: true, defaultPath: dirName(paths[0]), title: "Kam uložiť CSV súbory?" });
    if (!dir) return;
    outputs = await Promise.all(paths.map((p) => api.outputPath(p, profile, dir)));

    // Pri jednom súbore sa na prepísanie pýta systémový dialóg, tu to musíme spraviť sami.
    const existing = await api.existingFiles(outputs);
    if (existing.length) {
      const shown = existing.slice(0, 8).map((p) => `• ${fileName(p)}`);
      if (existing.length > shown.length) shown.push(`… a ďalšie (${existing.length - shown.length})`);
      const overwrite = await ask(
        `${existing.length === 1 ? "Tento súbor už existuje" : "Tieto súbory už existujú"}:\n\n${shown.join("\n")}\n\nPrepísať?`,
        { title: "Súbory už existujú", kind: "warning", okLabel: "Prepísať", cancelLabel: "Zrušiť" },
      );
      if (!overwrite) return;
    }
  }

  state.busy = true;
  state.lastFiles = paths;
  render();

  const results: FileResult[] = [];
  const unused = new Map<string, TagInfo>();
  for (const [i, input] of paths.entries()) {
    try {
      const r = await api.convert(input, outputs[i], profile);
      results.push({ ok: true, input, output: r.output, rows: r.rows, skipped: r.skipped, missing: r.missing });
      r.unusedTags.forEach((t) => unused.set(t.tag, t));
    } catch (e) {
      results.push({ ok: false, input, error: errText(e) });
    }
  }

  const dismissed = dismissedTags(profile);
  state.results = results;
  state.unused = [...unused.values()].filter((t) => !dismissed.includes(t.tag));
  state.busy = false;
  render();
}

function newMeasureColumn(t: TagInfo): Column {
  return { name: KNOWN_TAGS[t.tag]?.label ?? t.tag, unit: t.units, source: { type: "measure", tag: t.tag }, triple: true };
}

function addUnusedColumns() {
  const draft = clone(current());
  // Nové stĺpce pred GPS, ak profil GPS stĺpce má, inak na koniec.
  const gps = draft.columns.findIndex((c) => c.name.startsWith("GPS"));
  const at = gps === -1 ? draft.columns.length : gps;
  draft.columns.splice(at, 0, ...state.unused.map(newMeasureColumn));
  openEditor(current(), draft);
}

async function ignoreUnused() {
  const p = current();
  const tags = state.unused.map((t) => t.tag);
  if (p.builtin) {
    localStorage.setItem(`ignored:${p.id}`, JSON.stringify([...dismissedTags(p), ...tags]));
  } else {
    p.ignoredTags = [...p.ignoredTags, ...tags];
    await api.saveProfile(p);
  }
  state.unused = [];
  render();
}

// ---------- editor profilu ----------

function openEditor(profile: Profile, draft?: Profile) {
  state.view = "editor";
  state.draft = draft ?? clone(profile);
  state.dirty = !!draft;
  if (!state.previewFile && state.lastFiles.length) state.previewFile = state.lastFiles[0];
  render();
  if (state.previewFile) loadPreviewFile(state.previewFile);
}

async function closeEditor() {
  if (state.dirty && !(await ask("Zahodiť neuložené zmeny v profile?", { kind: "warning", okLabel: "Zahodiť", cancelLabel: "Zostať" })))
    return;
  state.view = "main";
  state.draft = null;
  render();
}

function sourceKey(s: Source) {
  return s.type === "measure" ? `m:${s.tag}` : s.type;
}

function tagOptions(): string[] {
  const tags = new Set([...Object.keys(KNOWN_TAGS), ...state.xmlTags.keys()]);
  state.draft!.columns.forEach((c) => c.source.type === "measure" && tags.add(c.source.tag));
  return [...tags];
}

function renderColumnRow(c: Column, i: number, total: number, tags: string[]) {
  const key = sourceKey(c.source);
  const opt = (v: string, label: string) => `<option value="${esc(v)}" ${v === key ? "selected" : ""}>${esc(label)}</option>`;
  const measureOpts = tags
    .map((t) => {
      const known = KNOWN_TAGS[t];
      return opt(`m:${t}`, known ? `${known.label} (${t})` : t);
    })
    .join("");

  let transform = `<span class="muted">—</span>`;
  if (c.source.type === "measure") {
    transform = `<span class="tf">
        <span class="muted">×</span><input class="num" data-f="multiply" type="number" step="any" value="${c.multiply ?? 1}">
        <span class="muted">+</span><input class="num" data-f="offset" type="number" step="any" value="${c.offset ?? 0}">
      </span>`;
  } else if (c.source.type === "constant") {
    transform = `<input class="const" data-f="value" placeholder="hodnota" value="${esc(c.source.value)}">`;
  }

  return `<tr data-i="${i}">
    <td class="move">
      <button class="icon tiny" data-act="up" ${i === 0 ? "disabled" : ""} title="Posunúť hore">↑</button>
      <button class="icon tiny" data-act="down" ${i === total - 1 ? "disabled" : ""} title="Posunúť dole">↓</button>
    </td>
    <td><select data-f="source">
      ${opt("date", "Dátum")}${opt("time", "Čas")}${opt("constant", "Pevná hodnota")}
      <optgroup label="Veličiny z XML">${measureOpts}</optgroup>
    </select></td>
    <td><input data-f="name" value="${esc(c.name)}"></td>
    <td><input class="unit" data-f="unit" value="${esc(c.unit)}"></td>
    <td>${transform}</td>
    <td class="center"><input type="checkbox" data-f="triple" ${c.triple ? "checked" : ""} title="Zapísať ako Min / Average / Max"></td>
    <td><button class="icon tiny danger" data-act="del" title="Odstrániť stĺpec">✕</button></td>
  </tr>`;
}

function renderColumns() {
  const d = state.draft!;
  const tags = tagOptions();
  document.querySelector("#cols")!.innerHTML = d.columns.map((c, i) => renderColumnRow(c, i, d.columns.length, tags)).join("");
}

function renderEditor() {
  const d = state.draft!;
  app.innerHTML = `
    <header class="bar">
      <button class="ghost" id="back">← Späť</button>
      <input id="p-name" class="title-input" value="${esc(d.name)}" placeholder="Názov profilu">
      <div class="spacer"></div>
      <button class="primary" id="save">${d.builtin ? "Uložiť ako nový profil" : "Uložiť"}</button>
    </header>
    <main class="editor">
      ${
        d.builtin
          ? `<div class="notice subtle"><span class="notice-icon">${icons.info}</span>
              <div class="notice-body">Vstavaný profil sa nedá prepísať — zmeny sa uložia ako nový profil.</div></div>`
          : ""
      }
      <section class="card settings">
        <label>Preskočiť prvých <input id="p-skip" class="num" type="number" min="0" value="${d.skip}"> meracích bodov</label>
        <label>Názov súboru <input id="p-file" value="${esc(d.fileName)}"> <span class="muted">{nazov} = názov XML súboru</span></label>
      </section>

      <section class="card">
        <div class="section-head">Stĺpce v CSV</div>
        <table class="cols">
          <thead><tr>
            <th></th><th>Zdroj</th><th>Názov v CSV</th><th>Jednotka</th><th>Prevod / hodnota</th>
            <th class="center" title="Zapísať ako Min / Average / Max">Min/Avg/Max</th><th></th>
          </tr></thead>
          <tbody id="cols"></tbody>
        </table>
        <button class="ghost small add" id="add-col">+ Pridať stĺpec</button>
      </section>

      <section class="card">
        <div class="section-head">Náhľad <span class="muted" id="preview-file"></span></div>
        <div class="preview" id="preview"></div>
      </section>

      <section class="actions">
        <button class="ghost small" id="import">Importovať profil</button>
        <button class="ghost small" id="export">Exportovať profil</button>
        <div class="spacer"></div>
        <button class="ghost small" id="reset">Zahodiť zmeny</button>
        ${d.builtin ? "" : `<button class="ghost small danger" id="delete">Zmazať profil</button>`}
      </section>
    </main>`;

  renderColumns();
  renderPreview();

  const markDirty = () => {
    state.dirty = true;
    schedulePreview();
  };

  document.querySelector<HTMLButtonElement>("#back")!.onclick = closeEditor;
  document.querySelector<HTMLButtonElement>("#save")!.onclick = saveDraft;
  document.querySelector<HTMLInputElement>("#p-name")!.oninput = (e) => {
    d.name = (e.target as HTMLInputElement).value;
    state.dirty = true;
  };
  document.querySelector<HTMLInputElement>("#p-skip")!.oninput = (e) => {
    d.skip = Math.max(0, parseInt((e.target as HTMLInputElement).value) || 0);
    markDirty();
  };
  document.querySelector<HTMLInputElement>("#p-file")!.oninput = (e) => {
    d.fileName = (e.target as HTMLInputElement).value;
    state.dirty = true;
  };
  document.querySelector<HTMLButtonElement>("#add-col")!.onclick = () => {
    d.columns.push({ name: "", unit: "", source: { type: "constant", value: "" }, triple: true });
    state.dirty = true;
    renderColumns();
    document.querySelector<HTMLSelectElement>(`#cols tr:last-child select`)?.focus();
  };
  document.querySelector<HTMLButtonElement>("#import")!.onclick = importProfile;
  document.querySelector<HTMLButtonElement>("#export")!.onclick = exportProfile;
  document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => {
    const saved = state.profiles.find((p) => p.id === d.id) ?? current();
    state.draft = clone(saved);
    state.dirty = false;
    render();
  };
  document.querySelector<HTMLButtonElement>("#delete")?.addEventListener("click", deleteDraft);

  const tbody = document.querySelector<HTMLTableSectionElement>("#cols")!;
  tbody.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement;
    const c = d.columns[Number(el.closest("tr")!.dataset.i)];
    switch (el.dataset.f) {
      case "name":
        c.name = el.value;
        break;
      case "unit":
        c.unit = el.value;
        break;
      case "multiply":
        c.multiply = el.value === "" ? 1 : Number(el.value);
        break;
      case "offset":
        c.offset = el.value === "" ? 0 : Number(el.value);
        break;
      case "value":
        if (c.source.type === "constant") c.source.value = el.value;
        break;
      case "triple":
        c.triple = el.checked;
        break;
      default:
        return;
    }
    markDirty();
  });
  tbody.addEventListener("change", (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.f !== "source") return;
    const c = d.columns[Number(el.closest("tr")!.dataset.i)];
    const v = el.value;
    if (v.startsWith("m:")) {
      const tag = v.slice(2);
      const prevTag = c.source.type === "measure" ? c.source.tag : null;
      // Predvyplň názov a jednotku, ak ich používateľ ešte nezmenil.
      const prevLabel = prevTag ? (KNOWN_TAGS[prevTag]?.label ?? prevTag) : "";
      if (!c.name || c.name === prevLabel) c.name = KNOWN_TAGS[tag]?.label ?? tag;
      if (!c.unit) c.unit = state.xmlTags.get(tag) ?? KNOWN_TAGS[tag]?.units ?? "";
      c.source = { type: "measure", tag };
    } else if (v === "constant") {
      c.source = { type: "constant", value: "" };
    } else {
      c.source = { type: v as "date" | "time" };
      if (!c.name) c.name = v === "date" ? "Dátum" : "Čas";
      c.triple = false;
    }
    if (c.source.type !== "measure") {
      delete c.multiply;
      delete c.offset;
    }
    markDirty();
    renderColumns();
  });
  tbody.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    if (!btn) return;
    const i = Number(btn.closest("tr")!.dataset.i);
    const cols = d.columns;
    if (btn.dataset.act === "del") cols.splice(i, 1);
    if (btn.dataset.act === "up" && i > 0) [cols[i - 1], cols[i]] = [cols[i], cols[i - 1]];
    if (btn.dataset.act === "down" && i < cols.length - 1) [cols[i + 1], cols[i]] = [cols[i], cols[i + 1]];
    markDirty();
    renderColumns();
  });
}

// ----- náhľad -----

let previewTable: Table | null = null;
let previewError: string | null = null;
let previewTimer = 0;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(refreshPreview, 250);
}

async function loadPreviewFile(path: string) {
  state.previewFile = path;
  try {
    const info = await api.inspectXml(path);
    state.xmlTags = new Map(info.tags.map((t) => [t.tag, t.units]));
    if (state.view === "editor") renderColumns();
  } catch {
    state.xmlTags = new Map();
  }
  await refreshPreview();
}

async function refreshPreview() {
  if (!state.previewFile || !state.draft) return renderPreview();
  try {
    previewTable = await api.preview(state.previewFile, state.draft, 3);
    previewError = null;
  } catch (e) {
    previewTable = null;
    previewError = errText(e);
  }
  renderPreview();
}

function renderPreview() {
  const box = document.querySelector("#preview");
  if (!box) return;
  document.querySelector("#preview-file")!.textContent = state.previewFile ? fileName(state.previewFile) : "";
  if (!state.previewFile) {
    box.innerHTML = `<div class="preview-empty muted">Pretiahni sem XML súbor a uvidíš, ako bude CSV vyzerať.</div>`;
    return;
  }
  if (previewError) {
    box.innerHTML = `<div class="preview-empty err-text">${esc(previewError)}</div>`;
    return;
  }
  if (!previewTable) return;
  const t = previewTable;
  const tr = (cells: string[], cls = "") => `<tr class="${cls}">${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`;
  box.innerHTML = `<table>
      <thead>${tr(t.header)}</thead>
      <tbody>${tr(t.units, "units")}${t.rows.map((r) => tr(r)).join("")}</tbody>
    </table>
    <div class="muted preview-meta">${t.header.length} stĺpcov · prvé ${t.rows.length} riadky z ${t.totalPoints - t.skipped}</div>`;
}

// ----- akcie editora -----

async function saveDraft() {
  const d = state.draft!;
  // Kópia vstavaného profilu nesmie mať rovnaký názov ako originál.
  if (d.builtin && state.profiles.some((p) => p.builtin && p.name === d.name.trim())) {
    d.name = `${d.name.trim()} (upravený)`;
  }
  try {
    const saved = await api.saveProfile(d);
    await loadProfiles();
    setCurrent(saved.id);
    state.view = "main";
    state.draft = null;
    state.dirty = false;
    state.unused = [];
    render();
    toast(`Profil „${saved.name}“ uložený.`);
  } catch (e) {
    await message(errText(e), { title: "Profil sa nedá uložiť", kind: "error" });
  }
}

async function deleteDraft() {
  const d = state.draft!;
  if (!(await ask(`Naozaj zmazať profil „${d.name}“?`, { kind: "warning", okLabel: "Zmazať", cancelLabel: "Nie" }))) return;
  try {
    await api.deleteProfile(d.id);
    await loadProfiles();
    setCurrent("mpx");
    state.view = "main";
    state.draft = null;
    state.dirty = false;
    render();
    toast("Profil zmazaný.");
  } catch (e) {
    await message(errText(e), { kind: "error" });
  }
}

async function exportProfile() {
  const d = state.draft!;
  const path = await save({ defaultPath: `${d.name}.json`, filters: [{ name: "Profil", extensions: ["json"] }] });
  if (!path) return;
  try {
    await api.exportProfile(d, path);
    toast("Profil exportovaný.");
  } catch (e) {
    await message(errText(e), { title: "Export zlyhal", kind: "error" });
  }
}

async function importProfile() {
  if (state.dirty && !(await ask("Zahodiť neuložené zmeny v profile?", { kind: "warning", okLabel: "Zahodiť", cancelLabel: "Zostať" })))
    return;
  const path = await open({ filters: [{ name: "Profil", extensions: ["json"] }] });
  if (!path) return;
  try {
    const p = await api.importProfile(path);
    await loadProfiles();
    setCurrent(p.id);
    openEditor(p);
    toast(`Profil „${p.name}“ importovaný.`);
  } catch (e) {
    await message(errText(e), { title: "Import zlyhal", kind: "error" });
  }
}

// ---------- spoločné ----------

function render() {
  if (state.view === "editor") renderEditor();
  else renderMain();
}

async function setupDragDrop() {
  await getCurrentWebview().onDragDropEvent(async (e) => {
    const drop = document.querySelector("#drop") ?? document.querySelector("#preview");
    if (e.payload.type === "enter" || e.payload.type === "over") {
      drop?.classList.add("dragging");
    } else if (e.payload.type === "leave") {
      drop?.classList.remove("dragging");
    } else if (e.payload.type === "drop") {
      drop?.classList.remove("dragging");
      const xml = e.payload.paths.filter(isXml);
      if (!xml.length) {
        toast("Podporované sú iba XML súbory.");
        return;
      }
      if (state.view === "editor") await loadPreviewFile(xml[0]);
      else await convertFiles(xml);
    }
  });
}

async function init() {
  try {
    await loadProfiles();
  } catch (e) {
    await message(errText(e), { title: "Profily sa nedajú načítať", kind: "error" });
    state.profiles = [];
  }
  render();
  await setupDragDrop();
}

init();
