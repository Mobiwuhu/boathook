export const releasePlatform = "linux-x64";
export const releaseDirectoryName = `boathook-${releasePlatform}`;
export const releaseVersion =
	/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
export const githubRepository = /^[a-z\d-]+\/(?!\.{1,2}$)[a-z\d_.-]+$/i;

export function releaseArchiveName(
	version: string,
	withPlugins = false,
): string {
	const suffix = withPlugins ? "-with-plugins" : "";
	return `${releaseDirectoryName}-${version}${suffix}.tar.gz`;
}
