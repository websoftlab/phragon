import { __isProd__ } from "./definers";

export function invariant(cond: any, message: string): asserts cond {
	if (!cond) throw new Error(message);
}

export function warning(cond: any, message: string): void {
	if (__isProd__()) {
		return;
	}
	if (!cond) {
		// eslint-disable-next-line no-console
		if (typeof console !== "undefined") console.warn(message);

		try {
			// This error is thrown as a convenience so you can more easily
			// find the source for a warning that appears in the console by
			// enabling "pause on exceptions" in your JavaScript debugger.
			throw new Error(message);
			// eslint-disable-next-line no-empty
		} catch (e) {}
	}
}

const alreadyWarned: Record<string, boolean> = {};

export function warningOnce(key: string, cond: boolean, message: string) {
	if (__isProd__()) {
		return;
	}
	if (!cond && !alreadyWarned[key]) {
		alreadyWarned[key] = true;
		warning(false, message);
	}
}
