/**
 * Builds a local review viewer: out/review/index.html + out/review/data.js.
 * Open index.html directly in a browser (works from file://). Keep it local: it contains book text.
 *
 * Usage: node build-review.mjs
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { txt } from "./parse-powers.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const parsed = JSON.parse(await readFile(path.join(root, "out", "parsed", "power.json"), "utf8"));

/** Drop nulls, false, empty strings and empty arrays/objects to keep the data file small. */
const slim = (key, value) => {
	if (key === "raw") return undefined;
	if (value === null || value === false || value === "") return undefined;
	if (Array.isArray(value) && !value.length) return undefined;
	return value;
};

const records = parsed.map(p => {
	const orig = p.raw ? txt(p.raw.replace(/<\/h1>/gi, "<br>")) : "";
	return JSON.parse(JSON.stringify({ ...p, orig }, slim));
});

const outDir = path.join(root, "out", "review");
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "data.js"), `window.POWERS = ${JSON.stringify(records)};\n`);
await writeFile(path.join(outDir, "index.html"), HTML());
console.log(`Review viewer: ${path.join(outDir, "index.html")}  (${records.length} powers)`);

function HTML() {
	return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Review dos powers</title>
<style>
:root{--bg:#fafaf8;--fg:#1d1d1b;--mut:#6b6b66;--card:#fff;--line:#dcdcd4;--ok:#2d7a46;--warn:#b25b00;--chip:#eef1f6;--acc:#3556a8}
@media (prefers-color-scheme:dark){:root{--bg:#161616;--fg:#e8e8e2;--mut:#9a9a92;--card:#1e1e1e;--line:#33332f;--ok:#5fc182;--warn:#e09a4d;--chip:#262b36;--acc:#8ea8ee}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;z-index:2;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
input,select{font:inherit;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--card);color:var(--fg)}
input[type=search]{flex:1;min-width:180px}
main{display:grid;grid-template-columns:320px 1fr;min-height:calc(100vh - 56px)}
#list{border-right:1px solid var(--line);overflow:auto;max-height:calc(100vh - 56px)}
#list div{padding:6px 12px;border-bottom:1px solid var(--line);cursor:pointer;display:flex;justify-content:space-between;gap:8px}
#list div:hover,#list div.sel{background:var(--chip)}
#list small{color:var(--mut);white-space:nowrap}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--ok)}.dot.p{background:var(--warn)}
#view{padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px;align-content:start}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px}
h2{margin:0 0 8px;font-size:15px}h3{margin:12px 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut)}
pre{white-space:pre-wrap;margin:0;font:13px/1.5 inherit}
.row{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0}
.chip{background:var(--chip);border-radius:5px;padding:1px 7px;font-size:12px}.chip b{color:var(--acc)}
.warn{color:var(--warn)}.kv{margin:3px 0}.kv>span:first-child{color:var(--mut);display:inline-block;min-width:92px}
.child{border-left:3px solid var(--line);padding-left:10px;margin-top:10px}
@media (max-width:900px){main{grid-template-columns:1fr}#list{max-height:35vh;border-right:0}#view{grid-template-columns:1fr}}
</style></head><body>
<header>
<input id="q" type="search" placeholder="Buscar por nome, classe ou texto (ex.: Prismatic, Warlock)…">
<select id="fq"><option value="">Qualidade: todas</option><option value="partial">Só parciais</option><option value="full">Só sem pendências</option></select>
<select id="ff"><option value="">Recursos: todos</option><option value="children">Com filhos</option><option value="secondary">Com ataque secundário</option><option value="scaling">Com escala por nível</option><option value="variants">Hit por defesa</option><option value="extra">Com blocos extras</option><option value="differ">Keywords divergentes</option><option value="ongoing">Com ongoing</option></select>
<span id="count" style="color:var(--mut)"></span>
</header>
<main><div id="list"></div><div id="view"><div class="card">Selecione um poder na lista. Esquerda: texto original. Direita: o que o parser extraiu.</div></div></main>
<script src="data.js"></script>
<script>
const P = window.POWERS, $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
const chip = (k, v) => '<span class="chip"><b>' + esc(k) + '</b> ' + esc(v) + '</span>';
const dmg = d => (d.expr + (d.types?.length ? " [" + d.types.join("/") + "]" : d.typesFromKeywords ? " [pelo keyword: " + d.typesFromKeywords.join("/") + (d.typesAmbiguous ? "?" : "") + "]" : d.typesFromBase ? " [= dano base]" : " [sem tipo]") + (d.when ? " (" + d.when + ")" : "") + (d.inferred ? " (dados inferidos)" : "") + (d.extra ? " (extra)" : "") + (d.equalTo ? " (igual a…)" : ""));
function chips(b) {
  if (!b) return "";
  const out = [];
  (b.damage || []).forEach(d => out.push(chip("dano", dmg(d))));
  (b.ongoing || []).forEach(o => out.push(chip("ongoing", o.amount ?? o.expr) + (o.types?.length ? "" : "") + chip("tipo", (o.types || []).join("/") || "—") + (o.saveEnds ? chip("", "save ends") : "")));
  (b.conditions || []).forEach(c => out.push(chip(c.kind === "effect" ? "efeito" : "condição", c.name + (c.duration ? " · " + c.duration.type + (c.duration.owner ? ":" + c.duration.owner + (c.duration.who ? "(" + c.duration.who + ")" : "") : "") + (c.duration.group ? " " + c.duration.group : "") : ""))));
  (b.resistances || []).forEach(r => out.push(chip(r.kind, (r.amount ?? "?") + " · " + r.types.join("/"))));
  (b.movement || []).forEach(m => out.push(chip(m.type, m.squares + " sq")));
  return out.length ? '<div class="row">' + out.join("") + "</div>" : "";
}
function block(label, b) {
  if (!b) return "";
  return "<h3>" + label + (b.half ? " · metade do dano" : "") + "</h3><pre>" + esc(b.text) + "</pre>" + chips(b);
}
function section(p, isChild) {
  const r = p.range;
  let h = "";
  if (!isChild) h += '<div class="kv"><span>Classe/nível</span>' + esc(p.class) + " · " + esc(p.kind) + (p.racial ? " (racial)" : "") + " · nível " + esc(p.level ?? "—") + (p.tier ? " (" + p.tier + ")" : "") + "</div>";
  h += '<div class="kv"><span>Uso/ação</span>' + esc(p.usage || "?") + (p.special ? " (special)" : "") + " · " + esc(p.action || "?") + "</div>";
  h += '<div class="kv"><span>Range</span>' + (r ? esc(r.type || "??") + (r.size != null ? " " + r.size : "") + (r.within != null ? " within " + r.within : "") + (r.weaponType ? " [" + r.weaponType + "]" : "") + (r.origin ? " origem:" + r.origin : "") + ' <span style="color:var(--mut)">← "' + esc(r.raw) + '"</span>' : "—") + "</div>";
  h += '<div class="kv"><span>Keywords</span>' + esc((p.keywords || []).join(", ")) + (p.keywordsDiffer ? ' <span class="warn">· listagem: ' + esc((p.keywordsListing || []).join(", ")) + "</span>" : "") + "</div>";
  if (p.target) h += '<div class="kv"><span>Target</span>' + esc(p.target) + "</div>";
  const a = p.attack;
  if (a) h += '<div class="kv"><span>Ataque</span>' + (a.parsed ? esc((a.abilities || []).join(" ou ")) + (a.bonus != null ? " +" + a.bonus : "") + " vs " + esc((a.defences || []).join(", ")) + (a.multipleDefences ? " (várias defesas)" : "") : '<span class="warn">NÃO RECONHECIDO:</span> ' + esc(a.text)) + "</div>";
  if (a?.alternatives) h += '<div class="kv"><span>Melee/ranged</span><span class="warn">gera 2 itens:</span> ' + a.alternatives.map(x => esc(x.when) + ": " + esc(x.abilities.join(" ou ")) + (x.bonus != null ? " +" + x.bonus : "") + " vs " + esc(x.defences.join(", "))).join(" · ") + "</div>";
  ["trigger", "requirement", "prerequisite", "special_text"].forEach(k => { if (p[k]) h += '<div class="kv"><span>' + k.replace("_text", "") + "</span>" + esc(p[k]) + "</div>"; });
  h += block("Hit", p.hit);
  (p.hitVariants || []).forEach(v => h += block("Hit (" + v.label + ")", v));
  h += block("Miss", p.miss) + block("Effect", p.effect);
  if (p.aftereffect) h += block("Aftereffect", p.aftereffect);
  if (p.sustain) h += "<h3>Sustain " + esc(p.sustain.action || "") + "</h3><pre>" + esc(p.sustain.text) + "</pre>";
  const s = p.secondary;
  if (s) {
    h += "<h3>Ataque secundário</h3>";
    if (s.target) h += '<div class="kv"><span>Target</span>' + esc(s.target) + "</div>";
    if (s.attack) h += '<div class="kv"><span>Ataque</span>' + (s.attack.parsed ? esc((s.attack.abilities || []).join(" ou ")) + " vs " + esc((s.attack.defences || []).join(", ")) : '<span class="warn">NÃO RECONHECIDO:</span> ' + esc(s.attack.text)) + "</div>";
    h += block("Hit (sec.)", s.hit) + block("Miss (sec.)", s.miss) + block("Effect (sec.)", s.effect);
  }
  if ((p.scaling || []).length) h += "<h3>Escala por nível</h3>" + p.scaling.map(x => chip("nível " + x.levels.join("/"), x.field) + " " + esc(x.text)).join("<br>");
  if ((p.extra || []).length) h += "<h3>Blocos extras</h3>" + p.extra.map(e => '<div class="kv"><span>' + esc(e.label) + "</span>" + esc(e.text) + "</div>").join("");
  return h;
}
function show(p) {
  const warns = (p.unparsed || []).length ? '<h3 class="warn">Alertas</h3><div class="warn">' + p.unparsed.map(esc).join("<br>") + "</div>" : "";
  const kids = (p.children || []).map(c => '<div class="child"><b>' + esc(c.name) + "</b>" + section(c, true) + "</div>").join("");
  const pub = p.published ? '<div class="kv"><span>Fonte</span>' + esc(p.published.raw) + "</div>" : "";
  $("#view").innerHTML = '<div class="card"><h2>Original · ' + esc(p.id) + "</h2><pre>" + esc(p.orig) + '</pre></div><div class="card"><h2>' + esc(p.name) + (p.quality === "full" ? ' <span class="chip">ok</span>' : ' <span class="chip warn">parcial</span>') + "</h2>" + section(p, false) + kids + pub + warns + "</div>";
}
let current = [];
function render() {
  const q = $("#q").value.toLowerCase().trim(), fq = $("#fq").value, ff = $("#ff").value;
  const f = {
    children: p => p.children, secondary: p => p.secondary, scaling: p => p.scaling, variants: p => p.hitVariants,
    extra: p => p.extra, differ: p => p.keywordsDiffer, ongoing: p => p.hit?.ongoing || p.effect?.ongoing,
  }[ff];
  current = P.filter(p => (!fq || p.quality === fq) && (!f || f(p)) && (!q || (p.name + " " + (p.class || "") + " " + p.orig).toLowerCase().includes(q)));
  $("#count").textContent = current.length + " poderes";
  $("#list").innerHTML = current.slice(0, 400).map((p, i) => '<div data-i="' + i + '"><span><span class="dot ' + (p.quality === "full" ? "" : "p") + '"></span>' + esc(p.name) + "</span><small>" + esc(p.class || "") + " " + esc(p.level ?? "") + "</small></div>").join("") + (current.length > 400 ? '<div style="color:var(--mut)">… refine a busca (' + (current.length - 400) + " ocultos)</div>" : "");
}
$("#list").addEventListener("click", e => {
  const d = e.target.closest("[data-i]"); if (!d) return;
  document.querySelectorAll("#list .sel").forEach(x => x.classList.remove("sel")); d.classList.add("sel");
  show(current[+d.dataset.i]);
});
["q", "fq", "ff"].forEach(id => $("#" + id).addEventListener("input", render));
render();
</script></body></html>`;
}
