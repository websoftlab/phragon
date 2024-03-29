import type { RollupTypescriptOptions } from "@rollup/plugin-typescript";
import type { InputOptions, OutputOptions, InputPluginOption } from "rollup";
import type { BuildConfigureOptions, BuildConfigure } from "../types";
import typescript from "@rollup/plugin-typescript";
import resolvePlugin from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import replace from "@rollup/plugin-replace";
import aliasPlugin from "@rollup/plugin-alias";
import baseConfigure from "../configure";
import { alias, define } from "../config";
import { cwdPath, buildPath, exists, readJsonFile } from "../utils";
import { nodeExternals, progressRollupPlugin } from "./plugins";
import { debug } from "../debug";

async function getTsConfig() {
	const file = cwdPath("tsconfig.json");
	const tsOptions: RollupTypescriptOptions = {
		cacheDir: buildPath("ts-cache"),
	};

	if (await exists(file)) {
		const tsConf = await readJsonFile(file);
		if (tsConf.compilerOptions) tsOptions.compilerOptions = tsConf.compilerOptions;
		if (tsConf.exclude) tsOptions.exclude = tsConf.exclude;
		if (tsConf.include) tsOptions.include = tsConf.include;
	}

	if (!tsOptions.exclude) {
		tsOptions.exclude = [];
	}
	if (Array.isArray(tsOptions.exclude)) {
		tsOptions.exclude.push("./src-client/**");
	}
	if (Array.isArray(tsOptions.include)) {
		const include: string[] = [];
		tsOptions.include.forEach((item) => {
			if (typeof item === "string" && !item.includes("src-client")) {
				include.push(item);
			}
		});
		tsOptions.include = include;
	}

	return tsOptions;
}

export default async function configure(
	options: BuildConfigureOptions
): Promise<InputOptions & { output: OutputOptions }> {
	const conf: BuildConfigure = await baseConfigure(options, "rollup");
	const {
		isClient,
		isDevServer,
		isServerPage,
		bundle,
		cluster,
		factory: { cluster: clusterList },
	} = conf;

	if (isClient || isServerPage || isDevServer) {
		throw new Error("Attention, the rollup package manager should only work in server mode!");
	}

	let extensions = [".ts", ".js"];

	const input: Record<string, string> = {};
	function add(key: string) {
		input[key] = buildPath(`${key}.js`);
	}

	add("server");
	if (cluster) {
		add(`srv/server-${cluster.mid}`);
	} else if (clusterList.length > 0) {
		for (const cluster of clusterList) {
			add(`srv/server-${cluster.mid}`);
		}
	}

	const plugins: InputPluginOption[] = [
		replace({
			preventAssignment: false,
			values: await define(conf),
		}),
		nodeExternals(await conf.fireOnOptionsHook("plugin.externals", {})),
		commonjs(
			await conf.fireOnOptionsHook("plugin.commonjs", {
				extensions,
			})
		),
		json(
			await conf.fireOnOptionsHook("plugin.json", {
				namedExports: false,
			})
		),
		aliasPlugin({
			entries: await alias(conf),
		}),
		resolvePlugin(
			await conf.fireOnOptionsHook("plugin.resolve", {
				extensions,
			})
		),
		typescript(await conf.fireOnOptionsHook("plugin.typescript", await getTsConfig())),
	];

	const config: InputOptions & { output: OutputOptions } = {
		input,
		output: {
			dir: cwdPath(`${bundle}/server`),
			format: "cjs",
			inlineDynamicImports: false,
			esModule: "if-default-prop",
			generatedCode: {
				reservedNamesAsProps: false,
			},
			interop: "compat",
			systemNullSetters: false,
		},
		plugins,
	};

	if (debug.isTTY) {
		plugins.push(progressRollupPlugin(conf));
	}

	await conf.fireHook("onRollupConfigure", config);

	return config;
}
