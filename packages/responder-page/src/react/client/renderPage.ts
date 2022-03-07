import React from 'react';
import ReactDOM from 'react-dom';
import {createBrowserHistory} from "history";
import App from "./App";
import Api from "../../app/Api";
import loadDocument from "./loadDocument";
import {load} from "@credo-js/loadable/react";
import createPageStore from "../app/createPageStore";
import createHttpJsonService from "../../app/createHttpJsonService";
import {AppStore} from "@credo-js/lexicon";
import type {ReactElement, ElementType} from "react";
import type {ClientOptions} from "./types";
import type {Page} from "../../types";

type React15Root = { render: Function };

function isReact18(obj: any): obj is {
	createRoot: (node: HTMLElement) => React15Root,
	hydrateRoot: (node: HTMLElement, element: ReactElement) => React15Root
} {
	return (
		"createRoot" in obj &&
		"hydrateRoot" in obj &&
		typeof obj.createRoot === "function" &&
		typeof obj.hydrateRoot === "function"
	);
}

export default async function renderPage(node: HTMLElement, options: ClientOptions = {}) {
	const data: Page.DocumentAppOptions = loadDocument("app-page");
	const {
		bootloader = []
	} = options;
	const {
		ssr = false,
		getQueryId,
		baseUrl,
		title,
		language,
		loadable = [],
		state = {},
		found,
		response,
		message,
		code,
	} = data;

	const {protocol, host} = window.location;
	const http = createHttpJsonService({
		getQueryId,
		protocol: String(protocol).substring(0, 5) === "https" ? "https" : "http",
		host,
	});

	const app = new AppStore(state);
	const page = createPageStore(http);
	const api = new Api<ElementType>("client", app, page, {
		http,
		translator: app.translator,
	});

	// client system bootstrap
	bootloader.forEach(func => {
		try {
			func(api);
		} catch(err) {
			if(__DEV__) {
				console.error("Bootstrap callback failure", err);
			}
		}
	});

	if(language) {
		await app.loadLanguage(language);
	}

	const history = createBrowserHistory();

	// load base page props from head tags
	api.baseUrl = typeof baseUrl === "string" ? baseUrl : "/";
	api.title = title || document.title;
	api.ssr = ssr;

	const render = (hydrate: boolean = false) => {
		let prevented = false;
		let root: null | React15Root = null;
		const evn = {
			React,
			ReactDOM,
			hydrate,
			ref: node,
			App,
			props: {api, history},
		};
		const def = (name: string, getter: () => void) => {
			Object.defineProperty(evn, name, { get: getter, configurable: false });
		};
		def( "defaultPrevented", () => prevented);
		def( "preventDefault", () => () => { prevented = true; });

		api.emit("onRender", evn);

		if(!prevented) {
			const reactDom = React.createElement(evn.App, evn.props);
			if(evn.hydrate) {
				if(isReact18(ReactDOM)) {
					root = ReactDOM.hydrateRoot(evn.ref, reactDom);
				} else {
					ReactDOM.hydrate(reactDom, evn.ref);
				}
			} else {
				if(isReact18(ReactDOM)) {
					root = ReactDOM.createRoot(evn.ref);
					root.render(reactDom);
				} else {
					ReactDOM.render(reactDom, evn.ref);
				}
			}
		}

		if(root != null) {
			// @ts-ignore
			api.root = root;
		}
	};

	const {location} = history;
	const url = location.pathname + location.search;
	const key = location.key || "";

	const error = (err: Error | string, code: number = 500) => {
		if(typeof err === "string") {
			err = new Error(err);
			// @ts-ignore
			err.code = code;
		}
		page.setError(err, url, key);
		render();
	};

	// @ts-ignore
	window.api = api;

	const err1 = () => app.translate("system.errors.pageResponseIsEmpty", "Page response is empty");
	const err2 = () => app.translate("system.errors.unknown", "Unknown error");

	if(api.ssr && found) {
		try {
			await load(loadable);
		} catch(err) {
			return error(err as Error);
		}
		if(response) {
			page.setResponse(response, url, key);
			render(true);
		} else {
			error(err1());
		}
	} else if(found) {
		if(response) {
			page.loadDocument(response, url, key);
			render();
		} else {
			error(err1());
		}
	} else {
		error(message || err2(), code);
	}
}