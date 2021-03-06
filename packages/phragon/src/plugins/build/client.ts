import type { PhragonPlugin } from "../../types";
import { CmpJS } from "@phragon/cli-cmp";
import { isPlainObject } from "@phragon/utils";
import createRelativePath from "./createRelativePath";
import { buildPath, createCwdDirectoryIfNotExists, exists, writeBundleFile } from "../../utils";
import { writeFile } from "fs/promises";

async function writeClientFailure() {
	const file = buildPath("./client-failure.js");
	if (!(await exists(file))) {
		await writeFile(
			file,
			`export default function failure(err) {
	if(__DEV__) {
		console.error("Ready page failure", err);
	}
	const div = document.createElement("div");
	const style = {
		position: "fixed",
		top: "0",
		left: "0",
		width: "100%",
		padding: "20px 30px",
		zIndex: "100000",
		backgroundColor: "#000",
		color: "#d02f2f",
		font: "15px/1 sans-serif",
		textAlign: "center",
	};
	Object.keys(style).forEach((key) => { div.style[key] = style[key]; });
	div.appendChild(document.createTextNode(err.message));
	document.body.appendChild(div);
}`
		);
	}
}

export async function buildClient(factory: PhragonPlugin.Factory) {
	const {
		options: { renderDriver },
	} = factory;
	if (!renderDriver) {
		return;
	}

	const {
		options: { clusters, renderOptions },
	} = factory;
	const renderPageImport = `${renderDriver.modulePath}/client`;

	async function create(
		options: { mid?: number; bootloader?: PhragonPlugin.HandlerOptional; renderOptions?: any } = {}
	) {
		const { mid, bootloader, renderOptions } = options;
		const file = mid ? `client-${mid}/client.js` : "client.js";
		const cJs = new CmpJS();
		const bootloaders: string[] = [cJs.imp(`${mid ? ".." : "."}/lexicon-client.js`)];
		const boot: string[] = [];

		if (mid) {
			await createCwdDirectoryIfNotExists(`.phragon/client-${mid}`);
		}

		const addBoot = (bootloader: PhragonPlugin.HandlerOptional) => {
			let { path, importer, options } = bootloader;
			const func = cJs.imp(createRelativePath(path, mid ? ".phragon/pages" : ".phragon"), importer);
			if (!boot.includes(func)) {
				boot.push(func);
				bootloaders.push(
					`(api) => typeof ${func} === "function" && ${func}(api${
						options ? `, ${cJs.tool.esc(options)}` : ""
					})`
				);
			}
		};

		const failure = cJs.imp(mid ? `../client-failure.js` : "./client-failure.js");
		cJs.impOnly(mid ? `../pages/page-${mid}.js` : "./pages.js");

		factory.plugins.forEach((plugin) => {
			if (plugin.bootloader) {
				addBoot(plugin.bootloader);
			}
		});

		if (bootloader) {
			addBoot(bootloader);
		}

		const func = cJs.imp(renderPageImport, "*");

		cJs.append(
			`const renderPage = typeof ${func}.renderPage === "function" ? ${func}.renderPage : (typeof ${func}.default === "function" ? ${func}.default : ${func});`
		);

		cJs.group('if( typeof renderPage === "function" )', "", (t) => {
			const { bootloader, ...rest } = isPlainObject(renderOptions) ? renderOptions : <any>{};
			let opt = t.esc(rest).slice(1, -1).trim();
			if (opt.length > 0) {
				opt += ", ";
			}
			cJs.append('const node = document.getElementById("root");');
			cJs.group("if( node )", "", () => {
				cJs.append(`const options = {${opt}bootloader: [ ${bootloaders.join(", ")} ]};`);
				cJs.append(`renderPage(node, options).catch(${failure});`);
			});
			cJs.group("else", "", () => {
				cJs.append(`${failure}(new Error("root element not found"));`);
			});
		});

		cJs.group("else", "", () => {
			cJs.append(`${failure}(new Error("render callback is not defined"));`);
		});

		await writeBundleFile(file, cJs.toJS("import"));
	}

	await writeClientFailure();

	if (clusters && clusters.length > 0) {
		for (let cluster of clusters) {
			const { bootloader, mode, mid, renderOptions } = cluster;
			if (mode === "app") {
				await create({ mid, bootloader, renderOptions });
			}
		}
	} else {
		await create({ renderOptions });
	}
}
