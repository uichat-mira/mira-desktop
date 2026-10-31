import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import docsIndex from "./generated/docs-index.json";
import type {
  DocumentLifecycle,
  GeneratedDocument,
  GeneratedDocsIndex,
  NavigationItem,
} from "./types";

const data = docsIndex as GeneratedDocsIndex;
const appBase = import.meta.env.BASE_URL.replace(/\/$/, "");
type Doc = GeneratedDocument;

const lifecycleOrder: Record<DocumentLifecycle, number> = {
  current: 0,
  active: 1,
  planning: 2,
  historical: 3,
  unverified: 4,
};

const lifecycleLabels: Record<DocumentLifecycle, string> = {
  current: "当前真相",
  active: "施工与验证",
  planning: "方案与实验",
  historical: "历史归档",
  unverified: "待核验",
};

const lifecycleDescriptions: Record<DocumentLifecycle, string> = {
  current: "已经核验的当前契约、现状总纲和稳定参考。",
  active: "正在施工、验收或回归中的工程记录，不等于最终产品承诺。",
  planning: "设计、计划、研究与 POC，只表达探索方向，不代表已经实现。",
  historical: "已归档、废弃或被替代的资料，只用于追溯背景。",
  unverified: "缺少足够状态信息，不能自动作为当前事实使用。",
};

const verificationLabels = {
  fresh: "已核验",
  stale: "核验已过期",
  missing: "缺少核验日期",
  invalid: "核验日期无效",
  "not-required": "无需核验",
} as const;

const labelMap: Record<string, string> = {
  "raw-source": "实现事实",
  wiki: "知识整理",
  schema: "规则与契约",
  "current-contract": "当前契约",
  "current-snapshot": "当前快照",
  reference: "稳定参考",
  overview: "总纲",
  design: "设计",
  plan: "计划",
  checklist: "检查清单",
  draft: "草案",
  "implementation-notes": "实现记录",
  historical: "历史资料",
  "how-to": "使用指南",
  roadmap: "路线图",
  research: "研究",
  poc: "POC",
};

const sectionTitleMap: Record<string, string> = {
  root: "项目总览",
  maps: "区域地图",
  concepts: "概念索引",
  "knowledge-system": "知识系统",
  architecture: "架构",
  build: "构建与发布",
  chat: "对话系统",
  provider: "Provider",
  "knowledge-base": "知识库",
  evaluation: "评测",
  skill: "Skill",
  harness: "Harness",
  "tooling-runtime": "工具运行时",
  microapp: "微应用",
  integrations: "集成",
  role: "角色系统",
  platform: "平台",
  developments: "开发支撑",
  development: "开发支撑",
  "project-control": "项目控制",
  archive: "历史归档",
  "prompt-manager-rules": "Prompt Rules",
  assets: "资源",
};

const moduleLabelMap: Record<string, string> = {
  Project: "项目",
  Chat: "对话",
  Agent: "Agent",
  ModelSetting: "模型设置",
  Provider: "Provider",
  MCP: "MCP",
  Tool: "工具",
  Harness: "Harness",
  Sandbox: "Sandbox",
  KnowledgeBase: "知识库",
  Evaluation: "评测",
  Role: "角色",
  Docs: "文档系统",
  SKILL: "Skill",
  MicroAPP: "微应用",
  Platform: "平台",
  Developments: "开发支撑",
  Develoments: "开发支撑",
};

const coreEntryPaths = [
  "CURRENT_PRODUCT_TRUTH",
  "ENGINEERING_MEMORY",
  "README",
  "harness/agentgraph-harness-protocol",
  "skill/README",
  "tooling-runtime/README",
  "knowledge-base/README",
  "provider/README",
  "evaluation/README",
  "microapp/README",
];

const withBase = (value: string) => {
  if (!appBase) return value;
  return value === "/" ? `${appBase}/` : `${appBase}${value}`;
};

marked.setOptions({ breaks: true, gfm: true });

const findDocument = (id: string) =>
  data.documents.find((document) => document.id.toLowerCase() === id.toLowerCase()) ?? null;

const formatMetaValue = (value: string | null) => (value ? labelMap[value] ?? value : null);
const getModuleLabel = (value: string | null) =>
  value ? moduleLabelMap[value] ?? value : "未标注";

const sortDocuments = (items: Doc[]) =>
  [...items].sort((left, right) => {
    const lifecycleDelta = lifecycleOrder[left.lifecycle] - lifecycleOrder[right.lifecycle];
    if (lifecycleDelta) return lifecycleDelta;
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    if (left.metadata.canonical !== right.metadata.canonical) {
      return left.metadata.canonical ? -1 : 1;
    }
    return left.title.localeCompare(right.title, "zh-CN");
  });

const byLifecycle = (lifecycle: DocumentLifecycle) =>
  sortDocuments(data.documents.filter((document) => document.lifecycle === lifecycle));

const currentDocuments = byLifecycle("current");
const currentPrimaryDocuments = currentDocuments.filter((document) => document.isPrimary);
const activeDocuments = byLifecycle("active");
const planningDocuments = byLifecycle("planning");
const historicalDocuments = byLifecycle("historical");
const unverifiedDocuments = byLifecycle("unverified");

const currentModuleGroups = Array.from(
  new Set(
    currentDocuments
      .map((document) => document.metadata.module)
      .filter((moduleName): moduleName is string => Boolean(moduleName)),
  ),
)
  .map((moduleName) => ({
    moduleName,
    documents: currentDocuments.filter((document) => document.metadata.module === moduleName),
  }))
  .sort((left, right) =>
    getModuleLabel(left.moduleName).localeCompare(getModuleLabel(right.moduleName), "zh-CN"),
  );

const stats = {
  total: data.stats?.total ?? data.documents.length,
  current: data.stats?.byLifecycle.current ?? currentDocuments.length,
  active: data.stats?.byLifecycle.active ?? activeDocuments.length,
  planning: data.stats?.byLifecycle.planning ?? planningDocuments.length,
  historical: data.stats?.byLifecycle.historical ?? historicalDocuments.length,
  unverified: data.stats?.byLifecycle.unverified ?? unverifiedDocuments.length,
  stale: data.stats?.byVerification.stale ?? 0,
  missingVerification: data.stats?.byVerification.missing ?? 0,
};

const navChildren = (documents: Doc[], limit = 12): NavigationItem[] =>
  documents.slice(0, limit).map((document) => ({ title: document.title, path: document.id }));

const leftRailNavigation: NavigationItem[] = [
  { title: "首页", path: "README" },
  { title: "当前产品真相", path: "CURRENT_PRODUCT_TRUTH" },
  { title: "工程共同记忆", path: "ENGINEERING_MEMORY" },
  { title: `当前真相 ${stats.current}`, children: navChildren(currentPrimaryDocuments, 16) },
  {
    title: "按模块",
    children: currentModuleGroups.slice(0, 16).map((group) => ({
      title: `${getModuleLabel(group.moduleName)} ${group.documents.length}`,
      children: navChildren(group.documents, 8),
    })),
  },
  { title: `施工与验证 ${stats.active}`, children: navChildren(activeDocuments) },
  { title: `方案与实验 ${stats.planning}`, children: navChildren(planningDocuments) },
  {
    title: `历史归档 ${stats.historical}`,
    children: [{ title: "归档说明", path: "archive/README" }, ...navChildren(historicalDocuments, 11)],
  },
  { title: `待核验 ${stats.unverified}`, children: navChildren(unverifiedDocuments) },
];

const renderNavigation = (items: NavigationItem[]) => (
  <ul className="nav-list">
    {items.map((item) => (
      <li key={`${item.title}-${item.path ?? "group"}`}>
        {item.path ? (
          <NavLink
            to={`/doc/${item.path}`}
            className={({ isActive }) => (isActive ? "nav-link nav-link-active" : "nav-link")}
          >
            {item.title}
          </NavLink>
        ) : (
          <span className="nav-group">{item.title}</span>
        )}
        {item.children?.length ? renderNavigation(item.children) : null}
      </li>
    ))}
  </ul>
);

const LifecycleMeta = ({ document }: { document: Doc }) => (
  <div className={`meta-row${document.lifecycle === "historical" ? " meta-row-historical" : ""}`}>
    <span>{lifecycleLabels[document.lifecycle]}</span>
    {document.metadata.canonical ? <span>Canonical</span> : null}
    {document.metadata.layer ? <span>{formatMetaValue(document.metadata.layer)}</span> : null}
    {document.metadata.module ? <span>{getModuleLabel(document.metadata.module)}</span> : null}
    {document.metadata.docType ? <span>{formatMetaValue(document.metadata.docType)}</span> : null}
    {document.lifecycle === "current" ? <span>{verificationLabels[document.verification]}</span> : null}
  </div>
);

const lifecycleNotice = (document: Doc) => {
  if (document.lifecycle === "historical") {
    return "这页已经归档，不应作为当前实现或产品能力的依据。";
  }
  if (document.lifecycle === "planning") {
    return "这页属于方案、设计或实验材料；写在这里不等于已经实现。";
  }
  if (document.lifecycle === "active") {
    return "这页记录正在施工或验证的工作，结论可能继续变化。";
  }
  if (document.lifecycle === "unverified") {
    return "这页缺少可信状态信息，使用前需要回到代码、验证结果或当前契约核对。";
  }
  if (document.verification === "stale") {
    return "这页曾被标为当前真相，但核验日期已超过 90 天，需要重新验证。";
  }
  if (["missing", "invalid"].includes(document.verification)) {
    return "这页被归为当前文档，但核验信息不完整，可信度低于已核验契约。";
  }
  return null;
};

const SearchIndex = () => {
  const location = useLocation();
  const query = new URLSearchParams(location.search).get("q")?.trim().toLowerCase() ?? "";
  const results = useMemo(() => {
    if (!query) return [];
    return sortDocuments(
      data.documents.filter((document) =>
        `${document.title}\n${document.excerpt}\n${document.content}`.toLowerCase().includes(query),
      ),
    ).slice(0, 30);
  }, [query]);

  return (
    <section className="content-surface">
      <header className="page-header">
        <div>
          <p className="eyebrow">Search</p>
          <h1>搜索文档</h1>
        </div>
        <p>搜索覆盖全部文档，但当前真相会排在计划、历史和未核验材料之前。</p>
      </header>
      {query ? (
        <div className="search-results">
          {results.map((document) => (
            <article key={document.id} className="search-result-item">
              <LifecycleMeta document={document} />
              <Link to={`/doc/${document.id}`} className="search-title">
                {document.title}
              </Link>
              <p>{document.excerpt || lifecycleDescriptions[document.lifecycle]}</p>
              <small>{document.path}</small>
            </article>
          ))}
          {results.length === 0 ? <p className="empty-state">没有匹配结果。</p> : null}
        </div>
      ) : (
        <p className="empty-state">请输入关键词。</p>
      )}
    </section>
  );
};

const DocumentPage = ({ isTocOpen, onCloseToc }: { isTocOpen: boolean; onCloseToc: () => void }) => {
  const params = useParams<{ "*": string }>();
  const document = findDocument(params["*"] ?? "README");
  if (!document) return <Navigate to="/doc/README" replace />;

  const displayContent = document.content.startsWith("---")
    ? document.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
    : document.content;
  const html = (marked.parse(displayContent) as string).replace(
    /href="DOC_ROUTE:([^"]+)"/g,
    (_match, route: string) => `href="${withBase(route)}"`,
  );
  const usedAnchors = new Set<string>();
  const withHeadingIds = html.replace(/<h([1-6])>(.*?)<\/h\1>/g, (_match, level, inner) => {
    const text = String(inner).replace(/<[^>]+>/g, "").trim();
    const heading = document.headings.find(
      (item) => !usedAnchors.has(item.anchor) && item.text === text,
    );
    if (!heading) return `<h${level}>${inner}</h${level}>`;
    usedAnchors.add(heading.anchor);
    return `<h${level} id="${heading.anchor}">${inner}</h${level}>`;
  });
  const notice = lifecycleNotice(document);

  return (
    <section className="content-surface docs-surface">
      <div className="docs-page">
        <div className="docs-content">
          <article className="doc-article">
            <header className="doc-header">
              <div className="doc-breadcrumb">
                <span>{sectionTitleMap[document.section] ?? "文档"}</span>
                <span className="doc-path">{document.path}</span>
              </div>
              <h1>{document.title}</h1>
              <LifecycleMeta document={document} />
            </header>
            {notice ? <p className="historical-note">{notice}</p> : null}
            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: withHeadingIds }} />
          </article>
        </div>
        <aside className={`toc-rail${isTocOpen ? " toc-rail-open" : ""}`}>
          <div className="toc-panel">
            <div className="toc-panel-header">
              <h2>本页导航</h2>
              <button type="button" className="toc-close-btn" onClick={onCloseToc}>关闭</button>
            </div>
            <ul>
              {document.headings.map((heading) => (
                <li key={`${heading.anchor}-${heading.text}`} className={`toc-level-${heading.level}`}>
                  <a href={`#${heading.anchor}`} onClick={onCloseToc}>{heading.text}</a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
};

const DocumentList = ({
  title,
  description,
  documents,
  limit = 12,
}: {
  title: string;
  description: string;
  documents: Doc[];
  limit?: number;
}) => (
  <section className="index-section">
    <header className="index-section-header">
      <div><h2>{title}</h2><p>{description}</p></div>
    </header>
    <ol className="index-list index-list-dense">
      {documents.slice(0, limit).map((document) => (
        <li key={document.id} className="index-item">
          <Link to={`/doc/${document.id}`} className="index-item-link">
            <span className="index-item-title">{document.title}</span>
            <span className="index-item-path">{document.path}</span>
          </Link>
          <p>{document.excerpt || lifecycleDescriptions[document.lifecycle]}</p>
        </li>
      ))}
    </ol>
  </section>
);

const HomePage = () => {
  const coreEntries = coreEntryPaths
    .map(findDocument)
    .filter((document): document is Doc => Boolean(document) && document?.lifecycle === "current");

  return (
    <section className="content-surface">
      <header className="home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">Truth before narrative</p>
          <h1>UIChat Mira 项目文档</h1>
          <p className="home-hero-intro">
            这里首先回答“现在真实存在什么”。计划、POC、施工记录和历史资料仍然保留，但不会再冒充当前能力。
          </p>
        </div>
        <div className="home-hero-note">
          <span>当前真相 {stats.current}</span>
          <span>施工与验证 {stats.active}</span>
          <span>方案与实验 {stats.planning}</span>
          <span>历史归档 {stats.historical}</span>
          <span>待核验 {stats.unverified}</span>
        </div>
      </header>

      <div className="home-grid">
        <div className="home-main">
          <DocumentList title="从这里开始" description="先建立当前产品与工程事实，再进入具体模块。" documents={coreEntries} limit={coreEntries.length} />
          <DocumentList title="当前真相" description="Canonical、current-contract、current-snapshot、overview 和稳定参考优先。" documents={currentPrimaryDocuments} limit={16} />

          <section className="index-section">
            <header className="index-section-header">
              <div><h2>当前模块</h2><p>这里只展示已经归入当前真相的模块文档。</p></div>
            </header>
            <div className="module-feature-groups">
              {currentModuleGroups.map((group) => {
                const firstDocument = group.documents[0];
                return (
                  <section key={group.moduleName} className="module-feature-group">
                    <header className="module-feature-group-header">
                      <h3>{getModuleLabel(group.moduleName)}</h3><span>{group.documents.length} 篇</span>
                    </header>
                    <ul className="module-feature-list">
                      <li className="module-feature-item">
                        <Link to={`/doc/${firstDocument.id}`} className="module-feature-link">
                          <span className="module-feature-name">进入模块</span>
                          <span className="module-feature-count">{firstDocument.title}</span>
                        </Link>
                      </li>
                    </ul>
                  </section>
                );
              })}
            </div>
          </section>

          <DocumentList title="正在施工" description={lifecycleDescriptions.active} documents={activeDocuments} />
          <DocumentList title="方案与实验" description={lifecycleDescriptions.planning} documents={planningDocuments} />
        </div>

        <aside className="home-aside">
          <section className="aside-section">
            <h2>事实健康度</h2>
            <ul>
              <li>文档总数 {stats.total} 篇</li>
              <li>当前真相 {stats.current} 篇</li>
              <li>核验过期 {stats.stale} 篇</li>
              <li>缺核验日期 {stats.missingVerification} 篇</li>
              <li>待核验 {stats.unverified} 篇</li>
              <li>生成于 {new Date(data.generatedAt).toLocaleDateString("zh-CN")}</li>
            </ul>
          </section>
          <section className="aside-section">
            <h2>阅读规则</h2>
            <ul>
              <li>当前真相优先于施工记录。</li>
              <li>施工记录优先于方案猜想。</li>
              <li>方案写过，不代表功能做成。</li>
              <li>历史材料不得覆盖当前契约。</li>
              <li>待核验文档必须回到代码和验证证据。</li>
            </ul>
          </section>
          <section className="aside-section">
            <h2>归档入口</h2>
            <ul>
              <li><Link to="/doc/archive/README">查看归档规则</Link></li>
              <li>历史材料 {stats.historical} 篇</li>
              <li>方案与实验 {stats.planning} 篇</li>
            </ul>
          </section>
        </aside>
      </div>
    </section>
  );
};

const useEmbeddedSidebarState = () => {
  const mediaMatches = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches;
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(mediaMatches);
  const [isMobileLayout, setIsMobileLayout] = useState(mediaMatches);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia("(max-width: 960px)");
    const apply = (matches: boolean) => {
      setIsMobileLayout(matches);
      setIsSidebarCollapsed(matches);
    };
    apply(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => apply(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "docs-site:set-sidebar-collapsed") {
        setIsSidebarCollapsed(Boolean(event.data.value));
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return { isSidebarCollapsed, setIsSidebarCollapsed, isMobileLayout };
};

export const App = () => {
  const { isSidebarCollapsed, setIsSidebarCollapsed, isMobileLayout } = useEmbeddedSidebarState();
  const location = useLocation();
  const query = new URLSearchParams(location.search).get("q") ?? "";
  const [isTocOpen, setIsTocOpen] = useState(false);

  useEffect(() => {
    setIsTocOpen(false);
    if (typeof window !== "undefined" && window.innerWidth <= 960) setIsSidebarCollapsed(true);
  }, [location.pathname, location.search, setIsSidebarCollapsed]);

  useEffect(() => {
    if (!isMobileLayout) setIsSidebarCollapsed(false);
  }, [isMobileLayout, setIsSidebarCollapsed]);

  const closeAllPanels = () => {
    setIsSidebarCollapsed(true);
    setIsTocOpen(false);
  };

  return (
    <div className={`app-shell${isSidebarCollapsed ? " app-shell-collapsed" : ""}`}>
      {isMobileLayout && (!isSidebarCollapsed || isTocOpen) ? (
        <button type="button" className="mobile-overlay" aria-label="关闭面板" onClick={closeAllPanels} />
      ) : null}
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="sidebar-brand-block">
            <div className="sidebar-brand-row">
              {isMobileLayout ? (
                <button
                  type="button"
                  className="sidebar-toggle-btn"
                  onClick={() => setIsSidebarCollapsed((current) => !current)}
                  aria-label={isSidebarCollapsed ? "展开目录" : "收起目录"}
                >
                  <span className="sidebar-toggle-icon" aria-hidden="true">{isSidebarCollapsed ? ">" : "<"}</span>
                </button>
              ) : null}
              <Link to="/" className="brand">
                <span className="brand-logo brand-logo-fallback" aria-hidden="true">UM</span>
                <div className="brand-text"><span>UIChat Mira</span><span className="brand-slogan">Project Truth</span></div>
              </Link>
            </div>
            <form action={withBase("/search")} className="sidebar-search">
              <input name="q" type="search" defaultValue={query} placeholder="搜索文档..." />
            </form>
          </div>
          <div className="sidebar-heading"><span>导航</span><small>{stats.total} 篇</small></div>
          <nav>{renderNavigation(leftRailNavigation)}</nav>
        </div>
      </aside>
      <main className="main-panel">
        <div className="mobile-doc-toolbar">
          <button
            type="button"
            className="mobile-doc-toolbar-btn"
            onClick={() => { setIsTocOpen(false); setIsSidebarCollapsed(false); }}
          >
            <span className="mobile-doc-toolbar-icon" aria-hidden="true">≡</span><span>Menu</span>
          </button>
          <button
            type="button"
            className="mobile-doc-toolbar-btn"
            onClick={() => { setIsSidebarCollapsed(true); setIsTocOpen((current) => !current); }}
          >
            <span>On this page</span><span className="mobile-doc-toolbar-icon" aria-hidden="true">›</span>
          </button>
        </div>
        <div className="page-shell">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/search" element={<SearchIndex />} />
            <Route path="/doc/*" element={<DocumentPage isTocOpen={isTocOpen} onCloseToc={() => setIsTocOpen(false)} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>
    </div>
  );
};
