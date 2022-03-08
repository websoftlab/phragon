import React from "react";
import {StaticRouter} from "react-router-dom";
import {Head} from "../head";
import {ApiContext, Loader} from "../app";
import {CaptureContext} from "../lodable";
import type {API} from "@credo-js/responder-page";
import type {HeadTag} from "@credo-js/html-head";
import type {ElementType} from "react";

export default function App(props: {
	api: API.ApiInterface<ElementType>,
	context: any,
	location: string,
	headTags: HeadTag[],
	loadableContext: string[],
}) {
	const {api, context, location = "/", headTags, loadableContext} = props;
	const {page} = api;
	return (
		<ApiContext.Provider value={api}>
			<CaptureContext.Provider value={loadableContext}>
				<Head headTags={headTags}>
					<StaticRouter location={location} context={context}>
						<Loader page={page} onMount={() => {}} />
					</StaticRouter>
				</Head>
			</CaptureContext.Provider>
		</ApiContext.Provider>
	);
}