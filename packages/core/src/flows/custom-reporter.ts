import type { CustomReporter } from "@boathook/plugin-sdk";

export type ReporterFormat =
	| "junit"
	| "json"
	| "markdown"
	| "tap"
	| "allure"
	| "html";

export class CustomReporterRegistry {
	#reporters = new Map<string, CustomReporter>();

	register(reporter: CustomReporter): void {
		if (!reporter.name.trim()) {
			throw new Error("Reporter name is required");
		}
		this.#reporters.set(reporter.name, reporter);
	}

	get(name: string): CustomReporter | undefined {
		return this.#reporters.get(name);
	}

	has(name: string): boolean {
		return this.#reporters.has(name);
	}

	list(): string[] {
		return [...this.#reporters.keys()].sort();
	}
}
