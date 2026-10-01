type GithubTag = {
  name?: unknown;
};

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
};

export type GithubTagUpdateResult = {
  currentVersion: string;
  latestVersion: string;
  latestTag: string;
  tagUrl: string;
  updateAvailable: boolean;
};

const parseVersion = (value: string): ParsedVersion | null => {
  const match = value
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
  };
};

const comparePrerelease = (left: string[], right: string[]) => {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return Number(leftPart) - Number(rightPart);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart.localeCompare(rightPart);
  }

  return 0;
};

export const compareVersions = (left: string, right: string) => {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (!leftVersion || !rightVersion) {
    throw new Error("版本号格式无效");
  }

  for (const key of ["major", "minor", "patch"] as const) {
    const difference = leftVersion[key] - rightVersion[key];
    if (difference !== 0) return difference;
  }

  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
};

const parseGithubRepository = (repositoryUrl: string) => {
  const normalized = repositoryUrl.trim().replace(/^git\+/, "");
  const match = normalized.match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?\/?$/i,
  );
  if (!match) throw new Error("项目仓库不是有效的 GitHub 地址");

  return {
    owner: match[1],
    repo: match[2],
    webUrl: `https://github.com/${match[1]}/${match[2]}`,
  };
};

export const checkGithubTagUpdate = async (
  repositoryUrl: string,
  currentVersion: string,
  fetchTags: typeof fetch = fetch,
): Promise<GithubTagUpdateResult> => {
  const repository = parseGithubRepository(repositoryUrl);
  if (!parseVersion(currentVersion)) throw new Error("当前应用版本号格式无效");

  const response = await fetchTags(
    `https://api.github.com/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/tags?per_page=100`,
    { cache: "no-store" },
  );
  if (!response.ok) {
    throw new Error(`GitHub Tag 查询失败（HTTP ${response.status}）`);
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) throw new Error("GitHub Tag 返回格式无效");

  const versions = (payload as GithubTag[])
    .flatMap((tag) => {
      if (typeof tag.name !== "string" || !parseVersion(tag.name)) return [];
      return [{ tag: tag.name, version: tag.name.replace(/^v/i, "") }];
    })
    .sort((left, right) => compareVersions(right.version, left.version));

  const latest = versions[0];
  if (!latest) throw new Error("GitHub 仓库中没有可识别的版本 Tag");

  return {
    currentVersion,
    latestVersion: latest.version,
    latestTag: latest.tag,
    tagUrl: `${repository.webUrl}/tree/${encodeURIComponent(latest.tag)}`,
    updateAvailable: compareVersions(latest.version, currentVersion) > 0,
  };
};
