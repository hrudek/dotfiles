import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTranscript, buildUserPrompt, cleanTitle, fitTitle, MAX_TITLE_CHARS } from "./title.ts";

describe("cleanTitle", () => {
	it("keeps a clean title unchanged", () => {
		assert.equal(cleanTitle("OAuth"), "OAuth");
		assert.equal(cleanTitle("AD Password Expiry"), "AD Password Expiry");
	});

	it("strips quotes, labels, markdown, emoji and trailing punctuation", () => {
		assert.equal(cleanTitle('"Tab Titles"'), "Tab Titles");
		assert.equal(cleanTitle("Title: Hyprland Gaps."), "Hyprland Gaps");
		assert.equal(cleanTitle("**Backup**"), "Backup");
		assert.equal(cleanTitle("🚀 Fish Prompt"), "Fish Prompt");
		assert.equal(cleanTitle("`Node.js`"), "Node.js");
	});

	it("uses only the first non-empty line", () => {
		assert.equal(cleanTitle("\n\nOAuth\nBecause the user asked about login"), "OAuth");
	});

	it("turns kebab- and snake-case into spaced words", () => {
		assert.equal(cleanTitle("tab-titles"), "Tab Titles");
		assert.equal(cleanTitle("fish_prompt"), "Fish Prompt");
	});

	it("keeps legitimate hyphenated terms", () => {
		assert.equal(cleanTitle("Wi-Fi"), "Wi-Fi");
		assert.equal(cleanTitle("Wi-Fi Roaming"), "Wi-Fi Roaming");
	});

	it("rejects NONE and empty answers", () => {
		assert.equal(cleanTitle("NONE"), undefined);
		assert.equal(cleanTitle("none."), undefined);
		assert.equal(cleanTitle("   "), undefined);
		assert.equal(cleanTitle('""'), undefined);
	});
});

describe("fitTitle", () => {
	it("leaves short titles alone", () => {
		assert.equal(fitTitle("Tab Titles"), "Tab Titles");
	});

	it("cuts mid-word when enough of the word survives", () => {
		assert.equal(fitTitle("Herdr Tab Title Extension"), "Herdr Tab Title Extensio");
	});

	it("drops a trailing fragment that is too short to guess", () => {
		assert.equal(fitTitle("Pi Session Naming Tool Rules"), "Pi Session Naming Tool");
	});

	it("cuts cleanly at an exact word boundary", () => {
		assert.equal(fitTitle("Twelve Chars Exactly Here Too"), "Twelve Chars Exactly");
	});

	it("never exceeds the budget", () => {
		for (const t of ["Supercalifragilisticexpialidocious Title", "A B C D E F G H I J K L M N O P"]) {
			assert.ok(Array.from(fitTitle(t)).length <= MAX_TITLE_CHARS, t);
		}
	});
});

describe("buildTranscript", () => {
	it("keeps the first user prompt and the latest messages", () => {
		const messages = [
			{ role: "user" as const, text: "First task" },
			...Array.from({ length: 30 }, (_, i) => ({
				role: (i % 2 ? "user" : "assistant") as "user" | "assistant",
				text: `message ${i} ${"x".repeat(400)}`,
			})),
		];
		const transcript = buildTranscript(messages);
		assert.ok(transcript.startsWith("User: First task"));
		assert.ok(transcript.includes("[…]"));
		assert.ok(transcript.includes("message 29"));
		assert.ok(transcript.length <= 4_100);
	});

	it("returns an empty string without text", () => {
		assert.equal(buildTranscript([{ role: "assistant", text: "  " }]), "");
	});
});

describe("buildUserPrompt", () => {
	it("mentions other titles only when present", () => {
		assert.ok(!buildUserPrompt({ transcript: "x", project: "p", otherTitles: [] }).includes("Other recent"));
		assert.ok(buildUserPrompt({ transcript: "x", project: "p", otherTitles: ["OAuth"] }).includes("OAuth"));
	});
});
