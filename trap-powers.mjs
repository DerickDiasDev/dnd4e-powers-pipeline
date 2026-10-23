/**
 * The attacks of a trap or hazard as powers. A trap's text has them in two layouts:
 *
 *   - a block titled "Attack" (or "Secondary Attack"): a line with the action and the range ("Standard Action Melee",
 *     "Opportunity Action Close burst 1"), then labelled lines (Target, Attack, Hit, Miss, Effect...);
 *   - a block titled "Triggered Actions" / "Standard Actions"...: power headings as the monsters have them
 *     ("ᗕ Silver Fire (radiant) ✦ Daily"), each followed by its labelled lines.
 *
 * `extractPowers` takes those blocks out of the text and returns them in the shape the monsters' converter reads, so a trap's
 * attacks come out as the same `power` items. What is not part of a block (the prose around it) stays in the text.
 */
import { parseHeading } from "./item-powers.mjs";
import { readAttack } from "./parse-monsters.mjs";

/** "Attack", "Secondary Attack", "Attack 2", "Attack * Necrotic, Poison" (the star is the page's symbol; what follows are the keywords). */
const ATTACK_TITLE = /^(Secondary )?Attack(?:\s+(\d+))?(?:\s*[*✦]\s*(.+))?$/i;
/**
 * The other titles of an attack block, taken as one only when the next line names the action: "Attack Poison" and "Attack • Zone"
 * (keywords), "Attack—Claws of the Hungry Dead" (a name), "Blue Dragon Head Attack" (a name before).
 */
const LOOSE_ATTACK_TITLE = /^(.{0,40}?)\bAttack\b\s*(?:[—–]\s*(.+)|[*•✦]\s*(.+)|([A-Z][A-Za-z]*(?:,\s*[A-Z][A-Za-z]*)*))?$/;
const ACTIONS_TITLE = /^(?:Triggered|Standard|Minor|Move) Actions?$|^Immediate (?:Reaction|Interrupt)s?$/i;
const ACTION_WORDS = { standard: "standard", stamdard: "standard", minor: "minor", move: "move", free: "free", opportunity: "opportunity", "immediate reaction": "reaction", "immediate interrupt": "interrupt", no: "none" };
const ACTION_LINE = /\b(?:(Standard|Stamdard|Minor|Move|Free|Opportunity|No)\s+Actions?|(Immediate Reaction|Immediate Interrupt))\b/i;
/** The action a line names and where the words end: "Standard Action Melee", "Immediate Interrupt Ranged 10" (the page does not always say "Action"). */
function actionIn(text) {
	const m = String(text).match(ACTION_LINE);
	return m ? { action: ACTION_WORDS[(m[1] ?? m[2]).toLowerCase()] ?? null, end: m.index + m[0].length } : null;
}
const TITLES_OF_THE_TEXT = /^(?:Perception|Trigger|Attack|Secondary Attack|Countermeasures|Triggered Actions|Standard Actions?|Immediate Reactions?|Immediate Interrupts?|Minor Actions?|Move Actions?|Effect|Special|Requirement|Target|Object|Traits)$/i;
const LABELLED = /^([A-Z][A-Za-z0-9' ,-]{0,50}?)(?:\s*\(([^)]*)\))?:\s*(.*)$/;

/** "Hit: 2d6 damage" -> { label: "Hit", text: "2d6 damage" }; "Targets All creatures in burst" -> Target; a line with no label has none. */
function lineOf(text) {
	const m = text.match(LABELLED);
	if (m) return { label: m[1].trim(), text: m[3].trim() };
	// Some pages leave the colon out: "Targets Creatures in burst", "Effect The area is difficult terrain".
	const bare = text.match(/^(Targ(?:et|er)|Effect|Hit|Miss|Special|Secondary Attack|Secondary Target)s?\s+(.+)$/i);
	if (!bare && /^or\s+\w+ Action$/i.test(text)) return { label: "Or", text: text.replace(/^or\s+/i, "") };
	return bare ? { label: /^targ/i.test(bare[1]) ? "Target" : bare[1][0].toUpperCase() + bare[1].slice(1).toLowerCase(), text: bare[2].trim() } : null;
}

const asLines = list => list.map(l => l).filter(Boolean);

/** @returns {{secondary: boolean, number: string|null, keywords: string[], suffix: string, prefix: string}|null} what the line says when it titles an attack block */
function attackTitle(line, next) {
	const exact = line.match(ATTACK_TITLE);
	if (exact) return { secondary: Boolean(exact[1]), number: exact[2] ?? null, keywords: (exact[3] ?? "").split(/\s*,\s*/).map(k => k.trim()).filter(Boolean), suffix: "", prefix: "" };
	const loose = line.length < 70 && actionIn(next ?? "") && !LABELLED.test(next) ? line.match(LOOSE_ATTACK_TITLE) : null;
	if (!loose) return null;
	const prefix = loose[1].trim();
	const secondary = /^secondary$/i.test(prefix);
	return { secondary, number: null, keywords: (loose[3] ?? loose[4] ?? "").split(/\s*,\s*/).map(k => k.trim()).filter(Boolean), suffix: loose[2]?.trim() ?? "", prefix: secondary ? "" : prefix };
}

/** "Melee" is a reach of 1; an empty range stays empty. */
const rangeOf = text => (/^melee$/i.test(text.trim()) ? "Melee 1" : text.trim());

/**
 * @param {string[]} body  the lines of a trap's text (without what the sheet has fields for)
 * @param {string} name    the trap's name
 * @returns {{powers: object[], body: string[]}} the powers found, and the text that is left
 */
export function extractPowers(body, name) {
	const rest = [], powers = [];
	for (let i = 0; i < body.length; i++) {
		const line = body[i];
		const title = attackTitle(line, body[i + 1]);
		if (title) {
			const keywords = title.keywords;
			let j = i + 1, action = null, range = "";
			const actionLine = actionIn(body[j] ?? "");
			if (actionLine && !LABELLED.test(body[j])) {
				action = actionLine.action;
				range = rangeOf(body[j].slice(actionLine.end));
				j++;
			}
			const lines = [];
			for (; j < body.length; j++) {
				const l = lineOf(body[j]);
				if (!l || TITLES_OF_THE_TEXT.test(body[j])) break;
				lines.push(l);
			}
			if (lines.length) {
				powers.push({ name: title.secondary ? `${name} (secondary)` : title.number ? `${name} (attack ${title.number})` : title.suffix || title.prefix ? `${name} (${title.suffix || title.prefix})` : name, keywords, usage: "atwill", action: action ?? "none", icon: null, limit: null, recharge: null, lines, range });
				i = j - 1;
				continue;
			}
		} else if (ACTIONS_TITLE.test(line)) {
			const section = /^triggered/i.test(line) ? "none" : ACTION_WORDS[line.toLowerCase().replace(/ actions?$| reactions?$| interrupts?$/, "")] ?? (/reaction/i.test(line) ? "reaction" : /interrupt/i.test(line) ? "interrupt" : "none");
			let j = i + 1, current = null;
			const found = [];
			for (; j < body.length; j++) {
				const text = body[j];
				if (TITLES_OF_THE_TEXT.test(text)) break;
				if (text.includes("✦")) {
					const head = parseHeading(text);
					const title = text.replace(/^[^A-Za-z0-9]+/, "").split(/[(✦]/)[0].trim() || name;
					current = { name: title, keywords: head.keywords, usage: head.usage ?? "atwill", action: head.action ?? section, icon: head.icon, limit: null, recharge: null, lines: [], range: "" };
					found.push(current);
				} else if (current) {
					const l = lineOf(text);
					const action = text.match(/^Trigger\s*\(([^)]*)\)/i);
					if (action && actionIn(action[1])) current.action = actionIn(action[1]).action ?? current.action;
					current.lines.push(l ?? { label: "", text });
				} else break;
			}
			if (found.length) {
				powers.push(...found);
				i = j - 1;
				continue;
			}
			// A terrain power has no heading: the action, then its Requirement, Check, Success, Target, Attack, Hit... lines.
			const lines = [];
			for (j = i + 1; j < body.length; j++) {
				const l = lineOf(body[j]);
				if (!l || TITLES_OF_THE_TEXT.test(body[j])) break;
				lines.push(l);
			}
			if (lines.some(l => /^(?:attack|hit)$/i.test(l.label))) {
				const area = lines.find(l => /^target$/i.test(l.label))?.text.match(/((?:close|area)\s+(?:burst|blast|wall)\s+\d+)/i)?.[1] ?? "";
				powers.push({ name, keywords: [], usage: "atwill", action: section, icon: null, limit: null, recharge: null, lines, range: area });
				i = j - 1;
				continue;
			}
		}
		rest.push(line);
	}
	// Two powers of one name get a number.
	const seen = new Map();
	for (const p of powers) {
		const n = (seen.get(p.name) ?? 0) + 1;
		seen.set(p.name, n);
		if (n > 1) p.name = `${p.name} ${n}`;
		p.text = asLines(p.lines).map(l => `${l.label ? `${l.label}: ` : ""}${l.text}`).join("\n");
		p.attack = readAttack(p.lines);
		// "Level + 3 vs. Reflex": the encounter's level plus a number (the importer's level is the trap's).
		const level = p.lines.find(l => /^attack$/i.test(l.label))?.text.match(/^Level\s*\+\s*(\d+)\s+vs\.?\s+(AC|Fortitude|Reflex|Will)/i);
		if (level) p.levelAttack = { offset: Number(level[1]), def: { ac: "ac", fortitude: "fort", reflex: "ref", will: "wil" }[level[2].toLowerCase()] };
		if (p.range) p.attack.range = p.range;
		delete p.range;
	}
	return { powers, body: rest };
}
