import type { BuildExtenderResult, PhragonPlugin } from "../types";
import type { Builder } from "../builder";
import { existsStat, readJsonFile } from "../utils";
import { phragon } from "../builder/configure";
import { installDependencies } from "../dependencies";
import docTypeReference from "./docTypeReference";
import { extender } from "../builder/configure";
import { toAsync } from "@phragon-util/async";

export default async function createPluginFactory(
	builder: Builder,
	installList?: string[]
): Promise<PhragonPlugin.Factory> {
	const plugins = builder.pluginList;
	const root = plugins.find((plugin) => plugin.root) || null;
	if (!root) {
		throw new Error("Root plugin is not loaded");
	}

	const data = await phragon(builder.getStore());

	// create links
	const pluginLink: Record<string, PhragonPlugin.Plugin> = {};
	plugins.forEach((plugin) => {
		pluginLink[plugin.name] = plugin;
	});

	// load install list
	if (!installList) {
		const stat = await existsStat("./phragon.json.install");
		if (stat && stat.isFile) {
			installList = Object.keys((await readJsonFile(stat.file)).plugins);
		} else {
			installList = [];
		}
	}

	// add extenders and docTypes
	const extenderList = await extender(builder.getStore());
	const extenderDocTypes: string[] = [];

	function addDocType(type: string) {
		if (!extenderDocTypes.includes(type)) {
			extenderDocTypes.push(type);
		}
	}

	for (const fn of extenderList) {
		const result = await toAsync(fn());
		if (typeof result === "object") {
			const { docTypeReference } = result;
			if (typeof docTypeReference === "string") {
				addDocType(docTypeReference);
			} else if (Array.isArray(docTypeReference)) {
				docTypeReference.forEach((type) => addDocType(type));
			}
			const keyOf: (keyof BuildExtenderResult)[] = ["onWebpackConfigure", "onRollupConfigure", "onOptions"];
			for (const key of keyOf) {
				const fn = result[key];
				if (typeof fn === "function") {
					builder.on(key, fn);
				}
			}
		}
	}

	// add docTypes
	const docTypes: { reference: string; __plugin: PhragonPlugin.Plugin }[] = builder.getStore().store.docTypeReference;
	if (Array.isArray(docTypes) && docTypes.length > 0) {
		docTypes.forEach((type) => {
			let reference = type.reference;
			if (reference.startsWith("./")) {
				reference = reference.substring(2);
			} else if (reference.startsWith("/")) {
				reference = reference.substring(1);
			}
			addDocType(`${type.__plugin.name}/${reference}`);
		});
	}

	if (extenderDocTypes.length > 0) {
		await docTypeReference(extenderDocTypes);
	}

	// check page responder
	if (data.render) {
		if (!data.responder.some((config) => config.responder.hasOwnProperty("page"))) {
			await installDependencies(["@phragon/responder-page"]);
		}

		// add render hooks
		const hooks = data.render.hooks;
		if (hooks) {
			Object.keys(hooks).forEach((name) => {
				builder.on(name, hooks[name as never]);
			});
		}
	}

	return {
		get builder() {
			return builder;
		},
		get plugins() {
			return plugins;
		},

		get root() {
			return root;
		},
		get renderPlugin() {
			return data.renderPlugin;
		},
		get lexicon() {
			return data.lexicon;
		},
		get cluster() {
			return data.cluster;
		},
		get render() {
			return data.render;
		},
		get renderOptions() {
			return data.renderOptions;
		},
		get ssr() {
			return data.ssr;
		},
		get page() {
			return data.page;
		},
		get components() {
			return data.components;
		},
		get publicPath() {
			return data.publicPath;
		},
		get cmd() {
			return data.cmd;
		},
		get service() {
			return data.service;
		},
		get configLoader() {
			return data.configLoader;
		},
		get controller() {
			return data.controller;
		},
		get responder() {
			return data.responder;
		},
		get middleware() {
			return data.middleware;
		},
		get extraMiddleware() {
			return data.extraMiddleware;
		},
		get daemon() {
			return data.daemon;
		},
		get bootstrap() {
			return data.bootstrap;
		},
		get bootloader() {
			return data.bootloader;
		},
		get route() {
			return data.route;
		},

		buildTimeout: data.buildTimeout,

		plugin(name: string): PhragonPlugin.Plugin | null {
			return pluginLink.hasOwnProperty(name) ? pluginLink[name] : null;
		},
		exists(name: string): boolean {
			return pluginLink.hasOwnProperty(name);
		},
		installed(name: string): boolean {
			return installList ? installList.includes(name) : false;
		},
		on(name: PhragonPlugin.HooksEvent, listener: Function) {
			builder.on(name, listener);
		},
		off(name: PhragonPlugin.HooksEvent, listener: Function) {
			builder.off(name, listener);
		},

		async fireHook<Event = unknown>(name: PhragonPlugin.HooksEvent, event?: Event): Promise<void> {
			return builder.emit(name, event);
		},
	};
}
