const repository = 'https://github.com/dyzmj/Inkslip';
const endpoint = 'https://api.github.com/repos/dyzmj/Inkslip/releases/latest';

function versionParts(value) {
  const match = typeof value === 'string' && value.match(/^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:-([\da-zA-Z.-]+))?(?:\+[\da-zA-Z.-]+)?$/);
  if (!match) throw Error('更新信息无效，请稍后重试。');
  return { version: match[1], numbers: match[1].split('.').map(BigInt), prerelease: Boolean(match[2]) };
}

function releaseUpdate(release, currentVersion, platform, arch) {
  const current = versionParts(currentVersion), latest = versionParts(release?.tag_name);
  const releaseUrl = `${repository}/releases/tag/${release.tag_name}`;
  if (release.draft !== false || release.prerelease !== false || latest.prerelease || release.html_url !== releaseUrl) throw Error('更新信息无效，请稍后重试。');
  let newer = current.prerelease;
  for (let index = 0; index < 3; index++) {
    if (latest.numbers[index] === current.numbers[index]) continue;
    newer = latest.numbers[index] > current.numbers[index]; break;
  }
  const target = { win32: 'windows', darwin: 'macos' }[platform];
  const filename = target && `Inkslip-${latest.version}-${target}-${arch}.zip`;
  const expectedDownload = `${repository}/releases/download/${release.tag_name}/${filename}`;
  const asset = Array.isArray(release.assets) && release.assets.find(asset => filename && asset.name === filename && asset.state === 'uploaded' && asset.size > 0 && asset.browser_download_url === expectedDownload);
  return { available: newer, currentVersion, latestVersion: latest.version, releaseUrl, downloadUrl: asset ? expectedDownload : null };
}

async function checkForUpdates({ currentVersion, platform, arch, fetch }) {
  let response;
  try {
    response = await fetch(endpoint, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Inkslip-update-check', 'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(15000), cache: 'no-store', credentials: 'omit' });
  } catch { throw Error('检查更新失败，请检查网络连接后重试。'); }
  if (response.status === 404) throw Error('尚无公开发布版本。');
  if ([403, 429].includes(response.status)) throw Error('GitHub 请求受限，请稍后重试。');
  if (!response.ok) throw Error('检查更新失败，请检查网络连接后重试。');
  let release;
  try { release = await response.json(); }
  catch { throw Error('更新信息无效，请稍后重试。'); }
  return releaseUpdate(release, currentVersion, platform, arch);
}

module.exports = { checkForUpdates, releaseUpdate };
