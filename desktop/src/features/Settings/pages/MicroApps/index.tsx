import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioLines, BookOpen, Boxes, BrainCircuit, ChevronRight, FileText, Image, Mail, MonitorSmartphone, MoreHorizontal, Newspaper, PlugZap, Search, Settings } from "lucide-react";
import { Link } from "react-router-dom";
import SettingsPageLayout from "../../components/SettingsPageLayout";
import Alert from "@/shared/ui/Alert";
import Badge from "@/shared/ui/Badge";
import Card from "@/shared/ui/Card";
import DropdownMenu from "@/shared/ui/DropdownMenu";
import { Button, GithubIcon as Github, IconButton, NotionIcon, Result, Skeleton, TextInput } from "@/shared/ui";
import { message } from "@/shared/ui/Message";
import {
  getIntegrationInstances,
  getIntegrationMicroApps,
  type MicroAppRecord,
} from "@/shared/api/integrations";
import {
  getMicroAppCapabilities,
  type MicroAppCapabilityBinding,
  type MicroAppCapabilityCode,
} from "@/shared/api/microAppCapabilities";
import { openCapabilityBindingModal } from "./CapabilityBindingModal";

const microAppSummaryKey = (microApp: MicroAppRecord) => {
  if (microApp.type === "knowledge_query") {
    return "settings.microApps.summaries.knowledgeQuery";
  }
  return "settings.microApps.summaries.integration";
};

const featuredStudioEntries = [
  {
    key: "jianXing",
    route: "/settings/micro-apps/jian-xing",
    capability: undefined,
    capabilityTags: ["toolkit"],
  },
  {
    key: "notion",
    route: "/settings/micro-apps/notion",
    capability: undefined,
    capabilityTags: ["basic"],
  },
  {
    key: "officeSuite",
    route: "/settings/micro-apps/office-suite",
    capability: undefined,
    capabilityTags: ["skill"],
    title: "文枢",
    description: "Word、Excel 与 PowerPoint 的本地处理与调试工作台。",
    actionLabel: "打开",
  },
  {
    key: "evolvingKnowledge",
    route: "/settings/micro-apps/evolving-knowledge-studio",
    capability: undefined,
    capabilityTags: [],
  },
  {
    key: "newsHub",
    route: "/settings/micro-apps/news-hub",
    capability: undefined,
    capabilityTags: ["mcp"],
  },
  {
    key: "mailCenter",
    route: "/settings/micro-apps/mail-center",
    capability: undefined,
    capabilityTags: ["mcp"],
  },
  {
    key: "computerUse",
    route: "/settings/micro-apps/computer-use-studio",
    capability: undefined,
    capabilityTags: ["toolkit"],
  },
  {
    key: "imageGeneration",
    route: "/settings/micro-apps/image-generation-studio",
    capability: "imageGeneration",
    capabilityTags: ["basic"],
  },
  {
    key: "ttsStudio",
    route: "/settings/micro-apps/tts-studio",
    capability: "tts",
    capabilityTags: ["basic"],
  },
  {
    key: "codeGraph",
    route: "/settings/micro-apps/codegraph-studio",
    capability: undefined,
    capabilityTags: ["toolkit"],
  },
  {
    key: "github",
    route: "/settings/micro-apps/github",
    capability: undefined,
    capabilityTags: ["toolkit"],
    title: "GitHub",
    description: "连接 GitHub，选择 Mira 可以使用的项目，并查看仓库协作与交付状态。",
    actionLabel: "进入 GitHub",
  },
] as const;

const featuredStudioIcons = {
  jianXing: PlugZap,
  notion: NotionIcon,
  officeSuite: FileText,
  evolvingKnowledge: BrainCircuit,
  newsHub: Newspaper,
  mailCenter: Mail,
  computerUse: MonitorSmartphone,
  imageGeneration: Image,
  ttsStudio: AudioLines,
  codeGraph: Boxes,
  github: Github,
} as const;

const capabilityFilters = [
  "all",
  "basic",
  "mcp",
  "skill",
  "toolkit",
  "unclassified",
] as const;

type CapabilityFilter = (typeof capabilityFilters)[number];

const matchesCapabilityFilter = (
  tags: readonly string[],
  filter: CapabilityFilter,
) => {
  if (filter === "all") return true;
  if (filter === "unclassified") return tags.length === 0;
  return tags.includes(filter);
};

export default function MicroAppsSettings() {
  const { t } = useTranslation();
  const [activeFilter, setActiveFilter] = useState<CapabilityFilter>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [microApps, setMicroApps] = useState<MicroAppRecord[]>([]);
  const [capabilityBindings, setCapabilityBindings] = useState<MicroAppCapabilityBinding[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [microAppResult, , capabilityResult] = await Promise.all([
        getIntegrationMicroApps({ type: "knowledge_query" }),
        getIntegrationInstances({ provider: "wecom", includeCapabilities: true }),
        getMicroAppCapabilities(),
      ]);

      setMicroApps(microAppResult.microApps);
      setCapabilityBindings(capabilityResult);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("settings.microApps.messages.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleStudioEntries = featuredStudioEntries.filter((entry) => {
    if (!matchesCapabilityFilter(entry.capabilityTags, activeFilter)) return false;
    if (!normalizedQuery) return true;

    const key = `settings.microApps.studioEntries.${entry.key}` as const;
    const title = "title" in entry ? entry.title : t(`${key}.title`);
    const description =
      "description" in entry ? entry.description : t(`${key}.description`);
    const tagText = entry.capabilityTags
      .map((tag) => t(`settings.microApps.capabilityTags.${tag}`))
      .join(" ");

    return `${title} ${description} ${tagText}`
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
  const showDynamicMicroApps = activeFilter === "all" || activeFilter === "basic";
  const visibleMicroApps = showDynamicMicroApps
    ? microApps.filter((microApp) => {
        if (!normalizedQuery) return true;
        return `${microApp.name} ${microApp.type} ${t(microAppSummaryKey(microApp))} ${t("settings.microApps.capabilityTags.basic")}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
    : [];
  const hasVisibleMicroApps = visibleStudioEntries.length > 0 || visibleMicroApps.length > 0;

  if (loading) {
    return (
      <SettingsPageLayout
        miniTitle={t("settings.microApps.page.miniTitle")}
        title={t("settings.microApps.page.title")}
        description={t("settings.microApps.page.description")}
        contentClassName="space-y-6 pt-6"
      >
        <div data-testid="micro-apps-loading-skeleton" className="space-y-6">
          <div className="space-y-3">
            <Skeleton height={18} width="28%" />
            <Skeleton.Text lines={2} lastLineWidth="72%" />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <Skeleton height={20} width="34%" />
              <Skeleton.Text lines={4} lastLineWidth="58%" />
              <Skeleton height={40} width={160} />
            </div>

            <div className="space-y-4">
              <Skeleton height={18} width="42%" />
              <Skeleton.Text lines={3} lastLineWidth="66%" />
              <Skeleton height={18} width="30%" />
              <Skeleton.Text lines={3} lastLineWidth="54%" />
            </div>
          </div>

          <div
            data-testid="micro-apps-loading-grid"
            className="grid grid-cols-2 gap-4 pb-6 xl:grid-cols-3"
          >
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="min-h-[132px]">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <Skeleton.Circle size={44} className="shrink-0" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton height={18} width="52%" />
                    </div>
                  </div>
                  <div className="mt-4"><Skeleton.Text lines={2} lastLineWidth="62%" /></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </SettingsPageLayout>
    );
  }

  return (
    <SettingsPageLayout
      miniTitle={t("settings.microApps.page.miniTitle")}
      title={t("settings.microApps.page.title")}
      description={t("settings.microApps.page.description")}
      contentClassName="pt-6"
      scrollBody={false}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-6">
        {microApps.length === 0 ? (
          <Alert variant="info" title={t("settings.microApps.states.emptyTitle")}>
            {t("settings.microApps.states.emptyDescription")}
          </Alert>
        ) : null}

        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <div
            data-testid="micro-apps-capability-filters"
            className="stable-scrollbar min-w-0 flex-1 overflow-x-auto pb-1"
          >
            <div className="flex gap-1">
              {capabilityFilters.map((filter) => (
                <Button
                  key={filter}
                  type="button"
                  size="xs"
                  variant={activeFilter === filter ? "secondary" : "ghost"}
                  aria-pressed={activeFilter === filter}
                  className="shrink-0"
                  onClick={() => setActiveFilter(filter)}
                >
                  {t(`settings.microApps.filters.${filter}`)}
                </Button>
              ))}
            </div>
          </div>

          <div
            data-testid="micro-apps-search-control"
            className={`h-8 shrink-0 overflow-hidden transition-[width] duration-200 ease-out ${searchOpen ? "w-40" : "w-8"}`}
          >
            {searchOpen ? (
              <TextInput
                autoFocus
                ariaLabel={t("settings.microApps.search.ariaLabel")}
                compact
                placeholder={t("settings.microApps.search.placeholder")}
                value={query}
                onChange={setQuery}
                onBlur={() => {
                  if (!query.trim()) setSearchOpen(false);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  setQuery("");
                  setSearchOpen(false);
                }}
              />
            ) : (
              <IconButton
                ariaLabel={t("settings.microApps.search.ariaLabel")}
                size="sm"
                styleType="filled"
                onClick={() => setSearchOpen(true)}
              >
                <Search size={17} />
              </IconButton>
            )}
          </div>
        </div>

        <div
          data-testid="micro-apps-results-scroll"
          className="stable-scrollbar min-h-0 flex-1 overflow-y-auto"
        >
          {hasVisibleMicroApps ? (
          <div data-testid="micro-apps-studio-grid" className="grid grid-cols-2 gap-4 pb-6 xl:grid-cols-3">
        {visibleStudioEntries.map((entry) => {
          const key = `settings.microApps.studioEntries.${entry.key}` as const;
          const EntryIcon = featuredStudioIcons[entry.key];
          const capability = entry.capability as MicroAppCapabilityCode | undefined;
          const binding = capability
            ? capabilityBindings.find((item) => item.capabilityCode === capability) ?? null
            : null;
          const capabilityName = capability
            ? t(`settings.microApps.capabilityBinding.capabilityNames.${capability}`)
            : "";
          const entryTitle = "title" in entry ? entry.title : t(`${key}.title`);
          const entryDescription =
            "description" in entry ? entry.description : t(`${key}.description`);
          const actionLabel =
            "actionLabel" in entry ? entry.actionLabel : t(`${key}.actions.open`);
          const openCapabilityConfiguration = () => {
            if (!capability) return;
            openCapabilityBindingModal({
              capability,
              title: t("settings.microApps.capabilityBinding.title", {
                capability: capabilityName,
              }),
              currentBinding: binding,
              onSaved: (nextBinding) => {
                setCapabilityBindings((current) => [
                  ...current.filter(
                    (item) => item.capabilityCode !== capability,
                  ),
                  nextBinding,
                ]);
              },
            });
          };

          return (
            <Card
              key={entry.route}
              interactive
              padding="none"
              data-testid={`studio-entry-card-${entry.key}`}
              className="group/card relative min-h-[132px] overflow-hidden"
            >
              <Link
                to={entry.route}
                aria-label={`${actionLabel}：${entryTitle}`}
                className={`group block h-full w-full p-4 text-left ${capability ? "pr-14" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    data-testid={`studio-entry-icon-${entry.key}`}
                    className="shrink-0 text-icon-secondary"
                  >
                    <EntryIcon
                      className={entry.key === "github" ? "h-7 w-7" : "h-[22px] w-[22px]"}
                    />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pt-0.5">
                    <h4 className="min-w-0 truncate text-sm font-semibold text-text-primary">
                      {entryTitle}
                    </h4>
                    {entry.capabilityTags.map((tag) => (
                      <span
                        key={tag}
                        data-testid={`studio-entry-capability-${entry.key}-${tag}`}
                        className="inline-flex shrink-0"
                      >
                        <Badge
                          variant="neutral"
                          size="sm"
                          outline
                          className="!px-1.5 !py-0 text-[10px] leading-4"
                        >
                          {t(`settings.microApps.capabilityTags.${tag}`)}
                        </Badge>
                      </span>
                    ))}
                  </div>
                  {!capability ? (
                    <ChevronRight className="h-[17px] w-[17px] shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
                  ) : null}
                </div>
                <p className="mt-4 line-clamp-2 text-xs leading-5 text-text-secondary">
                  {entryDescription}
                </p>
              </Link>

              {capability ? (
                <div className="absolute right-3 top-3">
                  <DropdownMenu
                    align="end"
                    sideOffset={4}
                    trigger={
                      <button
                        type="button"
                        aria-label={t("settings.microApps.capabilityBinding.moreActionsAriaLabel", {
                          capability: capabilityName,
                        })}
                        title={t("settings.microApps.capabilityBinding.moreActionsAriaLabel", {
                          capability: capabilityName,
                        })}
                        data-testid={`studio-entry-menu-${entry.key}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-ui-control bg-surface-secondary text-icon-tertiary opacity-100 transition-all hover:text-icon-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 data-[state=open]:pointer-events-auto data-[state=open]:opacity-100 md:pointer-events-none md:opacity-0 md:group-focus-within/card:pointer-events-auto md:group-focus-within/card:opacity-100 md:group-hover/card:pointer-events-auto md:group-hover/card:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    }
                    items={[
                      {
                        id: "configure",
                        label: t("settings.microApps.capabilityBinding.configure"),
                        leadingIcon: <Settings className="h-4 w-4" />,
                      },
                    ]}
                    onSelect={(item) => {
                      if (item.id === "configure") openCapabilityConfiguration();
                    }}
                  />
                </div>
              ) : null}
            </Card>
          );
        })}

        {visibleMicroApps.map((microApp) => {
          return (
            <Link
              key={microApp.id}
              to={`/settings/micro-apps/${microApp.id}`}
              className="group block"
              data-testid={`micro-app-card-${microApp.id}`}
            >
              <Card interactive padding="none" className="h-full min-h-[132px] overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="shrink-0 text-icon-secondary">
                      <BookOpen className="h-[22px] w-[22px]" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 pt-0.5">
                      <h4 className="min-w-0 truncate text-sm font-semibold text-text-primary">
                        {microApp.name}
                      </h4>
                      <span
                        data-testid={`micro-app-capability-${microApp.id}-basic`}
                        className="inline-flex shrink-0"
                      >
                        <Badge
                          variant="neutral"
                          size="sm"
                          outline
                          className="!px-1.5 !py-0 text-[10px] leading-4"
                        >
                          {t("settings.microApps.capabilityTags.basic")}
                        </Badge>
                      </span>
                    </div>
                    <ChevronRight className="h-[17px] w-[17px] shrink-0 text-text-tertiary transition-transform group-hover:translate-x-0.5" />
                  </div>
                  <p className="mt-4 line-clamp-2 text-xs leading-5 text-text-secondary">
                    {t(microAppSummaryKey(microApp))}
                  </p>
                </div>
              </Card>
            </Link>
          );
        })}
          </div>
          ) : (
            <Result
              size="sm"
              icon={<Search className="h-4 w-4" />}
              title={t("settings.microApps.search.emptyTitle")}
              description={t("settings.microApps.search.emptyDescription")}
              className="pb-6"
            />
          )}
        </div>
      </div>
    </SettingsPageLayout>
  );
}
