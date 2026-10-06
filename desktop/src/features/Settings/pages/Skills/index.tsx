import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  Check,
  ChevronRight,
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Presentation,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Button, Card, IconButton, MarkdownText, Modal, Result, Skeleton, TextInput } from "@/shared/ui";
import { ModalShell } from "@/shared/ui/Modal";
import {
  deleteSkill,
  getSkillCatalog,
  getSkillDetail,
  getSkillFileContent,
  importSkillMarkdown,
  installSkillRuntime,
  updateSkill,
  type SkillCatalogItem,
  type SkillDetail,
  type SkillFileDescriptor,
  type SkillRuntimeStatus,
} from "@/shared/api/skills";
import SettingsPageLayout from "../../components/SettingsPageLayout";
import { getSkillPresentation, type SkillIconKind } from "./catalog";

const BASE_CATEGORIES = ["精选技能"];
const PREFERRED_CATEGORIES = ["办公效率", "商业金融", "内容创作", "学术研究", "营销增长", "工程研发"];

const iconConfig: Record<SkillIconKind, { Icon: typeof FileText; className: string }> = {
  spreadsheet: { Icon: FileSpreadsheet, className: "bg-emerald-50 text-emerald-500" },
  pdf: { Icon: FileText, className: "bg-red-50 text-red-400" },
  word: { Icon: FileText, className: "bg-blue-50 text-blue-500" },
  presentation: { Icon: Presentation, className: "bg-violet-50 text-violet-500" },
  markdown: { Icon: FileText, className: "bg-surface-secondary text-text-tertiary" },
};

const runtimeLabel = (status: SkillRuntimeStatus) => {
  if (status === "available") return "运行环境可用";
  if (status === "not-installed") return "运行环境未安装";
  if (status === "broken") return "运行环境需修复";
  if (status === "unknown") return "运行环境未知";
  return null;
};

const runtimeClassName = (status: SkillRuntimeStatus) => {
  if (status === "available") return "text-success-text";
  if (status === "broken") return "text-danger-text";
  return "text-text-tertiary";
};

const originLabel = (origin: SkillCatalogItem["origin"]) => {
  if (origin === "built-in") return "内置";
  if (origin === "user") return "用户添加";
  return "外部来源";
};

const formatBytes = (bytes: number | null) => {
  if (bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const parseMarkdownDocument = (content: string) => {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") return { body: content, metadata: [] as Array<[string, unknown]> };

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closingIndex === -1) return { body: content, metadata: [] as Array<[string, unknown]> };

  try {
    const parsed = parseYaml(lines.slice(1, closingIndex).join("\n")) as unknown;
    const metadata = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? Object.entries(parsed as Record<string, unknown>)
      : [];

    return {
      body: lines.slice(closingIndex + 1).join("\n").trimStart(),
      metadata,
    };
  } catch {
    return { body: content, metadata: [] as Array<[string, unknown]> };
  }
};

const formatMetadataValue = (value: unknown) => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return stringifyYaml(value).trim();
};

const METADATA_LABEL_KEYS: Record<string, string> = {
  id: "settings.skills.metadata.labels.id",
  name: "settings.skills.metadata.labels.name",
  displayName: "settings.skills.metadata.labels.displayName",
  description: "settings.skills.metadata.labels.description",
  version: "settings.skills.metadata.labels.version",
  category: "settings.skills.metadata.labels.category",
  visibility: "settings.skills.metadata.labels.visibility",
  source: "settings.skills.metadata.labels.source",
  status: "settings.skills.metadata.labels.status",
  "execution.context": "settings.skills.metadata.labels.executionContext",
  "execution.agent": "settings.skills.metadata.labels.executionAgent",
  "execution.allowedTools": "settings.skills.metadata.labels.allowedTools",
  "execution.runtimeBindings": "settings.skills.metadata.labels.runtimeBindings",
  "execution.workspaceBound": "settings.skills.metadata.labels.workspaceBound",
};

const METADATA_VALUE_KEYS: Record<string, Record<string, string>> = {
  visibility: {
    public: "settings.skills.metadata.values.visibility.public",
    private: "settings.skills.metadata.values.visibility.private",
  },
  status: {
    active: "settings.skills.metadata.values.status.active",
    review: "settings.skills.metadata.values.status.review",
    draft: "settings.skills.metadata.values.status.draft",
    deprecated: "settings.skills.metadata.values.status.deprecated",
  },
  "execution.context": {
    fork: "settings.skills.metadata.values.executionContext.fork",
    inline: "settings.skills.metadata.values.executionContext.inline",
  },
  "execution.agent": {
    subAgent: "settings.skills.metadata.values.executionAgent.subAgent",
    mainAgent: "settings.skills.metadata.values.executionAgent.mainAgent",
  },
  "execution.workspaceBound": {
    true: "settings.skills.metadata.values.workspaceBound.true",
    false: "settings.skills.metadata.values.workspaceBound.false",
  },
};

const METADATA_TOOL_KEYS: Record<string, string> = {
  read: "settings.skills.metadata.values.tools.read",
  list: "settings.skills.metadata.values.tools.list",
  glob: "settings.skills.metadata.values.tools.glob",
  grep: "settings.skills.metadata.values.tools.grep",
  terminal: "settings.skills.metadata.values.tools.terminalSession",
  github_repository: "settings.skills.metadata.values.tools.githubRepository",
  github_pull_request: "settings.skills.metadata.values.tools.githubPullRequest",
  github_actions: "settings.skills.metadata.values.tools.githubActions",
};

const translateMetadata = (t: TFunction, key: string, fallback: string) =>
  String(t(key, { defaultValue: fallback }));

const formatMetadataLabel = (key: string, t: TFunction) => {
  const translationKey = METADATA_LABEL_KEYS[key];
  return translationKey ? translateMetadata(t, translationKey, key) : key;
};

const formatLocalizedMetadataValue = (key: string, value: unknown, t: TFunction) => {
  const fallback = formatMetadataValue(value);

  if (key === "execution.allowedTools") {
    const tools = Array.isArray(value)
      ? value.map(String)
      : typeof value === "string"
        ? value.split(",")
        : [];
    const localizedTools = tools
      .map((tool) => tool.trim())
      .filter(Boolean)
      .map((tool) => {
        const translationKey = METADATA_TOOL_KEYS[tool];
        return translationKey ? translateMetadata(t, translationKey, tool) : tool;
      });
    return localizedTools.length > 0 ? localizedTools.join("、") : fallback;
  }

  const normalizedValue = typeof value === "string" || typeof value === "boolean"
    ? String(value).trim()
    : fallback;
  const translationKey = METADATA_VALUE_KEYS[key]?.[normalizedValue];
  return translationKey ? translateMetadata(t, translationKey, fallback) : fallback;
};

type SkillView = SkillCatalogItem & {
  icon: SkillIconKind;
};

const toSkillView = (skill: SkillCatalogItem): SkillView => {
  const presentation = getSkillPresentation(skill.id);
  return { ...skill, icon: presentation.icon };
};

export default function SkillsSettings() {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [activeCategory, setActiveCategory] = useState("精选技能");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [importingSkill, setImportingSkill] = useState(false);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [deletingSkillId, setDeletingSkillId] = useState<string | null>(null);

  const showNotice = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 2600);
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const response = await getSkillCatalog();
      setSkills(response.skills);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "技能目录加载失败");
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const skillViews = useMemo(() => skills.map(toSkillView), [skills]);

  const categories = useMemo(() => {
    const discovered = [...new Set(skillViews.map((skill) => skill.category).filter(Boolean))];
    const ordered = [
      ...PREFERRED_CATEGORIES.filter((category) => discovered.includes(category)),
      ...discovered.filter((category) => !PREFERRED_CATEGORIES.includes(category)),
    ];
    return [...BASE_CATEGORIES, ...ordered];
  }, [skillViews]);

  useEffect(() => {
    if (!categories.includes(activeCategory)) setActiveCategory("精选技能");
  }, [activeCategory, categories]);

  const visibleSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return skillViews.filter((skill) => {
      const matchesCategory = activeCategory === "精选技能"
        ? skill.featured
        : skill.category === activeCategory;
      const matchesQuery = !normalizedQuery || `${skill.name} ${skill.description} ${skill.source} ${skill.category}`.toLowerCase().includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [activeCategory, query, skillViews]);

  const openSkill = async (id: string) => {
    setDetailLoadingId(id);
    try {
      setSelectedSkill(await getSkillDetail(id));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "技能详情加载失败");
    } finally {
      setDetailLoadingId(null);
    }
  };

  const handleImport = async (file: File) => {
    setImportingSkill(true);
    try {
      const imported = await importSkillMarkdown(file);
      await loadCatalog();
      setQuery("");
      setSelectedSkill(imported);
      showNotice(`「${imported.name}」已导入`);
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "Markdown Skill 导入失败");
    } finally {
      setImportingSkill(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const installSkill = async (skill: SkillDetail) => {
    setInstallingSkillId(skill.id);
    showNotice(skill.runtime.status === "broken" ? "正在修复技能运行环境…" : "正在安装技能运行环境…");
    try {
      const installed = await installSkillRuntime(skill.id);
      setSelectedSkill(installed);
      await loadCatalog();
      showNotice(
        installed.runtime.status === "available"
          ? "技能运行环境已就绪"
          : installed.runtime.error || "运行环境仍不可用",
      );
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "技能运行环境安装失败");
    } finally {
      setInstallingSkillId(null);
    }
  };

  const handleSkillChanged = async (skill: SkillDetail) => {
    setSelectedSkill(skill);
    await loadCatalog();
  };

  const handleDelete = (skill: SkillDetail) => {
    Modal.confirm({
      title: `删除「${skill.name}」？`,
      description: "此操作会移除本地 Skill Package，且无法恢复。",
      confirmText: "删除",
      cancelText: "取消",
      tone: "danger",
      onConfirm: async () => {
        setDeletingSkillId(skill.id);
        try {
          await deleteSkill(skill.id);
          setSelectedSkill(null);
          await loadCatalog();
          showNotice(`「${skill.name}」已删除`);
        } catch (error) {
          showNotice(error instanceof Error ? error.message : "Skill 删除失败");
        } finally {
          setDeletingSkillId(null);
        }
      },
    });
  };

  return (
    <>
      <SettingsPageLayout
        miniTitle="SKILLS"
        title="技能"
        description="将经验、方法和文档转化为技能，相似任务轻松复用"
        contentClassName="pt-5"
        scrollBody={false}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <div className="stable-scrollbar min-w-0 flex-1 overflow-x-auto pb-1">
              <div className="flex gap-1">
                {categories.map((category) => (
                  <Button key={category} size="xs" variant={activeCategory === category ? "secondary" : "ghost"} onClick={() => setActiveCategory(category)} className="shrink-0">
                    {category}
                  </Button>
                ))}
              </div>
            </div>

            <input
              ref={importInputRef}
              type="file"
              accept=".md,text/markdown,text/plain"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImport(file);
              }}
            />
            <Button size="xs" variant="secondary" disabled={importingSkill} onClick={() => importInputRef.current?.click()}>
              {importingSkill ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}
              {importingSkill ? "导入中…" : "导入 Markdown"}
            </Button>
            <div className={`h-8 shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${searchOpen ? "w-40" : "w-8"}`}>
              {searchOpen ? (
                <TextInput autoFocus ariaLabel="搜索技能" compact placeholder="搜索技能" value={query} onChange={setQuery} onBlur={() => setSearchOpen(false)} />
              ) : (
                <IconButton ariaLabel="搜索技能" size="sm" styleType="filled" onClick={() => setSearchOpen(true)}>
                  <Search size={17} />
                </IconButton>
              )}
            </div>
          </div>

          <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto">
            {catalogLoading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Skeleton.Card showAvatar /><Skeleton.Card showAvatar /><Skeleton.Card showAvatar /></div>
            ) : catalogError ? (
              <Result variant="danger" size="sm" title="技能目录加载失败" description={catalogError} action={<Button size="sm" variant="secondary" onClick={() => void loadCatalog()}>重新加载</Button>} />
            ) : visibleSkills.length ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {visibleSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    loading={detailLoadingId === skill.id}
                    onOpen={() => void openSkill(skill.id)}
                  />
                ))}
              </div>
            ) : (
              <Result size="sm" icon={<Search className="h-4 w-4" />} title="没有匹配的技能" description="试试其他分类或搜索关键词" />
            )}
          </div>
        </div>
      </SettingsPageLayout>

      {notice ? <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[10px] bg-ink px-4 py-2 text-xs text-white shadow-shadow-md">{notice}</div> : null}
      {selectedSkill ? (
        <SkillDetailModal
          skill={selectedSkill}
          installing={installingSkillId === selectedSkill.id}
          deleting={deletingSkillId === selectedSkill.id}
          onClose={() => setSelectedSkill(null)}
          onInstall={() => void installSkill(selectedSkill)}
          onChanged={(skill) => void handleSkillChanged(skill)}
          onDelete={() => void handleDelete(selectedSkill)}
          onNotice={showNotice}
        />
      ) : null}
    </>
  );
}

function SkillCard({ skill, loading, onOpen }: { skill: SkillView; loading: boolean; onOpen: () => void }) {
  const { Icon, className } = iconConfig[skill.icon];
  const runtime = runtimeLabel(skill.runtime.status);
  return (
    <Card interactive padding="none" className="min-h-[132px] overflow-hidden">
      <button type="button" onClick={onOpen} disabled={loading} className="group block h-full w-full p-4 text-left disabled:cursor-wait">
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[11px] ${className}`}><Icon size={22} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h4 className="truncate text-sm font-semibold text-text-primary">{skill.name}</h4>
              {runtime ? <span className={`text-xs ${runtimeClassName(skill.runtime.status)}`}>· {runtime}</span> : null}
            </div>
            <p className="mt-1 text-xs text-text-tertiary">来自 {skill.source}</p>
          </div>
          {loading ? <LoaderCircle size={16} className="animate-spin text-text-tertiary" /> : <ChevronRight size={17} className="text-text-tertiary transition-transform group-hover:translate-x-0.5" />}
        </div>
        <p className="mt-4 line-clamp-2 text-xs leading-5 text-text-secondary">{skill.description}</p>
      </button>
    </Card>
  );
}

function SkillDetailModal({
  skill,
  installing,
  deleting,
  onClose,
  onInstall,
  onChanged,
  onDelete,
  onNotice,
}: {
  skill: SkillDetail;
  installing: boolean;
  deleting: boolean;
  onClose: () => void;
  onInstall: () => void;
  onChanged: (skill: SkillDetail) => void;
  onDelete: () => void;
  onNotice: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["reference", "references", "runtime", "scripts", "templates", "examples"]));
  const [selectedFile, setSelectedFile] = useState("SKILL.md");
  const [fileContent, setFileContent] = useState<string>("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileTruncated, setFileTruncated] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    name: skill.name,
    version: skill.version,
    source: skill.source,
    category: skill.category,
    description: skill.description,
    featured: skill.featured,
  });

  useEffect(() => {
    setSelectedFile(skill.files.some((file) => file.path === "SKILL.md") ? "SKILL.md" : skill.files[0]?.path || "");
    setEditing(false);
    setDraft({
      name: skill.name,
      version: skill.version,
      source: skill.source,
      category: skill.category,
      description: skill.description,
      featured: skill.featured,
    });
  }, [skill.id]);

  const selectedDescriptor = skill.files.find((file) => file.path === selectedFile) ?? null;

  useEffect(() => {
    let cancelled = false;
    if (editing || !selectedDescriptor?.contentAvailable) {
      setFileContent("");
      setFileError(null);
      setFileTruncated(false);
      return () => { cancelled = true; };
    }
    setFileLoading(true);
    setFileError(null);
    void getSkillFileContent(skill.id, selectedDescriptor.path)
      .then((response) => {
        if (cancelled) return;
        setFileContent(response.content);
        setFileTruncated(response.truncated);
      })
      .catch((error) => {
        if (cancelled) return;
        setFileError(error instanceof Error ? error.message : "文件内容加载失败");
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false);
      });
    return () => { cancelled = true; };
  }, [editing, selectedDescriptor?.contentAvailable, selectedDescriptor?.path, skill.id]);

  const rootFiles = skill.files.filter((file) => !file.path.includes("/"));
  const folderEntries = Array.from(new Set(skill.files.filter((file) => file.path.includes("/")).map((file) => file.path.split("/")[0]))).map((folder) => ({
    folder,
    files: skill.files.filter((file) => file.path.startsWith(`${folder}/`)),
  }));

  const toggleFolder = (folder: string) => setExpandedFolders((current) => {
    const next = new Set(current);
    if (next.has(folder)) next.delete(folder);
    else next.add(folder);
    return next;
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateSkill(skill.id, draft);
      onChanged(updated);
      setEditing(false);
      onNotice("Skill 信息已更新");
    } catch (error) {
      onNotice(error instanceof Error ? error.message : "Skill 更新失败");
    } finally {
      setSaving(false);
    }
  };

  const markdownDocument = fileContent && selectedDescriptor?.extension === ".md"
    ? parseMarkdownDocument(fileContent)
    : { body: fileContent, metadata: [] as Array<[string, unknown]> };

  return (
    <ModalShell
      open
      onClose={onClose}
      width={1080}
      height="min(760px, calc(100vh - 64px))"
      showCloseButton={false}
      footer={null}
      bodyClassName="flex overflow-hidden p-0"
      title={
        <div className="flex w-full min-w-0 items-center gap-3">
          <span className="truncate">{skill.name}</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {skill.origin === "user" ? (
              <>
                <Button size="xs" variant="ghost" onClick={() => setEditing((value) => !value)} disabled={saving || deleting}>
                  <Pencil size={14} />{editing ? "返回文件" : "编辑"}
                </Button>
                <Button size="xs" variant="ghost" onClick={onDelete} disabled={saving || deleting}>
                  {deleting ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}{deleting ? "删除中…" : "删除"}
                </Button>
              </>
            ) : null}
            {skill.runtime.status === "not-installed" || skill.runtime.status === "broken" ? (
              <Button size="xs" variant="secondary" onClick={onInstall} disabled={installing || deleting || saving}>
                {installing ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
                {installing ? "准备环境…" : skill.runtime.status === "broken" ? "修复" : "安装"}
              </Button>
            ) : null}
            <IconButton ariaLabel="关闭" size="sm" onClick={onClose}><X size={18} /></IconButton>
          </div>
        </div>
      }
    >
      <div className="grid h-full min-h-0 w-full grid-cols-[280px_minmax(0,1fr)]">
        <aside className="stable-scrollbar min-h-0 overflow-y-auto border-r border-border px-5 py-5">
          <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">关于</p>
          <p className="mt-3 px-2 text-xs leading-6 text-text-secondary">{skill.description}</p>
          <dl className="mt-5 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-2 border-t border-border px-2 pt-4 text-xs">
            <dt className="text-text-tertiary">来源</dt><dd className="text-text-secondary">{skill.source}</dd>
            <dt className="text-text-tertiary">版本</dt><dd className="text-text-secondary">{skill.version}</dd>
            <dt className="text-text-tertiary">分类</dt><dd className="text-text-secondary">{skill.category}</dd>
            <dt className="text-text-tertiary">类型</dt><dd className="text-text-secondary">{originLabel(skill.origin)}</dd>
            {skill.license ? <><dt className="text-text-tertiary">许可</dt><dd className="break-words text-text-secondary">{skill.license}</dd></> : null}
            <dt className="text-text-tertiary">运行环境</dt><dd className={runtimeClassName(skill.runtime.status)}>{runtimeLabel(skill.runtime.status) || "无需额外环境"}</dd>
          </dl>
          {skill.runtime.requirements.length ? <p className="mt-3 px-2 text-[11px] leading-5 text-text-tertiary">依赖：{skill.runtime.requirements.join(", ")}</p> : null}
          {skill.runtime.missing?.length ? <p className="mt-2 px-2 text-[11px] leading-5 text-danger-text">缺少：{skill.runtime.missing.join(", ")}</p> : null}
          {skill.runtime.error ? <p className="mt-2 px-2 text-[11px] leading-5 text-danger-text">{skill.runtime.error}</p> : null}

          <div className="mt-5 border-t border-border pt-4">
            <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-tertiary">文件</p>
            <div className="mt-2 space-y-0.5">
              {rootFiles.map((file) => <FileTreeRow key={file.path} file={file} selected={selectedFile === file.path} onClick={() => { setEditing(false); setSelectedFile(file.path); }} />)}
              {folderEntries.map(({ folder, files }) => (
                <div key={folder}>
                  <Button type="button" size="xs" variant="ghost" onClick={() => toggleFolder(folder)} className="w-full !justify-start gap-1.5 text-left">
                    {expandedFolders.has(folder) ? <FolderOpen size={14} className="shrink-0 text-text-tertiary" /> : <Folder size={14} className="shrink-0 text-text-tertiary" />}
                    <span className="min-w-0 flex-1 truncate">{folder}</span>
                    <ChevronRight size={13} className={`ml-auto shrink-0 transition-transform ${expandedFolders.has(folder) ? "rotate-90" : ""}`} />
                  </Button>
                  {expandedFolders.has(folder) ? (
                    <div className="ml-3 border-l border-border pl-2">
                      {files.map((file) => <FileTreeRow key={file.path} file={file} label={file.path.slice(folder.length + 1)} selected={selectedFile === file.path} onClick={() => { setEditing(false); setSelectedFile(file.path); }} />)}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          {editing ? (
            <>
              <div className="flex h-14 shrink-0 items-center border-b border-border px-6"><h3 className="text-lg font-semibold text-text-primary">编辑 Skill 信息</h3></div>
              <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[760px] space-y-4 px-6 py-6">
                  <Field label="名称"><TextInput ariaLabel="Skill 名称" value={draft.name} onChange={(name) => setDraft((current) => ({ ...current, name }))} /></Field>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field label="版本"><TextInput ariaLabel="Skill 版本" value={draft.version} onChange={(version) => setDraft((current) => ({ ...current, version }))} /></Field>
                    <Field label="分类"><TextInput ariaLabel="Skill 分类" value={draft.category} onChange={(category) => setDraft((current) => ({ ...current, category }))} /></Field>
                  </div>
                  <Field label="来源"><TextInput ariaLabel="Skill 来源" value={draft.source} onChange={(source) => setDraft((current) => ({ ...current, source }))} /></Field>
                  <Field label="描述">
                    <textarea className="min-h-28 w-full resize-y rounded-[10px] border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong" value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-text-secondary">
                    <input type="checkbox" checked={draft.featured} onChange={(event) => setDraft((current) => ({ ...current, featured: event.target.checked }))} />
                    在「精选技能」中展示
                  </label>
                  <div className="flex justify-end gap-2 border-t border-border pt-4">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>取消</Button>
                    <Button size="sm" variant="secondary" onClick={() => void handleSave()} disabled={saving || !draft.name.trim() || !draft.category.trim()}>
                      {saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}{saving ? "保存中…" : "保存"}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-14 shrink-0 items-center border-b border-border px-6">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-lg font-semibold text-text-primary">{selectedDescriptor?.path || "文件"}</h3>
                  {selectedDescriptor ? <p className="mt-0.5 text-[11px] text-text-tertiary">{selectedDescriptor.kind} · {formatBytes(selectedDescriptor.size)}</p> : null}
                </div>
              </div>
              <div className="stable-scrollbar min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-[760px] px-6 py-6">
                  {!selectedDescriptor ? (
                    <Result size="sm" title="暂无文件" description="这个 Skill Package 当前没有可展示的文件。" />
                  ) : selectedDescriptor.declaredOnly ? (
                    <Result size="sm" title="文件未随 Skill Package 内联分发" description="该路径属于包声明，但当前安装的 Skill Package 中没有可直接读取的文件内容。" />
                  ) : !selectedDescriptor.previewable ? (
                    <Result size="sm" title="当前文件不支持文本预览" description={`${selectedDescriptor.name} 已存在，但不是可安全展示的文本文件。`} />
                  ) : fileLoading ? (
                    <div className="flex min-h-40 items-center justify-center"><LoaderCircle className="animate-spin text-text-tertiary" size={22} /></div>
                  ) : fileError ? (
                    <Result variant="danger" size="sm" title="文件加载失败" description={fileError} />
                  ) : selectedDescriptor.extension === ".md" && (markdownDocument.body || markdownDocument.metadata.length > 0) ? (
                    <>
                      {fileTruncated ? <p className="mb-4 rounded-[8px] bg-surface-secondary px-3 py-2 text-xs text-text-secondary">文件较大，当前只展示前 512 KB。</p> : null}
                      {markdownDocument.metadata.length > 0 ? (
                        <dl className="mb-6 space-y-2 border-b border-border pb-5 text-sm">
                          {markdownDocument.metadata.map(([key, value]) => (
                            <div key={key} className="grid min-w-0 grid-cols-[112px_minmax(0,1fr)] gap-x-4">
                              <dt className="min-w-0 break-words text-xs leading-6 text-text-tertiary">{formatMetadataLabel(key, t)}</dt>
                              <dd className="min-w-0 whitespace-pre-wrap break-words leading-6 text-text-secondary">{formatLocalizedMetadataValue(key, value, t)}</dd>
                            </div>
                          ))}
                        </dl>
                      ) : null}
                      {markdownDocument.body ? <MarkdownText features="basic" className="[&_h1]:mt-7 [&_h1:first-child]:mt-0 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:leading-8 [&_h1]:tracking-normal [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-normal [&_h3]:mt-5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:tracking-normal">{markdownDocument.body}</MarkdownText> : null}
                    </>
                  ) : fileContent ? (
                    <>
                      {fileTruncated ? <p className="mb-4 rounded-[8px] bg-surface-secondary px-3 py-2 text-xs text-text-secondary">文件较大，当前只展示前 512 KB。</p> : null}
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-6 text-text-primary">{fileContent}</pre>
                    </>
                  ) : (
                    <Result size="sm" title="暂无预览内容" description="文件为空或当前接口没有返回可展示内容。" />
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </ModalShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-2"><span className="text-xs font-medium text-text-secondary">{label}</span>{children}</label>;
}

function FileTreeRow({ file, label, selected, onClick }: { file: SkillFileDescriptor; label?: string; selected: boolean; onClick: () => void }) {
  return (
    <Button type="button" size="xs" variant={selected ? "secondary" : "ghost"} onClick={onClick} className="w-full !justify-start text-left">
      <File size={14} className="shrink-0 text-text-tertiary" />
      <span className="min-w-0 flex-1 truncate">{label || file.name}</span>
      {file.declaredOnly ? <span className="text-[10px] text-text-tertiary">声明</span> : null}
    </Button>
  );
}
