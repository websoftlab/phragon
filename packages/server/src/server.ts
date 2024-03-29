import Koa from "koa";
import {
	appMiddleware,
	routeMiddleware,
	renderMiddleware,
	bodyParserMiddleware,
	sessionMiddleware,
} from "./middleware";
import cluster from "cluster";
import { Worker, isMainThread } from "worker_threads";
import { createPhragonJS, BootManager } from "./phragon";
import cronService from "./cron/service";
import prettyMs from "pretty-ms";
import daemon from "./daemon";
import { RouteManager } from "./route";
import type { Context } from "koa";
import type { PhragonJS, Server } from "./types";

export default async function server(options: Server.Options = {}) {
	// run cron service
	const { cronMode } = options;
	if (cronMode === "service") {
		return cronService(options);
	}

	const isProd = __PROD__ || options.mode === "production";
	if (isProd) {
		daemon().init();
	}

	const { registrar: registrarOption, buildId, buildVersion = "1.0.0", publicPath = [] } = options;

	const registrar = registrarOption || new BootManager();
	const app = new Koa();
	const isCluster = cluster.isWorker && options.process?.id === cluster.worker?.workerData?.id;
	const phragon: PhragonJS = await createPhragonJS<PhragonJS>(
		options,
		{
			mode: "app",
			cluster: isCluster,
			envMode: options.mode,
		},
		{
			app,
			responders: {},
			middleware: {},
			controllers: {},
		}
	);

	const defaultResponders = ["json", "text", "static"];
	if (phragon.renderHTMLDriver != null) {
		defaultResponders.push("page");
	}

	for (let name of defaultResponders) {
		if (!registrar.defined("responders", name)) {
			registrar.responder(name, (await import(`@phragon/responder-${name}`)).responder);
		}
	}

	registrar.option("responders", "static", { publicPath });

	const { env, language, languages, multilingual } = phragon;

	app.on("error", (err) => {
		phragon.debug.error("Server failure", err);
	});

	// check host
	app.use(async (ctx: Context, next) => {
		const time = Date.now();
		const delta = () => prettyMs(Date.now() - time);
		if (!phragon.route.isHost(ctx)) {
			phragon.debug.route(
				"invalid host {red %s} %s %s (%s) {red 400}",
				ctx.hostname,
				ctx.method,
				ctx.url,
				delta()
			);
			return ctx.throw(400, "Bad Request");
		}
		ctx.set("X-Build-Version", buildVersion);
		if (buildId) {
			ctx.set("X-Build-Id", buildId);
		}
		try {
			await next();
		} finally {
			phragon.debug.route(
				`{blue [%s]} %s %s (%s) {${ctx.status < 300 ? "green" : "red"} %s}`,
				ctx.hostname,
				ctx.method,
				ctx.url,
				delta(),
				ctx.status
			);
		}
	});

	const conf = phragon.config("config");
	const { store = {} } = conf;

	// add version
	store.buildVersion = buildVersion;
	if (buildId) {
		store.buildId = buildId;
	}

	bodyParserMiddleware(phragon);
	sessionMiddleware(phragon);
	appMiddleware(phragon, {
		store,
		language,
		multilingual,
		languages,
	});

	// base routes
	registrar.middleware(routeMiddleware);

	const boot = await registrar.load(phragon);

	// add route after loading services
	phragon.define("route", new RouteManager(phragon, options.router));

	function cron<T>(serv: T): T {
		if (isProd && !isCluster && !phragon.process && !phragon.isCron() && cronMode !== "disabled" && isMainThread) {
			const cron = phragon.config("cron");
			if (cron.enabled) {
				const dmn = daemon();
				const argv: string[] = [];
				if (process.argv.includes("--no-pid")) {
					argv.push("--no-pid");
				}

				let cronWorker: Worker | undefined;
				phragon.define(
					"cronWorker",
					function () {
						return cronWorker;
					},
					true
				);

				const startCron = () => {
					cronWorker = new Worker(require.main?.filename || process.argv[1], {
						workerData: { pid: process.pid, appMode: "cron" },
						argv,
					});
					cronWorker.on("message", (message) => {
						dmn.send(message);
					});
					cronWorker.on("exit", (code) => {
						cronWorker = undefined;
						phragon.debug.error("Cron worker exit ({blue %s}), try restart after 10 seconds...", code);
						setTimeout(startCron, 10000);

						// send restart count
						dmn.send({
							type: "restart",
							id: "cron",
							part: 1,
							pid: dmn.pid,
							cid: 0,
						});
					});
				};
				startCron();
			}
		}
		return serv;
	}

	renderMiddleware(phragon);

	const host = env.get("host").default("127.0.0.1").value;
	const port = env.get("port").default(1278).toPortNumber().value;
	const mode = env.get("mode").value;

	if (isProd) {
		const dmn = daemon();
		dmn.send({
			type: "detail",
			id: phragon.process ? phragon.process.id : "main",
			pid: dmn.pid,
			cid: process.pid,
			part: (phragon.process && cluster.worker?.workerData?.part) || 1,
			port,
			host,
			mode: phragon.mode,
		});
	}

	return boot()
		.then(() => {
			return app.listen(port, host, () => {
				phragon.debug(`Server is running at http://${host}:${port}/ - {cyan ${mode}} mode`);
			});
		})
		.then(cron);
}
