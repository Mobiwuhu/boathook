import {
	type BrowserContext,
	type BrowserContextOptions,
	chromium,
	type Page,
} from "playwright";
import { createLogger } from "../logger.ts";
import {
	loadNetworkExtension,
	stageNetworkExtension,
} from "./network-rules.ts";
import {
	applyStealthScripts,
	buildStealthUA,
	type StealthOpts,
	stealthArgs,
} from "./stealth.ts";

async function prepareUserAgent(
	context: BrowserContext,
	opts: StealthOpts,
): Promise<void> {
	await applyStealthScripts(context, opts);

	// Also use CDP Emulation.setUserAgentOverride per page.
	// The launch-level userAgent only sets HTTP headers; CDP override
	// patches navigator.userAgent in JS for dedicated workers.
	// ServiceWorkers are covered by the --user-agent= Chromium flag
	// passed via stealthArgs().
	//
	// Passing userAgentMetadata ensures navigator.userAgentData returns
	// correct brands/platform/versions natively (via C++ slots) without
	// needing JS-level prototype patching, which detection scripts like
	// CreepJS can identify as tampered.
	const uaDataPlatform =
		opts.navigatorPlatform === "MacIntel"
			? "macOS"
			: opts.navigatorPlatform === "Win32"
				? "Windows"
				: "Linux";
	const brandEntry = {
		brand: "Chromium",
		version: opts.chromeMajor,
	};
	const chromeEntry = {
		brand: "Google Chrome",
		version: opts.chromeMajor,
	};
	const notABrand = { brand: "Not-A.Brand", version: "8" };
	const fullBrandEntry = {
		brand: "Chromium",
		version: opts.chromeFullVersion,
	};
	const fullChromeEntry = {
		brand: "Google Chrome",
		version: opts.chromeFullVersion,
	};
	const fullNotABrand = {
		brand: "Not-A.Brand",
		version: "8.0.0.0",
	};

	const applyUAOverride = async (p: Page) => {
		try {
			const cdp = await context.newCDPSession(p);
			// Set default background colour to opaque white to avoid
			// headless detection via hasKnownBgColor (headless uses
			// transparent rgba(0,0,0,0) by default).
			await cdp.send("Emulation.setDefaultBackgroundColorOverride", {
				color: { r: 255, g: 255, b: 255, a: 1 },
			});
			// Set prefers-color-scheme to dark to avoid prefersLightColor detection
			// (headless defaults to light, real browsers are often set to dark)
			await cdp.send("Emulation.setEmulatedMedia", {
				features: [{ name: "prefers-color-scheme", value: "dark" }],
			});
			await cdp.send("Emulation.setUserAgentOverride", {
				userAgent: opts.userAgent,
				platform: opts.navigatorPlatform,
				userAgentMetadata: {
					brands: [brandEntry, chromeEntry, notABrand],
					fullVersionList: [fullBrandEntry, fullChromeEntry, fullNotABrand],
					platform: uaDataPlatform,
					platformVersion: opts.platformVersion,
					architecture: opts.architecture,
					model: "",
					mobile: false,
					bitness: opts.bitness,
					wow64: false,
				},
			});
		} catch {
			// CDP session may fail for special pages (about:blank, etc.)
		}
	};
	for (const p of context.pages()) {
		await applyUAOverride(p);
	}
	context.on("page", applyUAOverride);
}

type BrowserOptions = {
	profilePath: string;
	executablePath?: string;
	headless: boolean;
	proxy?: BrowserContextOptions["proxy"];
	extensionDirectory: string;
};

export async function launchChrome(options: BrowserOptions) {
	const { profilePath, extensionDirectory, executablePath, proxy, headless } =
		options;
	await stageNetworkExtension(extensionDirectory);
	const stealth = await buildStealthUA(executablePath ?? "chrome");
	const context = await chromium.launchPersistentContext(profilePath, {
		channel: "chrome",
		executablePath,
		headless,
		proxy,
		viewport: { width: 1440, height: 900 },
		args: [
			...stealthArgs(stealth.userAgent),
			"--enable-unsafe-extension-debugging",
		],
		ignoreDefaultArgs: [
			"--enable-automation",
			"--disable-popup-blocking",
			"--disable-component-update",
			"--disable-default-apps",
		],
		userAgent: stealth.userAgent,
	});
	try {
		await prepareUserAgent(context, stealth);
		const page = context.pages()[0] ?? (await context.newPage());
		const networkRules = await loadNetworkExtension(
			context,
			extensionDirectory,
		).catch((error: unknown) => {
			createLogger().warn("Chrome 网络扩展暂不可用，请检查 Chrome 版本。", {
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		});
		return { context, page, stealth, networkRules };
	} catch (error) {
		await context.close().catch(() => {});
		throw error;
	}
}
