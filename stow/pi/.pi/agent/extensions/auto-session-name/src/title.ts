/**
 * Pure helpers for generating short session titles: prompt construction,
 * cleanup of the model's answer, and fitting the result to the tab width.
 */

/** Soft display budget; herdr's tab bar and Ovis' tab list both fit this. */
export const MAX_TITLE_CHARS = 24;

/** A cut-off trailing word is kept only if this many characters survive. */
const MIN_PARTIAL_WORD_CHARS = 4;

/** Model answer meaning "no identifiable topic yet". */
export const NO_TOPIC = "NONE";

export const SYSTEM_PROMPT = `You name coding-agent chat sessions so the user can tell them apart at a glance in a narrow terminal tab.

Output only the title, nothing else.

Rules:
- Always English, even when the conversation is in another language.
- Title Case. Keep established spellings of acronyms and names (OAuth, SSH, AD, CI, Hyprland, herdr, macOS).
- As short as possible while still distinctive: one word when it is unambiguous, otherwise a few words separated by spaces. Aim for under 20 characters.
- Name the concrete subject (system, feature, bug, tool, file), not the activity. Never use a generic word like Fix, Help, Question, Setup, Code, Issue, Task, Debug, Chat or Session on its own.
- Separate words with spaces. No quotes, punctuation, emoji or trailing period, and no hyphens or underscores used as word separators (hyphens inside an established name such as systemd-resolved or Wi-Fi are fine).
- If there is no identifiable topic yet (for example only a greeting), output exactly ${NO_TOPIC}.

Examples: OAuth · Tab Titles · AD Password Expiry · Hyprland Gaps · Backup · Fish Prompt`;

export interface TranscriptMessage {
	role: "user" | "assistant";
	text: string;
}

const MAX_FIRST_PROMPT_CHARS = 1_200;
const MAX_MESSAGE_CHARS = 600;
const MAX_TRANSCRIPT_CHARS = 4_000;

function clip(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max)} …`;
}

/**
 * Condense a conversation for the naming model: the first user prompt (it
 * usually states the task) plus the most recent messages that fit the budget
 * (they matter after /fork or when the topic drifted).
 */
export function buildTranscript(messages: TranscriptMessage[]): string {
	const usable = messages.filter((m) => m.text.trim());
	if (usable.length === 0) return "";

	const firstUser = usable.findIndex((m) => m.role === "user");
	const head = firstUser >= 0 ? [`User: ${clip(usable[firstUser]!.text, MAX_FIRST_PROMPT_CHARS)}`] : [];
	let budget = MAX_TRANSCRIPT_CHARS - (head[0]?.length ?? 0);

	const tail: string[] = [];
	for (let i = usable.length - 1; i > firstUser && budget > 0; i--) {
		const m = usable[i]!;
		const line = `${m.role === "user" ? "User" : "Assistant"}: ${clip(m.text, MAX_MESSAGE_CHARS)}`;
		if (line.length > budget) break;
		tail.unshift(line);
		budget -= line.length;
	}

	const skipped = firstUser >= 0 && tail.length > 0 && usable.length - 1 - firstUser > tail.length;
	return [...head, ...(skipped ? ["[…]"] : []), ...tail].join("\n\n");
}

export function buildUserPrompt(input: {
	transcript: string;
	project: string;
	otherTitles: string[];
}): string {
	const parts = [`Project directory: ${input.project}`];
	if (input.otherTitles.length > 0) {
		parts.push(
			`Other recent sessions in this project are titled: ${input.otherTitles.join(", ")}. ` +
				"Pick a title that is clearly distinguishable from them, unless this session is obviously about the same thing.",
		);
	}
	parts.push(`<conversation>\n${input.transcript}\n</conversation>`, "Title:");
	return parts.join("\n\n");
}

/**
 * Turn the raw model answer into a display title, or undefined when the
 * answer is unusable (empty, NONE, only symbols).
 */
export function cleanTitle(raw: string): string | undefined {
	let line = raw
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l.length > 0);
	if (!line) return undefined;

	line = line
		.replace(/^(?:session\s+)?(?:title|name)\s*[:\-–—]\s*/i, "")
		.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
		.replace(/^[\s"'`*_#>\[\](){}«»„“”‘’]+|[\s"'`*_#>\[\](){}«»„“”‘’]+$/g, "")
		.replace(/[.,;:!?…]+$/, "")
		.trim();

	// kebab-case or snake_case answer despite the instructions → spaces.
	if (!/\s/.test(line) && /^[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)+$/u.test(line) && /_|-\p{Ll}/u.test(line)) {
		line = line
			.split(/[-_]/)
			.map((w) => (/^\p{Ll}/u.test(w) ? w[0]!.toUpperCase() + w.slice(1) : w))
			.join(" ");
	}
	line = line.replace(/\s+/g, " ").trim();

	if (!line || line.toUpperCase() === NO_TOPIC || !/[\p{L}\p{N}]/u.test(line)) return undefined;
	return fitTitle(line);
}

/**
 * Fit a title into `max` characters. Prefer ending at a word boundary; a
 * trailing word is cut mid-word only if enough of it survives to be guessable
 * ("Herdr Tab Title Extensio"), otherwise it is dropped.
 */
export function fitTitle(title: string, max = MAX_TITLE_CHARS): string {
	const chars = Array.from(title.trim());
	if (chars.length <= max) return chars.join("");

	const cut = chars.slice(0, max).join("");
	if (chars[max] === " ") return cut.trimEnd();

	const lastSpace = cut.lastIndexOf(" ");
	if (lastSpace <= 0) return cut;

	const partial = Array.from(cut.slice(lastSpace + 1)).length;
	const trimmed = partial >= MIN_PARTIAL_WORD_CHARS ? cut : cut.slice(0, lastSpace);
	return trimmed.replace(/[\s\-–—/&+,.:;]+$/, "");
}
