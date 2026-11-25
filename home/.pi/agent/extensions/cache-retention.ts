import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (_pi: ExtensionAPI) {
	process.env.PI_CACHE_RETENTION ??= "long";
}
