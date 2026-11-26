import { LunaSettings, LunaSwitchSetting } from "@luna/ui";
import React from "react";

import { refresh, reloadLyrics, storage } from ".";

export const Settings = () => {
	const [autoOpen, setAutoOpen] = React.useState(storage.autoOpen);
	const [tidalFirst, setTidalFirst] = React.useState(storage.tidalFirst);

	return (
		<LunaSettings>
			<LunaSwitchSetting
				title="Open automatically"
				desc="Open on the lyrics whenever the now-playing view opens, like TIDAL does"
				checked={autoOpen}
				onChange={(_: unknown, checked: boolean) => {
					setAutoOpen((storage.autoOpen = checked));
					refresh();
				}}
			/>
			<LunaSwitchSetting
				title="TIDAL's lyrics first"
				desc="Prefer TIDAL's own lyrics over LRCLIB's. Synced lyrics win over plain ones either way. Off: LRCLIB first (TIDAL's timings are often off)."
				checked={tidalFirst}
				onChange={(_: unknown, checked: boolean) => {
					setTidalFirst((storage.tidalFirst = checked));
					reloadLyrics();
				}}
			/>
		</LunaSettings>
	);
};
